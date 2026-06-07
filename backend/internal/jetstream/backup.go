package jetstream

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	natsgo "github.com/nats-io/nats.go"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

const (
	backupVersion     = 1
	backupMaxMessages = 50_000    // cap message count per backup
	backupMaxBytes    = 64 << 20  // cap cumulative raw payload at 64 MiB
)

// BackupStream captures a stream's config plus its stored messages into a
// portable, logical archive (see types.StreamBackup). Messages are read by
// sequence via GetMsg; gaps (deleted/expired) are skipped. The capture stops
// early — marking the backup Truncated — once the message-count or cumulative
// payload cap is reached, so a single backup can never exhaust memory.
func (ins *Inspector) BackupStream(ctx context.Context, clusterID, stream string) (*types.StreamBackup, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	si, err := mc.JS.StreamInfo(stream, natsgo.Context(ctx))
	if err != nil {
		return nil, fmt.Errorf("stream info %s: %w", stream, err)
	}

	bk := &types.StreamBackup{
		Version:    backupVersion,
		Stream:     stream,
		CapturedAt: time.Now().UTC(),
		Config:     buildStreamInfo(clusterID, si).Config,
		Messages:   []types.BackupMessage{},
	}

	var totalBytes int64
	for seq := si.State.FirstSeq; seq <= si.State.LastSeq; seq++ {
		select {
		case <-ctx.Done():
			bk.Truncated = true
			bk.MessageCount = len(bk.Messages)
			return bk, nil
		default:
		}
		if len(bk.Messages) >= backupMaxMessages || totalBytes >= backupMaxBytes {
			bk.Truncated = true
			break
		}

		raw, err := mc.JS.GetMsg(stream, seq)
		if err != nil {
			continue // gap — deleted/expired sequence
		}

		bk.Messages = append(bk.Messages, types.BackupMessage{
			Subject: raw.Subject,
			Seq:     raw.Sequence,
			Time:    raw.Time,
			Headers: headerMap(raw.Header),
			Data:    base64.StdEncoding.EncodeToString(raw.Data),
		})
		totalBytes += int64(len(raw.Data))
	}

	bk.MessageCount = len(bk.Messages)
	return bk, nil
}

// RestoreStream recreates a backup into a target stream by republishing every
// captured message to its original subject via JetStream. If the target stream
// is missing and CreateStream is set, it is first created from the backup's
// config (renamed to the target). Returns per-message restored/failed counts.
func (ins *Inspector) RestoreStream(ctx context.Context, clusterID string, req types.RestoreRequest) (*types.RestoreResult, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available")
	}

	target := req.TargetStream
	if target == "" {
		target = req.Backup.Stream
	}
	if target == "" {
		return nil, fmt.Errorf("no target stream and backup has no stream name")
	}

	res := &types.RestoreResult{TargetStream: target, Total: len(req.Backup.Messages)}

	// Ensure the target stream exists — optionally recreate it from the backup config.
	if _, err := mc.JS.StreamInfo(target, natsgo.Context(ctx)); err != nil {
		if !req.CreateStream {
			return nil, fmt.Errorf("target stream %q does not exist (enable \"create stream\" to recreate it from the backup config)", target)
		}
		cfg := req.Backup.Config
		cfg.Name = target
		if _, cErr := mc.JS.AddStream(streamConfigToJS(cfg), natsgo.Context(ctx)); cErr != nil {
			return nil, fmt.Errorf("create target stream %q: %w", target, cErr)
		}
		res.StreamCreated = true
	}

	for _, m := range req.Backup.Messages {
		select {
		case <-ctx.Done():
			res.Error = "cancelled"
			return res, nil
		default:
		}

		data, dErr := base64.StdEncoding.DecodeString(m.Data)
		if dErr != nil {
			res.Failed++
			continue
		}

		msg := natsgo.NewMsg(m.Subject)
		msg.Data = data
		for k, v := range m.Headers {
			msg.Header.Set(k, v)
		}

		if _, pErr := mc.JS.PublishMsg(msg, natsgo.Context(ctx)); pErr != nil {
			res.Failed++
			continue
		}
		res.Restored++
	}

	return res, nil
}
