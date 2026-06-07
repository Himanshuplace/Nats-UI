package jetstream

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	natsgo "github.com/nats-io/nats.go"

	natsmgr "github.com/Himanshuplace/nats-ui/internal/nats"
	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// Inspector provides read access to JetStream state on a managed connection.
type Inspector struct {
	pool *natsmgr.Pool
}

func NewInspector(pool *natsmgr.Pool) *Inspector {
	return &Inspector{pool: pool}
}

// ── Streams ───────────────────────────────────────────────────────────────────

func (ins *Inspector) ListStreams(ctx context.Context, clusterID string) ([]types.StreamInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available on cluster %s", clusterID)
	}

	var streams []types.StreamInfo
	for info := range mc.JS.StreamsInfo(natsgo.Context(ctx)) {
		si := buildStreamInfo(clusterID, info)
		streams = append(streams, si)
	}
	return streams, nil
}

func (ins *Inspector) GetStream(ctx context.Context, clusterID, name string) (*types.StreamInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	info, err := mc.JS.StreamInfo(name, natsgo.Context(ctx))
	if err != nil {
		return nil, fmt.Errorf("stream info %s: %w", name, err)
	}
	si := buildStreamInfo(clusterID, info)
	return &si, nil
}

func buildStreamInfo(clusterID string, info *natsgo.StreamInfo) types.StreamInfo {
	si := types.StreamInfo{
		ClusterID: clusterID,
		Created:   info.Created,
		Config: types.StreamConfig{
			Name:        info.Config.Name,
			Description: info.Config.Description,
			Subjects:    info.Config.Subjects,
			Replicas:    info.Config.Replicas,
			MaxAge:      info.Config.MaxAge,
			MaxBytes:    info.Config.MaxBytes,
			MaxMsgs:     info.Config.MaxMsgs,
			MaxMsgSize:  info.Config.MaxMsgSize,
			Retention:   mapRetentionPolicy(info.Config.Retention),
			Storage:     mapStorageType(info.Config.Storage),
			Discard:     mapDiscardPolicy(info.Config.Discard),
			Duplicates:  info.Config.Duplicates,
			NoAck:       info.Config.NoAck,
		},
		State: types.StreamState{
			Messages:    info.State.Msgs,
			Bytes:       info.State.Bytes,
			FirstSeq:    info.State.FirstSeq,
			FirstTime:   info.State.FirstTime,
			LastSeq:     info.State.LastSeq,
			LastTime:    info.State.LastTime,
			NumSubjects: int(info.State.NumSubjects),
			NumDeleted:  uint64(info.State.NumDeleted),
		},
	}
	si.Health = streamHealth(si)
	return si
}

// ListSubjects returns all known NATS subjects from stream configs and consumer filter subjects.
// Useful for publisher auto-complete.
func (ins *Inspector) ListSubjects(ctx context.Context, clusterID string) ([]types.SubjectInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available on cluster %s", clusterID)
	}

	seen := make(map[string]bool)
	var subjects []types.SubjectInfo

	for info := range mc.JS.StreamsInfo(natsgo.Context(ctx)) {
		for _, subj := range info.Config.Subjects {
			if !seen[subj] {
				seen[subj] = true
				subjects = append(subjects, types.SubjectInfo{
					Subject: subj,
					Stream:  info.Config.Name,
					Source:  "stream",
				})
			}
		}
		// Collect consumer filter subjects for this stream
		for ci := range mc.JS.ConsumersInfo(info.Config.Name, natsgo.Context(ctx)) {
			if ci.Config.FilterSubject != "" && !seen[ci.Config.FilterSubject] {
				seen[ci.Config.FilterSubject] = true
				subjects = append(subjects, types.SubjectInfo{
					Subject: ci.Config.FilterSubject,
					Stream:  info.Config.Name,
					Source:  "consumer",
				})
			}
		}
	}
	return subjects, nil
}

func (ins *Inspector) CreateStream(ctx context.Context, clusterID string, cfg types.StreamConfig) (*types.StreamInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available on cluster %s", clusterID)
	}
	info, err := mc.JS.AddStream(streamConfigToJS(cfg), natsgo.Context(ctx))
	if err != nil {
		return nil, fmt.Errorf("create stream %s: %w", cfg.Name, err)
	}
	si := buildStreamInfo(clusterID, info)
	return &si, nil
}

func (ins *Inspector) UpdateStream(ctx context.Context, clusterID string, cfg types.StreamConfig) (*types.StreamInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available on cluster %s", clusterID)
	}
	info, err := mc.JS.UpdateStream(streamConfigToJS(cfg), natsgo.Context(ctx))
	if err != nil {
		return nil, fmt.Errorf("update stream %s: %w", cfg.Name, err)
	}
	si := buildStreamInfo(clusterID, info)
	return &si, nil
}

func (ins *Inspector) DeleteStream(ctx context.Context, clusterID, name string) error {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return fmt.Errorf("jetstream not available")
	}
	return mc.JS.DeleteStream(name, natsgo.Context(ctx))
}

// streamConfigToJS converts our StreamConfig to nats.go StreamConfig.
func streamConfigToJS(cfg types.StreamConfig) *natsgo.StreamConfig {
	jsCfg := &natsgo.StreamConfig{
		Name:        cfg.Name,
		Description: cfg.Description,
		Subjects:    cfg.Subjects,
		Replicas:    cfg.Replicas,
		MaxAge:      cfg.MaxAge,
		MaxBytes:    cfg.MaxBytes,
		MaxMsgs:     cfg.MaxMsgs,
		MaxMsgSize:  cfg.MaxMsgSize,
		NoAck:       cfg.NoAck,
		Duplicates:  cfg.Duplicates,
	}
	switch cfg.Retention {
	case types.RetentionInterest:
		jsCfg.Retention = natsgo.InterestPolicy
	case types.RetentionWorkQueue:
		jsCfg.Retention = natsgo.WorkQueuePolicy
	default:
		jsCfg.Retention = natsgo.LimitsPolicy
	}
	switch cfg.Storage {
	case types.StorageMemory:
		jsCfg.Storage = natsgo.MemoryStorage
	default:
		jsCfg.Storage = natsgo.FileStorage
	}
	switch cfg.Discard {
	case types.DiscardNew:
		jsCfg.Discard = natsgo.DiscardNew
	default:
		jsCfg.Discard = natsgo.DiscardOld
	}
	return jsCfg
}

// ── Consumers ─────────────────────────────────────────────────────────────────

func (ins *Inspector) ListConsumers(ctx context.Context, clusterID, stream string) ([]types.ConsumerInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	var consumers []types.ConsumerInfo
	for info := range mc.JS.ConsumersInfo(stream, natsgo.Context(ctx)) {
		ci := buildConsumerInfo(clusterID, stream, info)
		consumers = append(consumers, ci)
	}
	return consumers, nil
}

func (ins *Inspector) GetConsumer(ctx context.Context, clusterID, stream, name string) (*types.ConsumerInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}
	info, err := mc.JS.ConsumerInfo(stream, name, natsgo.Context(ctx))
	if err != nil {
		return nil, fmt.Errorf("consumer info %s/%s: %w", stream, name, err)
	}
	ci := buildConsumerInfo(clusterID, stream, info)
	return &ci, nil
}

func (ins *Inspector) CreateConsumer(ctx context.Context, clusterID, stream string, cfg types.ConsumerConfig) (*types.ConsumerInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	jsCfg := &natsgo.ConsumerConfig{
		Name:           cfg.Name,
		Durable:        cfg.DurableName,
		Description:    cfg.Description,
		FilterSubject:  cfg.FilterSubject,
		DeliverSubject: cfg.DeliverSubject,
		DeliverGroup:   cfg.DeliverGroup,
		MaxDeliver:     cfg.MaxDeliver,
		MaxAckPending:  cfg.MaxAckPending,
		AckWait:        cfg.AckWait,
		OptStartSeq:    cfg.OptStartSeq,
		OptStartTime:   cfg.OptStartTime,
	}

	switch cfg.DeliverPolicy {
	case types.DeliverAll:
		jsCfg.DeliverPolicy = natsgo.DeliverAllPolicy
	case types.DeliverLast:
		jsCfg.DeliverPolicy = natsgo.DeliverLastPolicy
	case types.DeliverNew:
		jsCfg.DeliverPolicy = natsgo.DeliverNewPolicy
	case types.DeliverBySeq:
		jsCfg.DeliverPolicy = natsgo.DeliverByStartSequencePolicy
	case types.DeliverByTime:
		jsCfg.DeliverPolicy = natsgo.DeliverByStartTimePolicy
	default:
		jsCfg.DeliverPolicy = natsgo.DeliverAllPolicy
	}

	switch cfg.AckPolicy {
	case types.AckNone:
		jsCfg.AckPolicy = natsgo.AckNonePolicy
	case types.AckAll:
		jsCfg.AckPolicy = natsgo.AckAllPolicy
	default:
		jsCfg.AckPolicy = natsgo.AckExplicitPolicy
	}

	switch cfg.ReplayPolicy {
	case types.ReplayOriginal:
		jsCfg.ReplayPolicy = natsgo.ReplayOriginalPolicy
	default:
		jsCfg.ReplayPolicy = natsgo.ReplayInstantPolicy
	}

	info, err := mc.JS.AddConsumer(stream, jsCfg, natsgo.Context(ctx))
	if err != nil {
		return nil, fmt.Errorf("add consumer: %w", err)
	}
	ci := buildConsumerInfo(clusterID, stream, info)
	return &ci, nil
}

func (ins *Inspector) DeleteConsumer(ctx context.Context, clusterID, stream, name string) error {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return fmt.Errorf("jetstream not available")
	}
	return mc.JS.DeleteConsumer(stream, name, natsgo.Context(ctx))
}

func buildConsumerInfo(clusterID, stream string, info *natsgo.ConsumerInfo) types.ConsumerInfo {
	var optStartTime *time.Time
	if info.Config.OptStartTime != nil && !info.Config.OptStartTime.IsZero() {
		t := *info.Config.OptStartTime
		optStartTime = &t
	}
	ci := types.ConsumerInfo{
		Stream:    stream,
		Name:      info.Name,
		Created:   info.Created,
		ClusterID: clusterID,
		Config: types.ConsumerConfig{
			Name:           info.Config.Name,
			DurableName:    info.Config.Durable,
			Description:    info.Config.Description,
			DeliverSubject: info.Config.DeliverSubject,
			DeliverGroup:   info.Config.DeliverGroup,
			FilterSubject:  info.Config.FilterSubject,
			MaxDeliver:     info.Config.MaxDeliver,
			MaxAckPending:  info.Config.MaxAckPending,
			AckWait:        info.Config.AckWait,
			OptStartSeq:    info.Config.OptStartSeq,
			OptStartTime:   optStartTime,
			DeliverPolicy:  mapDeliverPolicy(info.Config.DeliverPolicy),
			AckPolicy:      mapAckPolicy(info.Config.AckPolicy),
			ReplayPolicy:   mapReplayPolicy(info.Config.ReplayPolicy),
		},
		Delivered: types.ConsumerSequenceInfo{
			ConsumerSeq: info.Delivered.Consumer,
			StreamSeq:   info.Delivered.Stream,
		},
		AckFloor: types.ConsumerSequenceInfo{
			ConsumerSeq: info.AckFloor.Consumer,
			StreamSeq:   info.AckFloor.Stream,
		},
		NumAckPending:  info.NumAckPending,
		NumRedelivered: info.NumRedelivered,
		NumWaiting:     info.NumWaiting,
		NumPending:     info.NumPending,
		Lag:            info.NumPending,
	}
	ci.Health = consumerHealth(ci)
	return ci
}

// ── Tail (stream-bound JetStream) ─────────────────────────────────────────────

func (ins *Inspector) TailStream(ctx context.Context, clusterID, stream string, fn func(types.TailedMessage)) error {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return fmt.Errorf("jetstream not available")
	}

	sub, err := mc.JS.Subscribe(">", func(msg *natsgo.Msg) {
		meta, _ := msg.Metadata()
		tm := types.TailedMessage{
			ClusterID:   clusterID,
			Stream:      stream,
			Subject:     msg.Subject,
			PayloadText: string(msg.Data),
			Payload:     string(msg.Data),
			PayloadSize: len(msg.Data),
			Headers:     extractHeaders(msg.Header),
			ReplyTo:     msg.Reply,
		}
		if meta != nil {
			tm.Seq = meta.Sequence.Stream
			tm.Timestamp = meta.Timestamp
			tm.Redelivered = meta.NumDelivered > 1
		}
		fn(tm)
	},
		natsgo.BindStream(stream),
		natsgo.DeliverNew(), // live tail: only messages published after start
		natsgo.AckNone(),
		natsgo.Context(ctx),
	)
	if err != nil {
		return fmt.Errorf("subscribe tail: %w", err)
	}

	<-ctx.Done()
	sub.Unsubscribe()
	slog.Info("stream tail stopped", "stream", stream, "cluster", clusterID)
	return nil
}

// TailSubject starts a raw NATS subscribe on a subject pattern (no JetStream stream binding).
// Supports standard NATS wildcards: * (single token), > (rest of subject).
func (ins *Inspector) TailSubject(ctx context.Context, clusterID, subject string, fn func(types.TailedMessage)) error {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", clusterID)
	}

	sub, err := mc.NC.Subscribe(subject, func(msg *natsgo.Msg) {
		fn(types.TailedMessage{
			ClusterID:     clusterID,
			Stream:        "",
			SubjectFilter: subject,
			Subject:       msg.Subject,
			Timestamp:     time.Now(),
			PayloadText:   string(msg.Data),
			Payload:       string(msg.Data),
			PayloadSize:   len(msg.Data),
			Headers:       extractHeaders(msg.Header),
			ReplyTo:       msg.Reply,
		})
	})
	if err != nil {
		return fmt.Errorf("subscribe subject %q: %w", subject, err)
	}

	<-ctx.Done()
	sub.Unsubscribe()
	slog.Info("subject tail stopped", "subject", subject, "cluster", clusterID)
	return nil
}

// ── Topology live flow ────────────────────────────────────────────────────────

// FlowEvent is a lightweight sample of one real message crossing the wire. It
// deliberately carries no payload — only what the topology animation needs.
type FlowEvent struct {
	ClusterID string `json:"clusterId"`
	Subject   string `json:"subject"`
	Size      int    `json:"size"`
	Internal  bool   `json:"internal"` // true for NATS/JetStream plumbing ($…, _…)
}

// isInternalSubject reports whether subj is NATS/JetStream internal plumbing
// rather than real application traffic. Internal subjects always begin with
// '$' (system account, JetStream API/acks, KV/Object buckets, MQTT, NRG, …) or
// '_' (request-reply _INBOX.> and _R_.> reply inboxes). Application subjects do
// not use these reserved prefixes, so this cleanly separates the messages a
// developer actually publishes/receives from the cluster's own chatter.
func isInternalSubject(subj string) bool {
	if subj == "" {
		return false
	}
	switch subj[0] {
	case '$', '_':
		return true
	default:
		return false
	}
}

// FlowSample subscribes to all subjects (">") and forwards a rate-capped sample
// of real messages to fn. Internal NATS/JetStream subjects are filtered out so
// only genuine application traffic reaches the topology. The cap protects the
// WebSocket from high-throughput servers while keeping the animation driven
// entirely by real traffic (no synthetic messages). Blocks until ctx is
// cancelled.
func (ins *Inspector) FlowSample(ctx context.Context, clusterID string, includeInternal bool, fn func(FlowEvent)) error {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", clusterID)
	}

	const window = 250 * time.Millisecond
	const maxPerWindow = 12 // ~48 forwarded events/sec ceiling

	var count int32
	ticker := time.NewTicker(window)
	defer ticker.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				atomic.StoreInt32(&count, 0)
			}
		}
	}()

	sub, err := mc.NC.Subscribe(">", func(msg *natsgo.Msg) {
		internal := isInternalSubject(msg.Subject)
		// External-only (the default): drop NATS/JetStream internal plumbing
		// ($SYS, $JS, $KV, request-reply _INBOX, …) so the topology shows just
		// the messages real publishers/subscribers send & receive. When the
		// client toggles "All traffic", includeInternal forwards everything.
		if internal && !includeInternal {
			return
		}
		// Over the per-window cap → drop. Still real traffic, just sampled.
		if atomic.AddInt32(&count, 1) > maxPerWindow {
			return
		}
		fn(FlowEvent{ClusterID: clusterID, Subject: msg.Subject, Size: len(msg.Data), Internal: internal})
	})
	if err != nil {
		return fmt.Errorf("subscribe flow %q: %w", clusterID, err)
	}

	<-ctx.Done()
	sub.Unsubscribe()
	slog.Info("topology flow stopped", "cluster", clusterID)
	return nil
}

// ── Message browser ───────────────────────────────────────────────────────────

// FetchMessages retrieves stored messages from a JetStream stream.
// startSeq=0 starts from the first available message.
// limit is capped at 200. subjectFilter="" returns all subjects.
func (ins *Inspector) FetchMessages(ctx context.Context, clusterID, stream string, startSeq uint64, limit int, subjectFilter string) ([]types.StoredMessage, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	si, err := mc.JS.StreamInfo(stream, natsgo.Context(ctx))
	if err != nil {
		return nil, fmt.Errorf("stream info: %w", err)
	}

	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if startSeq == 0 || startSeq < si.State.FirstSeq {
		startSeq = si.State.FirstSeq
	}

	var out []types.StoredMessage
	for seq := startSeq; seq <= si.State.LastSeq && len(out) < limit; seq++ {
		select {
		case <-ctx.Done():
			return out, nil
		default:
		}

		raw, err := mc.JS.GetMsg(stream, seq)
		if err != nil {
			continue // deleted / compacted gap — skip
		}

		if subjectFilter != "" && !natsMatch(subjectFilter, raw.Subject) {
			continue
		}

		headers := make(map[string]string)
		for k, vals := range raw.Header {
			if len(vals) > 0 {
				headers[k] = vals[0]
			}
		}

		payload := string(raw.Data)
		out = append(out, types.StoredMessage{
			Stream:      stream,
			ClusterID:   clusterID,
			Subject:     raw.Subject,
			Seq:         raw.Sequence,
			Timestamp:   raw.Time,
			Payload:     payload,
			PayloadText: payload,
			PayloadSize: len(raw.Data),
			Headers:     headers,
		})
	}
	return out, nil
}

// ── Publisher ─────────────────────────────────────────────────────────────────

// Publish sends a message to a subject. Prefers JetStream publish (returns stream+seq);
// falls back to core NATS publish when the subject is not captured by any stream.
func (ins *Inspector) Publish(ctx context.Context, clusterID string, req types.PublishRequest) (*types.PublishResult, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}

	msg := natsgo.NewMsg(req.Subject)
	msg.Data = []byte(req.Payload)
	if req.ReplyTo != "" {
		msg.Reply = req.ReplyTo
	}
	for k, v := range req.Headers {
		msg.Header.Set(k, v)
	}

	if mc.IsJetStream() {
		if ack, err := mc.JS.PublishMsg(msg, natsgo.Context(ctx)); err == nil {
			return &types.PublishResult{
				Subject:  req.Subject,
				Stream:   ack.Stream,
				Seq:      ack.Sequence,
				Accepted: true,
			}, nil
		}
		// No stream captured this subject — send as core NATS
	}

	if err := mc.NC.PublishMsg(msg); err != nil {
		return nil, fmt.Errorf("publish %q: %w", req.Subject, err)
	}
	return &types.PublishResult{Subject: req.Subject, Accepted: true}, nil
}

// ── Replay ────────────────────────────────────────────────────────────────────

func (ins *Inspector) ReplayStream(ctx context.Context, cfg types.ReplayConfig, progressFn func(types.ReplayProgress)) error {
	mc, ok := ins.pool.Get(cfg.ClusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", cfg.ClusterID)
	}
	if !mc.IsJetStream() {
		return fmt.Errorf("jetstream not available")
	}

	// Determine total message count from stream state.
	si, err := mc.JS.StreamInfo(cfg.Stream, natsgo.Context(ctx))
	if err != nil {
		return fmt.Errorf("stream info for replay: %w", err)
	}
	lastSeq := si.State.LastSeq
	startSeqActual := si.State.FirstSeq
	if cfg.StartSeq != nil && *cfg.StartSeq > startSeqActual {
		startSeqActual = *cfg.StartSeq
	}
	endSeqActual := lastSeq
	if cfg.EndSeq != nil && *cfg.EndSeq < endSeqActual {
		endSeqActual = *cfg.EndSeq
	}
	var totalMsgs uint64
	if endSeqActual >= startSeqActual {
		totalMsgs = endSeqActual - startSeqActual + 1
	}

	var opts []natsgo.SubOpt
	opts = append(opts, natsgo.BindStream(cfg.Stream))
	opts = append(opts, natsgo.AckNone())
	opts = append(opts, natsgo.Context(ctx))

	if cfg.StartSeq != nil {
		opts = append(opts, natsgo.StartSequence(*cfg.StartSeq))
	} else if cfg.StartTime != nil {
		opts = append(opts, natsgo.StartTime(*cfg.StartTime))
	} else {
		opts = append(opts, natsgo.DeliverAll())
	}

	var processed uint64
	start := time.Now()
	done := make(chan struct{}, 1)

	var sub *natsgo.Subscription
	sub, err = mc.JS.Subscribe(">", func(msg *natsgo.Msg) {
		meta, _ := msg.Metadata()
		processed++
		var seq uint64
		if meta != nil {
			seq = meta.Sequence.Stream
		}

		elapsed := time.Since(start)
		progress := types.ReplayProgress{
			ID:         cfg.ID,
			CurrentSeq: seq,
			TotalMsgs:  totalMsgs,
			Processed:  processed,
			ElapsedMs:  elapsed.Milliseconds(),
		}
		if elapsed.Seconds() > 0 {
			progress.Rate = float64(processed) / elapsed.Seconds()
		}
		progressFn(progress)

		if cfg.ThrottleMs > 0 {
			time.Sleep(time.Duration(cfg.ThrottleMs) * time.Millisecond)
		}

		// Auto-finish: stop when we've reached the effective end sequence.
		reachedEnd := (cfg.EndSeq != nil && seq >= *cfg.EndSeq) ||
			(cfg.EndSeq == nil && seq >= lastSeq && si.State.Msgs > 0)
		if reachedEnd {
			sub.Unsubscribe()
			progressFn(types.ReplayProgress{
				ID:        cfg.ID,
				TotalMsgs: totalMsgs,
				Processed: processed,
				Done:      true,
				ElapsedMs: time.Since(start).Milliseconds(),
			})
			select {
			case done <- struct{}{}:
			default:
			}
		}
	}, opts...)
	if err != nil {
		return fmt.Errorf("replay subscribe: %w", err)
	}

	select {
	case <-ctx.Done():
	case <-done:
	}
	sub.Unsubscribe()
	return nil
}

// ── Policy mappers ────────────────────────────────────────────────────────────

func mapAckPolicy(p natsgo.AckPolicy) types.AckPolicy {
	switch p {
	case natsgo.AckNonePolicy:
		return types.AckNone
	case natsgo.AckAllPolicy:
		return types.AckAll
	default:
		return types.AckExplicit
	}
}

func mapDeliverPolicy(p natsgo.DeliverPolicy) types.DeliverPolicy {
	switch p {
	case natsgo.DeliverLastPolicy:
		return types.DeliverLast
	case natsgo.DeliverNewPolicy:
		return types.DeliverNew
	case natsgo.DeliverByStartSequencePolicy:
		return types.DeliverBySeq
	case natsgo.DeliverByStartTimePolicy:
		return types.DeliverByTime
	default:
		return types.DeliverAll
	}
}

func mapReplayPolicy(p natsgo.ReplayPolicy) types.ReplayPolicy {
	switch p {
	case natsgo.ReplayOriginalPolicy:
		return types.ReplayOriginal
	default:
		return types.ReplayInstant
	}
}

// ── NATS subject matching ─────────────────────────────────────────────────────

// natsMatch returns true when pattern matches subject using NATS wildcard rules:
// '*' matches exactly one token, '>' matches one or more tokens at the end.
func natsMatch(pattern, subject string) bool {
	if pattern == "" {
		return true
	}
	return matchParts(strings.Split(pattern, "."), strings.Split(subject, "."))
}

func matchParts(pp, sp []string) bool {
	if len(pp) == 0 {
		return len(sp) == 0
	}
	if pp[0] == ">" {
		return len(sp) > 0
	}
	if len(sp) == 0 {
		return false
	}
	if pp[0] != "*" && pp[0] != sp[0] {
		return false
	}
	return matchParts(pp[1:], sp[1:])
}

// ── Health heuristics ─────────────────────────────────────────────────────────

func streamHealth(s types.StreamInfo) string {
	if s.State.NumDeleted > 0 && s.State.Messages > 0 {
		ratio := float64(s.State.NumDeleted) / float64(s.State.Messages+s.State.NumDeleted)
		if ratio > 0.1 {
			return "degraded"
		}
	}
	return "ok"
}

func consumerHealth(c types.ConsumerInfo) string {
	if c.Lag > 100000 {
		return "slow"
	}
	if c.NumRedelivered > 1000 {
		return "redelivery_storm"
	}
	if c.Lag > 10000 {
		return "lagging"
	}
	return "ok"
}

func mapRetentionPolicy(p natsgo.RetentionPolicy) types.RetentionPolicy {
	switch p {
	case natsgo.InterestPolicy:
		return types.RetentionInterest
	case natsgo.WorkQueuePolicy:
		return types.RetentionWorkQueue
	default:
		return types.RetentionLimits
	}
}

func mapStorageType(s natsgo.StorageType) types.StorageType {
	switch s {
	case natsgo.MemoryStorage:
		return types.StorageMemory
	default:
		return types.StorageFile
	}
}

func mapDiscardPolicy(d natsgo.DiscardPolicy) types.DiscardPolicy {
	switch d {
	case natsgo.DiscardNew:
		return types.DiscardNew
	default:
		return types.DiscardOld
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func extractHeaders(h natsgo.Header) map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string]string, len(h))
	for k, vals := range h {
		if len(vals) > 0 {
			out[k] = vals[0]
		}
	}
	return out
}
