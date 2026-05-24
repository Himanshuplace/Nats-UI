package jetstream

import (
	"context"
	"fmt"
	"log/slog"
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

// ListStreams returns all streams on the given cluster connection.
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
		streams = append(streams, si)
	}

	return streams, nil
}

// GetStream returns info for a single stream.
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

	si := &types.StreamInfo{
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
	si.Health = streamHealth(*si)
	return si, nil
}

// ListConsumers returns all consumers for a stream.
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
		ci := types.ConsumerInfo{
			Stream:    stream,
			Name:      info.Name,
			Created:   info.Created,
			ClusterID: clusterID,
			Config: types.ConsumerConfig{
				Name:          info.Config.Name,
				DurableName:   info.Config.Durable,
				Description:   info.Config.Description,
				FilterSubject: info.Config.FilterSubject,
				MaxDeliver:    info.Config.MaxDeliver,
				MaxAckPending: info.Config.MaxAckPending,
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
		consumers = append(consumers, ci)
	}

	return consumers, nil
}

// TailStream starts tailing messages from a stream and sends them to the callback.
// It runs until ctx is cancelled. Uses an ephemeral consumer (no Durable) so
// NATS auto-cleans it up when the subscription is closed.
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

		payload := string(msg.Data)
		headers := make(map[string]string)
		for k, vals := range msg.Header {
			if len(vals) > 0 {
				headers[k] = vals[0]
			}
		}

		tm := types.TailedMessage{
			ClusterID:   clusterID,
			Stream:      stream,
			Subject:     msg.Subject,
			PayloadText: payload,
			Payload:     payload,
			PayloadSize: len(msg.Data),
			Headers:     headers,
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
		natsgo.DeliverNew(),
		natsgo.AckNone(),
		natsgo.Context(ctx),
	)
	if err != nil {
		return fmt.Errorf("subscribe tail: %w", err)
	}

	<-ctx.Done()

	sub.Unsubscribe()
	slog.Info("tail stopped", "stream", stream, "cluster", clusterID)
	return nil
}

// GetConsumer returns info for a single consumer.
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
	ci := &types.ConsumerInfo{
		Stream:    stream,
		Name:      info.Name,
		Created:   info.Created,
		ClusterID: clusterID,
		Config: types.ConsumerConfig{
			Name:          info.Config.Name,
			DurableName:   info.Config.Durable,
			Description:   info.Config.Description,
			FilterSubject: info.Config.FilterSubject,
			MaxDeliver:    info.Config.MaxDeliver,
			MaxAckPending: info.Config.MaxAckPending,
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
	ci.Health = consumerHealth(*ci)
	return ci, nil
}

// ReplayStream replays messages from a stream according to the replay config.
// Calls progressFn periodically with progress updates.
func (ins *Inspector) ReplayStream(ctx context.Context, cfg types.ReplayConfig, progressFn func(types.ReplayProgress)) error {
	mc, ok := ins.pool.Get(cfg.ClusterID)
	if !ok {
		return fmt.Errorf("cluster %s not connected", cfg.ClusterID)
	}
	if !mc.IsJetStream() {
		return fmt.Errorf("jetstream not available")
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

	var sub *natsgo.Subscription
	var err error
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
			Processed:  processed,
			ElapsedMs:  elapsed.Milliseconds(),
		}
		if elapsed.Seconds() > 0 {
			progress.Rate = float64(processed) / elapsed.Seconds()
		}
		progressFn(progress)

		// Apply throttle
		if cfg.ThrottleMs > 0 {
			time.Sleep(time.Duration(cfg.ThrottleMs) * time.Millisecond)
		}

		// Stop at end seq
		if cfg.EndSeq != nil && seq >= *cfg.EndSeq {
			sub.Unsubscribe()
			progressFn(types.ReplayProgress{
				ID:        cfg.ID,
				Processed: processed,
				Done:      true,
				ElapsedMs: time.Since(start).Milliseconds(),
			})
		}
	}, opts...)
	if err != nil {
		return fmt.Errorf("replay subscribe: %w", err)
	}

	<-ctx.Done()
	sub.Unsubscribe()
	return nil
}

func streamHealth(s types.StreamInfo) string {
	// Heuristic: if lost messages is high relative to total, flag it
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
