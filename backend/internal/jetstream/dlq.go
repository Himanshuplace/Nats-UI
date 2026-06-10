package jetstream

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	natsgo "github.com/nats-io/nats.go"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// NATS has no built-in dead-letter queue. When JetStream gives up on a message it
// publishes an *advisory* the client can subscribe to:
//
//	$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.<stream>.<consumer>
//	$JS.EVENT.ADVISORY.CONSUMER.MSG_TERMINATED.<stream>.<consumer>
//
// The first fires when a message exhausts a consumer's MaxDeliver attempts; the
// second when a consumer +TERM's a message. Both name the offending stream +
// consumer + stream sequence — enough to fetch and act on the poison message.
const (
	dlqMaxDeliverSubject = "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.>"
	dlqTerminatedSubject = "$JS.EVENT.ADVISORY.CONSUMER.MSG_TERMINATED.>"
	dlqMaxBuffer         = 500 // poison events retained per cluster (ring buffer)
)

// jsAdvisory is the subset of a JetStream consumer advisory we care about. Both
// the max_deliver and terminated advisories share these fields.
type jsAdvisory struct {
	Type       string `json:"type"`
	Timestamp  string `json:"timestamp"`
	Stream     string `json:"stream"`
	Consumer   string `json:"consumer"`
	StreamSeq  uint64 `json:"stream_seq"`
	Deliveries int    `json:"deliveries"`
	Reason     string `json:"reason"`
}

// dlqWatcher holds one cluster's live advisory subscriptions plus the capped ring
// buffer of poison events they've collected. Guarded by its own mutex so ingest
// (NATS callback goroutine) and List (HTTP goroutine) don't race.
type dlqWatcher struct {
	mu      sync.Mutex
	nc      *natsgo.Conn // the connection these subs belong to (detect reconnects)
	subs    []*natsgo.Subscription
	events  []types.DeadLetter // oldest first; trimmed to dlqMaxBuffer
	started time.Time
}

func (w *dlqWatcher) ingest(msg *natsgo.Msg) {
	var adv jsAdvisory
	if err := json.Unmarshal(msg.Data, &adv); err != nil {
		return // not an advisory we understand — ignore
	}
	kind := "terminated"
	if strings.Contains(adv.Type, "max_deliver") {
		kind = "max_deliver"
	}
	ev := types.DeadLetter{
		Type:       kind,
		Stream:     adv.Stream,
		Consumer:   adv.Consumer,
		StreamSeq:  adv.StreamSeq,
		Deliveries: adv.Deliveries,
		Reason:     adv.Reason,
		Timestamp:  adv.Timestamp,
	}

	w.mu.Lock()
	w.events = append(w.events, ev)
	if len(w.events) > dlqMaxBuffer {
		// drop oldest — keep the most recent dlqMaxBuffer events
		w.events = w.events[len(w.events)-dlqMaxBuffer:]
	}
	w.mu.Unlock()
}

// ensureDLQWatch returns the cluster's watcher, lazily subscribing to the
// advisories on first use. If the cluster reconnected (new *nats.Conn) the stale
// subscriptions are torn down and re-created so the watch keeps working.
func (ins *Inspector) ensureDLQWatch(clusterID string) (*dlqWatcher, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}

	ins.dlqMu.Lock()
	defer ins.dlqMu.Unlock()

	if w, ok := ins.dlqWatchers[clusterID]; ok {
		if w.nc == mc.NC {
			return w, nil // already watching the current connection
		}
		for _, s := range w.subs { // stale connection — drop old subs
			_ = s.Unsubscribe()
		}
		delete(ins.dlqWatchers, clusterID)
	}

	w := &dlqWatcher{nc: mc.NC, started: time.Now()}
	for _, subj := range []string{dlqMaxDeliverSubject, dlqTerminatedSubject} {
		sub, err := mc.NC.Subscribe(subj, w.ingest)
		if err != nil {
			for _, s := range w.subs {
				_ = s.Unsubscribe()
			}
			return nil, fmt.Errorf("subscribe %s: %w", subj, err)
		}
		w.subs = append(w.subs, sub)
	}
	ins.dlqWatchers[clusterID] = w
	slog.Info("dlq watch started", "cluster", clusterID)
	return w, nil
}

// ListDeadLetters returns the buffered poison events (newest first) for a cluster,
// starting the advisory watch on first call. Because the watch runs server-side
// and only buffers, this returns instantly and never scans the streams.
func (ins *Inspector) ListDeadLetters(clusterID string) (*types.DeadLetterList, error) {
	w, err := ins.ensureDLQWatch(clusterID)
	if err != nil {
		return nil, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	out := make([]types.DeadLetter, len(w.events))
	for i, e := range w.events { // reverse: newest first
		out[len(w.events)-1-i] = e
	}
	return &types.DeadLetterList{
		Events:        out,
		Count:         len(out),
		WatchingSince: w.started,
	}, nil
}

// GetDeadLetterMessage lazily fetches the underlying stream message for one poison
// event. Found is false (not an error) when the message is already gone.
func (ins *Inspector) GetDeadLetterMessage(_ context.Context, clusterID, stream string, seq uint64) (*types.DeadLetterMessage, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	raw, err := mc.JS.GetMsg(stream, seq)
	if err != nil {
		// The advisory outlives the message — it may have been acked/purged/aged out.
		return &types.DeadLetterMessage{Stream: stream, Seq: seq, Found: false}, nil
	}
	payload := string(raw.Data)
	return &types.DeadLetterMessage{
		Stream:      stream,
		Seq:         raw.Sequence,
		Subject:     raw.Subject,
		Payload:     payload,
		PayloadSize: len(raw.Data),
		Headers:     extractHeaders(raw.Header),
		Timestamp:   raw.Time,
		Found:       true,
	}, nil
}

// RedeliverDeadLetter re-publishes the offending message back to its original
// subject so it gets delivered again (the manual "retry" for a poison message).
// A Nats-Dlq-Redelivered header marks it so downstream can tell it was retried.
func (ins *Inspector) RedeliverDeadLetter(ctx context.Context, clusterID, stream string, seq uint64) (*types.PublishResult, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	raw, err := mc.JS.GetMsg(stream, seq)
	if err != nil {
		return nil, fmt.Errorf("message %d not found in %s (already removed?): %w", seq, stream, err)
	}

	msg := natsgo.NewMsg(raw.Subject)
	msg.Data = raw.Data
	for k, vals := range raw.Header {
		for _, v := range vals {
			msg.Header.Add(k, v)
		}
	}
	msg.Header.Set("Nats-Dlq-Redelivered", fmt.Sprintf("%s:%d", stream, seq))

	ack, err := mc.JS.PublishMsg(msg, natsgo.Context(ctx))
	if err != nil {
		// Subject isn't captured by a stream anymore — fall back to core publish.
		if perr := mc.NC.PublishMsg(msg); perr != nil {
			return nil, fmt.Errorf("redeliver %s seq %d: %w", stream, seq, perr)
		}
		return &types.PublishResult{Subject: raw.Subject, Accepted: true}, nil
	}
	return &types.PublishResult{Subject: raw.Subject, Stream: ack.Stream, Seq: ack.Sequence, Accepted: true}, nil
}

// ClearDeadLetters empties a cluster's poison-event buffer (the advisory watch
// keeps running and will collect new events).
func (ins *Inspector) ClearDeadLetters(clusterID string) {
	ins.dlqMu.Lock()
	w, ok := ins.dlqWatchers[clusterID]
	ins.dlqMu.Unlock()
	if !ok {
		return
	}
	w.mu.Lock()
	w.events = nil
	w.mu.Unlock()
}
