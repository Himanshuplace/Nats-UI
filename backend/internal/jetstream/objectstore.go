package jetstream

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"time"

	natsgo "github.com/nats-io/nats.go"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// maxObjectBytes caps how big an object the UI will fetch for view/download
// (base64 inflates ~33% over the wire). Larger objects report TooLarge.
const maxObjectBytes = 16 << 20 // 16 MiB

func objectEntry(i *natsgo.ObjectInfo) types.ObjectEntry {
	return types.ObjectEntry{
		Name:        i.Name,
		Description: i.Description,
		Bucket:      i.Bucket,
		Size:        i.Size,
		Chunks:      i.Chunks,
		ModTime:     i.ModTime,
		Digest:      i.Digest,
		Headers:     headerMap(i.Headers),
	}
}

// ── Buckets ─────────────────────────────────────────────────────────────────────

func (ins *Inspector) ListObjectBuckets(_ context.Context, clusterID string) ([]types.ObjectBucketInfo, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	out := []types.ObjectBucketInfo{}
	for st := range js.ObjectStores() {
		out = append(out, types.ObjectBucketInfo{
			Bucket:      st.Bucket(),
			Description: st.Description(),
			Size:        st.Size(),
			TTL:         int64(st.TTL()),
			Replicas:    st.Replicas(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Bucket < out[j].Bucket })
	return out, nil
}

func (ins *Inspector) CreateObjectBucket(_ context.Context, clusterID string, cfg types.ObjectBucketConfig) (*types.ObjectBucketInfo, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	replicas := cfg.Replicas
	if replicas < 1 {
		replicas = 1
	}
	storage := natsgo.FileStorage
	if cfg.Storage == "memory" {
		storage = natsgo.MemoryStorage
	}
	os, err := js.CreateObjectStore(&natsgo.ObjectStoreConfig{
		Bucket:      cfg.Bucket,
		Description: cfg.Description,
		TTL:         time.Duration(cfg.TTL) * time.Second,
		Storage:     storage,
		Replicas:    replicas,
	})
	if err != nil {
		return nil, fmt.Errorf("create object bucket %s: %w", cfg.Bucket, err)
	}
	info := &types.ObjectBucketInfo{Bucket: cfg.Bucket, Replicas: replicas}
	if st, err := os.Status(); err == nil {
		info.Description = st.Description()
		info.Size = st.Size()
		info.TTL = int64(st.TTL())
	}
	return info, nil
}

func (ins *Inspector) DeleteObjectBucket(_ context.Context, clusterID, bucket string) error {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return err
	}
	if err := js.DeleteObjectStore(bucket); err != nil {
		return fmt.Errorf("delete object bucket %s: %w", bucket, err)
	}
	return nil
}

// ── Objects ─────────────────────────────────────────────────────────────────────

func (ins *Inspector) ListObjects(_ context.Context, clusterID, bucket string) ([]types.ObjectEntry, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	os, err := js.ObjectStore(bucket)
	if err != nil {
		return nil, fmt.Errorf("open object bucket %s: %w", bucket, err)
	}
	infos, err := os.List()
	if err != nil {
		if errors.Is(err, natsgo.ErrNoObjectsFound) {
			return []types.ObjectEntry{}, nil
		}
		return nil, fmt.Errorf("list objects in %s: %w", bucket, err)
	}
	out := make([]types.ObjectEntry, 0, len(infos))
	for _, i := range infos {
		if i.Deleted {
			continue
		}
		out = append(out, objectEntry(i))
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Name < out[b].Name })
	return out, nil
}

func (ins *Inspector) GetObject(_ context.Context, clusterID, bucket, name string) (*types.ObjectData, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	os, err := js.ObjectStore(bucket)
	if err != nil {
		return nil, fmt.Errorf("open object bucket %s: %w", bucket, err)
	}
	info, err := os.GetInfo(name)
	if err != nil {
		return nil, fmt.Errorf("object info %s/%s: %w", bucket, name, err)
	}
	if info.Size > maxObjectBytes {
		return &types.ObjectData{Name: name, Size: int(info.Size), TooLarge: true}, nil
	}
	data, err := os.GetBytes(name)
	if err != nil {
		return nil, fmt.Errorf("get %s/%s: %w", bucket, name, err)
	}
	return &types.ObjectData{Name: name, Size: len(data), Base64: base64.StdEncoding.EncodeToString(data)}, nil
}

func (ins *Inspector) PutObject(_ context.Context, clusterID, bucket, name string, data []byte) (*types.ObjectEntry, error) {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return nil, err
	}
	os, err := js.ObjectStore(bucket)
	if err != nil {
		return nil, fmt.Errorf("open object bucket %s: %w", bucket, err)
	}
	info, err := os.Put(&natsgo.ObjectMeta{Name: name}, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("put %s/%s: %w", bucket, name, err)
	}
	e := objectEntry(info)
	return &e, nil
}

func (ins *Inspector) DeleteObject(_ context.Context, clusterID, bucket, name string) error {
	js, err := ins.jsContext(clusterID)
	if err != nil {
		return err
	}
	os, err := js.ObjectStore(bucket)
	if err != nil {
		return fmt.Errorf("open object bucket %s: %w", bucket, err)
	}
	if err := os.Delete(name); err != nil {
		return fmt.Errorf("delete %s/%s: %w", bucket, name, err)
	}
	return nil
}
