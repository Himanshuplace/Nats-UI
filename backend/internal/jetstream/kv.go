package jetstream

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	natsgo "github.com/nats-io/nats.go"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// maxKVKeys caps how many keys we hydrate with values in one bucket listing,
// so a huge bucket can't stall the UI. The list is sorted, so it's the first N.
const maxKVKeys = 1000

func (ins *Inspector) jsContext(clusterID string) (natsgo.JetStreamContext, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if !mc.IsJetStream() {
		return nil, fmt.Errorf("jetstream not available on cluster %s", clusterID)
	}
	return mc.JS, nil
}

func kvOp(op natsgo.KeyValueOp) string {
	switch op {
	case natsgo.KeyValueDelete:
		return "DELETE"
	case natsgo.KeyValuePurge:
		return "PURGE"
	default:
		return "PUT"
	}
}

func kvEntry(e natsgo.KeyValueEntry) types.KVEntry {
	val := e.Value()
	return types.KVEntry{
		Bucket:    e.Bucket(),
		Key:       e.Key(),
		Value:     string(val),
		Revision:  e.Revision(),
		Created:   e.Created(),
		Operation: kvOp(e.Operation()),
		Size:      len(val),
	}
}

// ── Buckets ─────────────────────────────────────────────────────────────────────

// ListKVBuckets returns every KV bucket with summary stats.
func (ins *Inspector) ListKVBuckets(_ context.Context, clusterID string) ([]types.KVBucketInfo, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	out := []types.KVBucketInfo{}
	for status := range js.KeyValueStores() {
		out = append(out, types.KVBucketInfo{
			Bucket:  status.Bucket(),
			Values:  status.Values(),
			History: status.History(),
			TTL:     int64(status.TTL()),
			Bytes:   status.Bytes(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Bucket < out[j].Bucket })
	return out, nil
}

// CreateKVBucket provisions a new KV bucket.
func (ins *Inspector) CreateKVBucket(_ context.Context, clusterID string, cfg types.KVBucketConfig) (*types.KVBucketInfo, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	history := cfg.History
	if history < 1 {
		history = 1
	}
	if history > 64 {
		history = 64
	}
	replicas := cfg.Replicas
	if replicas < 1 {
		replicas = 1
	}
	storage := natsgo.FileStorage
	if cfg.Storage == "memory" {
		storage = natsgo.MemoryStorage
	}
	kvc := &natsgo.KeyValueConfig{
		Bucket:       cfg.Bucket,
		Description:  cfg.Description,
		History:      uint8(history),
		TTL:          time.Duration(cfg.TTL) * time.Second,
		Storage:      storage,
		Replicas:     replicas,
		MaxValueSize: cfg.MaxValueSize,
	}
	kv, err := js.CreateKeyValue(kvc)
	if err != nil {
		return nil, fmt.Errorf("create kv bucket %s: %w", cfg.Bucket, err)
	}
	st, err := kv.Status()
	if err != nil {
		return &types.KVBucketInfo{Bucket: cfg.Bucket, History: int64(history), Replicas: replicas}, nil
	}
	return &types.KVBucketInfo{
		Bucket:   st.Bucket(),
		Values:   st.Values(),
		History:  st.History(),
		TTL:      int64(st.TTL()),
		Bytes:    st.Bytes(),
		Replicas: replicas,
	}, nil
}

// DeleteKVBucket removes a KV bucket and all its data.
func (ins *Inspector) DeleteKVBucket(_ context.Context, clusterID, bucket string) error {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return err
	}
	if err := js.DeleteKeyValue(bucket); err != nil {
		return fmt.Errorf("delete kv bucket %s: %w", bucket, err)
	}
	return nil
}

// ── Keys ────────────────────────────────────────────────────────────────────────

// ListKVKeys returns each live key's latest value/revision (capped at maxKVKeys).
func (ins *Inspector) ListKVKeys(_ context.Context, clusterID, bucket string) ([]types.KVEntry, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	kv, err := js.KeyValue(bucket)
	if err != nil {
		return nil, fmt.Errorf("open kv bucket %s: %w", bucket, err)
	}
	keys, err := kv.Keys()
	if err != nil {
		if errors.Is(err, natsgo.ErrNoKeysFound) {
			return []types.KVEntry{}, nil
		}
		return nil, fmt.Errorf("list keys in %s: %w", bucket, err)
	}
	sort.Strings(keys)
	if len(keys) > maxKVKeys {
		keys = keys[:maxKVKeys]
	}
	out := make([]types.KVEntry, 0, len(keys))
	for _, k := range keys {
		e, err := kv.Get(k)
		if err != nil {
			continue // key may have been deleted between Keys() and Get()
		}
		out = append(out, kvEntry(e))
	}
	return out, nil
}

// GetKVKey returns the current value of one key.
func (ins *Inspector) GetKVKey(_ context.Context, clusterID, bucket, key string) (*types.KVEntry, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	kv, err := js.KeyValue(bucket)
	if err != nil {
		return nil, fmt.Errorf("open kv bucket %s: %w", bucket, err)
	}
	e, err := kv.Get(key)
	if err != nil {
		return nil, fmt.Errorf("get %s/%s: %w", bucket, key, err)
	}
	ke := kvEntry(e)
	return &ke, nil
}

// GetKVHistory returns the revision history for a key (oldest → newest).
func (ins *Inspector) GetKVHistory(_ context.Context, clusterID, bucket, key string) ([]types.KVEntry, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	kv, err := js.KeyValue(bucket)
	if err != nil {
		return nil, fmt.Errorf("open kv bucket %s: %w", bucket, err)
	}
	hist, err := kv.History(key)
	if err != nil {
		if errors.Is(err, natsgo.ErrKeyNotFound) {
			return []types.KVEntry{}, nil
		}
		return nil, fmt.Errorf("history %s/%s: %w", bucket, key, err)
	}
	out := make([]types.KVEntry, 0, len(hist))
	for _, e := range hist {
		out = append(out, kvEntry(e))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Revision < out[j].Revision })
	return out, nil
}

// PutKVKey writes a value (creating or updating the key) and returns the new revision.
func (ins *Inspector) PutKVKey(_ context.Context, clusterID, bucket, key, value string) (uint64, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return 0, err
	}
	kv, err := js.KeyValue(bucket)
	if err != nil {
		return 0, fmt.Errorf("open kv bucket %s: %w", bucket, err)
	}
	rev, err := kv.PutString(key, value)
	if err != nil {
		return 0, fmt.Errorf("put %s/%s: %w", bucket, key, err)
	}
	return rev, nil
}

// DeleteKVKey writes a delete marker (history preserved).
func (ins *Inspector) DeleteKVKey(_ context.Context, clusterID, bucket, key string) error {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return err
	}
	kv, err := js.KeyValue(bucket)
	if err != nil {
		return fmt.Errorf("open kv bucket %s: %w", bucket, err)
	}
	if err := kv.Delete(key); err != nil {
		return fmt.Errorf("delete %s/%s: %w", bucket, key, err)
	}
	return nil
}

// PurgeKVKey removes a key and all its history.
func (ins *Inspector) PurgeKVKey(_ context.Context, clusterID, bucket, key string) error {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return err
	}
	kv, err := js.KeyValue(bucket)
	if err != nil {
		return fmt.Errorf("open kv bucket %s: %w", bucket, err)
	}
	if err := kv.Purge(key); err != nil {
		return fmt.Errorf("purge %s/%s: %w", bucket, key, err)
	}
	return nil
}
