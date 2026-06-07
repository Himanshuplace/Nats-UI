package jetstream

import (
	"context"
	"fmt"
	"time"

	natsgo "github.com/nats-io/nats.go"
	jetstream "github.com/nats-io/nats.go/jetstream"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

const (
	debugSessionTTL = 2 * time.Minute
	debugFetchWait  = 3 * time.Second
	debugMaxBatch   = 50
)

type debugSession struct {
	clusterID string
	acks      map[string]string // messageID -> JetStream ack reply subject
	createdAt time.Time
}

// gcDebugSessionsLocked drops expired sessions. Caller must hold debugMu.
func (ins *Inspector) gcDebugSessionsLocked() {
	cutoff := time.Now().Add(-debugSessionTTL)
	for id, s := range ins.debugSessions {
		if s.createdAt.Before(cutoff) {
			delete(ins.debugSessions, id)
		}
	}
}

func headerMap(h natsgo.Header) map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := map[string]string{}
	for k, v := range h {
		if len(v) > 0 {
			out[k] = v[0]
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// DebugFetch binds to a PULL consumer by name and fetches up to batch messages
// WITHOUT acking them. The fetched messages stay pending on the consumer until
// the caller Acks/Naks/Terms them (or AckWait elapses and they're redelivered)
// — acting on the live consumer is what lets a developer clear poison messages.
//
// Uses the nats.go/jetstream API so it binds to the consumer regardless of its
// filter subject (the legacy PullSubscribe rejects a mismatched subject).
func (ins *Inspector) DebugFetch(ctx context.Context, clusterID, stream, consumer string, batch int) (*types.DebugFetchResult, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}
	if batch < 1 {
		batch = 1
	}
	if batch > debugMaxBatch {
		batch = debugMaxBatch
	}

	js, err := jetstream.New(mc.NC)
	if err != nil {
		return nil, fmt.Errorf("jetstream: %w", err)
	}
	cons, err := js.Consumer(ctx, stream, consumer)
	if err != nil {
		return nil, fmt.Errorf("bind consumer %s/%s (must be a pull consumer): %w", stream, consumer, err)
	}

	msgs, err := cons.Fetch(batch, jetstream.FetchMaxWait(debugFetchWait))
	if err != nil {
		return nil, fmt.Errorf("fetch from %s/%s: %w", stream, consumer, err)
	}

	sid := fmt.Sprintf("dbg-%d", time.Now().UnixNano())
	sess := &debugSession{clusterID: clusterID, acks: make(map[string]string), createdAt: time.Now()}
	out := make([]types.DebugMessage, 0, batch)

	i := 0
	for m := range msgs.Messages() {
		id := fmt.Sprintf("%s-%d", sid, i)
		i++
		sess.acks[id] = m.Reply()
		dm := types.DebugMessage{
			ID:      id,
			Subject: m.Subject(),
			Payload: string(m.Data()),
			Size:    len(m.Data()),
			Headers: headerMap(m.Headers()),
		}
		if meta, mErr := m.Metadata(); mErr == nil && meta != nil {
			dm.StreamSeq = meta.Sequence.Stream
			dm.ConsumerSeq = meta.Sequence.Consumer
			dm.NumDelivered = meta.NumDelivered
			dm.Timestamp = meta.Timestamp
		}
		out = append(out, dm)
	}
	if ferr := msgs.Error(); ferr != nil && len(out) == 0 {
		return nil, fmt.Errorf("fetch from %s/%s: %w", stream, consumer, ferr)
	}

	ins.debugMu.Lock()
	ins.gcDebugSessionsLocked()
	ins.debugSessions[sid] = sess
	ins.debugMu.Unlock()

	return &types.DebugFetchResult{SessionID: sid, Messages: out}, nil
}

// DebugAck applies ack | nak | term to one fetched message by publishing the
// JetStream ack token to its stored ack reply subject.
func (ins *Inspector) DebugAck(_ context.Context, clusterID, sessionID, messageID, action string) error {
	var token []byte
	switch action {
	case "ack":
		token = []byte("+ACK")
	case "nak":
		token = []byte("-NAK")
	case "term":
		token = []byte("+TERM")
	default:
		return fmt.Errorf("invalid action %q (want ack|nak|term)", action)
	}

	ins.debugMu.Lock()
	sess, ok := ins.debugSessions[sessionID]
	var ackSubj string
	if ok {
		ackSubj, ok = sess.acks[messageID]
	}
	ins.debugMu.Unlock()
	if !ok {
		return fmt.Errorf("message not found — the debug session may have expired")
	}
	if ackSubj == "" {
		return fmt.Errorf("this consumer has AckNone policy — nothing to ack")
	}

	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", clusterID)
	}
	if err := mc.NC.Publish(ackSubj, token); err != nil {
		return fmt.Errorf("%s %s: %w", action, messageID, err)
	}
	_ = mc.NC.Flush()

	ins.debugMu.Lock()
	if s, ok := ins.debugSessions[sessionID]; ok {
		delete(s.acks, messageID)
	}
	ins.debugMu.Unlock()
	return nil
}
