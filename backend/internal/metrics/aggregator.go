package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/Himanshuplace/nats-ui/internal/gateway"
	natsmgr "github.com/Himanshuplace/nats-ui/internal/nats"
	"github.com/Himanshuplace/nats-ui/pkg/types"
)

type snapshot struct {
	inMsgs  int64
	outMsgs int64
	inBytes int64
	outBytes int64
	ts      time.Time
}

// Aggregator polls NATS monitoring endpoints and pushes metrics to the WebSocket hub.
type Aggregator struct {
	hub    *gateway.Hub
	pool   *natsmgr.Pool
	prev   map[string]snapshot
	mu     sync.Mutex
	client *http.Client
}

func NewAggregator(hub *gateway.Hub, pool *natsmgr.Pool) *Aggregator {
	return &Aggregator{
		hub:    hub,
		pool:   pool,
		prev:   make(map[string]snapshot),
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

// Run starts the metrics collection loop.
func (a *Aggregator) Run(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.collect(ctx)
		}
	}
}

func (a *Aggregator) collect(ctx context.Context) {
	for _, mc := range a.pool.List() {
		go a.collectConn(ctx, mc)
	}
}

func (a *Aggregator) collectConn(ctx context.Context, mc *natsmgr.ManagedConn) {
	varz, err := a.fetchVarz(ctx, mc.Profile.Host, mc.Profile.MonitorPort)
	if err != nil {
		slog.Warn("metrics collect failed", "id", mc.ID, "err", err)
		return
	}

	now := time.Now()
	cur := snapshot{
		inMsgs:  int64OrZero(varz["in_msgs"]),
		outMsgs: int64OrZero(varz["out_msgs"]),
		inBytes: int64OrZero(varz["in_bytes"]),
		outBytes: int64OrZero(varz["out_bytes"]),
		ts:       now,
	}

	a.mu.Lock()
	prev, hasPrev := a.prev[mc.ID]
	a.prev[mc.ID] = cur
	a.mu.Unlock()

	if !hasPrev {
		return
	}

	dt := cur.ts.Sub(prev.ts).Seconds()
	if dt <= 0 {
		return
	}

	point := types.ThroughputPoint{
		ClusterID: mc.ID,
		Timestamp: now,
		InMsgs:    int64(float64(cur.inMsgs-prev.inMsgs) / dt),
		OutMsgs:   int64(float64(cur.outMsgs-prev.outMsgs) / dt),
		InBytes:   int64(float64(cur.inBytes-prev.inBytes) / dt),
		OutBytes:  int64(float64(cur.outBytes-prev.outBytes) / dt),
	}

	topic := gateway.TopicMetrics + mc.ID
	a.hub.BroadcastTopic(topic, gateway.EventMetricsThroughput, point)
	a.hub.Broadcast(gateway.EventMetricsThroughput, point)
}

// CollectClusterTopology fetches varz/routez/jsz and builds a ClusterInfo.
func (a *Aggregator) CollectClusterTopology(ctx context.Context, mc *natsmgr.ManagedConn) (*types.ClusterInfo, error) {
	varz, err := a.fetchVarz(ctx, mc.Profile.Host, mc.Profile.MonitorPort)
	if err != nil {
		return nil, err
	}

	clusterName := stringOrEmpty(varz["cluster"])
	if clusterName == "" {
		clusterName = mc.Profile.Name
	}

	node := types.NodeInfo{
		ID:            mc.ID,
		Name:          stringOrEmpty(varz["server_name"]),
		Host:          mc.Profile.Host,
		Port:          mc.Profile.ClientPort,
		Version:       stringOrEmpty(varz["version"]),
		Clients:       int64OrZero(varz["connections"]),
		Subscriptions: int64OrZero(varz["subscriptions"]),
		InMsgs:        int64OrZero(varz["in_msgs"]),
		OutMsgs:       int64OrZero(varz["out_msgs"]),
		InBytes:       int64OrZero(varz["in_bytes"]),
		OutBytes:      int64OrZero(varz["out_bytes"]),
		SlowClients:   int64OrZero(varz["slow_consumers"]),
		Uptime:        stringOrEmpty(varz["uptime"]),
		JetStream:     mc.IsJetStream(),
		Health:        types.HealthOK,
	}

	if node.SlowClients > 0 {
		node.Health = types.HealthDegraded
	}

	cluster := &types.ClusterInfo{
		ID:       mc.ID,
		Name:     clusterName,
		Nodes:    []types.NodeInfo{node},
		Health:   types.HealthOK,
		NumNodes: 1,
	}

	return cluster, nil
}

func (a *Aggregator) fetchVarz(ctx context.Context, host string, monitorPort int) (map[string]any, error) {
	if monitorPort == 0 {
		monitorPort = 8222
	}
	url := fmt.Sprintf("http://%s:%d/varz", host, monitorPort)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

func int64OrZero(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	}
	return 0
}

func stringOrEmpty(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
