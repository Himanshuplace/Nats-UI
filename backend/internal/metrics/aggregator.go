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
	inMsgs   int64
	outMsgs  int64
	inBytes  int64
	outBytes int64
	ts       time.Time
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

	topoTicker := time.NewTicker(10 * time.Second)
	defer topoTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.collect(ctx)
		case <-topoTicker.C:
			a.broadcastTopology(ctx)
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
		inMsgs:   int64OrZero(varz["in_msgs"]),
		outMsgs:  int64OrZero(varz["out_msgs"]),
		inBytes:  int64OrZero(varz["in_bytes"]),
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

// broadcastTopology pushes current cluster topology to all WebSocket clients.
func (a *Aggregator) broadcastTopology(ctx context.Context) {
	for _, mc := range a.pool.List() {
		cluster, err := a.CollectClusterTopology(ctx, mc)
		if err != nil {
			continue
		}
		a.hub.Broadcast(gateway.EventClusterTopology, cluster)
	}
}

// CollectClusterTopology fetches varz/routez and builds a ClusterInfo.
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
		ID:            stringOrEmpty(varz["server_id"]),
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
	// Use connection ID as fallback node ID
	if node.ID == "" {
		node.ID = mc.ID
	}

	if node.SlowClients > 0 {
		node.Health = types.HealthDegraded
	}

	cluster := &types.ClusterInfo{
		ID:       mc.ID,
		Name:     clusterName,
		Nodes:    []types.NodeInfo{node},
		Routes:   []types.RouteInfo{},
		Health:   types.HealthOK,
		NumNodes: 1,
	}

	// Fetch routez to discover cluster peers
	routes, err := a.fetchRoutez(ctx, mc.Profile.Host, mc.Profile.MonitorPort)
	if err == nil {
		seen := map[string]bool{mc.Profile.Host: true}
		for _, route := range routes {
			ip, _ := route["ip"].(string)
			if ip == "" {
				continue
			}
			if seen[ip] {
				continue
			}
			seen[ip] = true

			peerVarz, perr := a.fetchVarz(ctx, ip, mc.Profile.MonitorPort)
			if perr != nil {
				continue
			}
			peerNode := types.NodeInfo{
				ID:            stringOrEmpty(peerVarz["server_id"]),
				Name:          stringOrEmpty(peerVarz["server_name"]),
				Host:          ip,
				Port:          4222,
				Version:       stringOrEmpty(peerVarz["version"]),
				Clients:       int64OrZero(peerVarz["connections"]),
				Subscriptions: int64OrZero(peerVarz["subscriptions"]),
				InMsgs:        int64OrZero(peerVarz["in_msgs"]),
				OutMsgs:       int64OrZero(peerVarz["out_msgs"]),
				InBytes:       int64OrZero(peerVarz["in_bytes"]),
				OutBytes:      int64OrZero(peerVarz["out_bytes"]),
				SlowClients:   int64OrZero(peerVarz["slow_consumers"]),
				Uptime:        stringOrEmpty(peerVarz["uptime"]),
				JetStream:     mc.IsJetStream(),
				Health:        types.HealthOK,
			}
			if peerNode.ID == "" {
				peerNode.ID = ip
			}
			cluster.Nodes = append(cluster.Nodes, peerNode)
			cluster.Routes = append(cluster.Routes, types.RouteInfo{
				From:    node.ID,
				To:      peerNode.ID,
				Healthy: true,
			})
		}
		cluster.NumNodes = len(cluster.Nodes)
	}

	// Set cluster health based on node health
	for _, n := range cluster.Nodes {
		if n.Health != types.HealthOK {
			cluster.Health = types.HealthDegraded
			break
		}
	}

	return cluster, nil
}

// fetchRoutez fetches the /routez endpoint and returns a slice of route maps.
func (a *Aggregator) fetchRoutez(ctx context.Context, host string, monitorPort int) ([]map[string]any, error) {
	if monitorPort == 0 {
		monitorPort = 8222
	}
	url := fmt.Sprintf("http://%s:%d/routez", host, monitorPort)
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

	// routez response has "routes" array
	raw, ok := v["routes"]
	if !ok {
		return nil, nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil, nil
	}
	out := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out, nil
}

// FetchAccounts retrieves account information from the NATS monitoring endpoint.
// Falls back to a default "$G" global account entry if /acctz is not available.
func (a *Aggregator) FetchAccounts(ctx context.Context, mc *natsmgr.ManagedConn) ([]types.NATSAccount, error) {
	monitorPort := mc.Profile.MonitorPort
	if monitorPort == 0 {
		monitorPort = 8222
	}

	url := fmt.Sprintf("http://%s:%d/acctz?limit=256", mc.Profile.Host, monitorPort)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// If endpoint returns 404 or non-200, fall back to varz-derived info
	if resp.StatusCode != http.StatusOK {
		return a.fetchAccountsFallback(ctx, mc)
	}

	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return a.fetchAccountsFallback(ctx, mc)
	}

	raw, ok := v["accounts"]
	if !ok {
		return a.fetchAccountsFallback(ctx, mc)
	}

	arr, ok := raw.([]any)
	if !ok {
		return a.fetchAccountsFallback(ctx, mc)
	}

	accounts := make([]types.NATSAccount, 0, len(arr))
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		acc := types.NATSAccount{
			Name:          stringOrEmpty(m["name"]),
			Connections:   int(int64OrZero(m["num_connections"])),
			Subscriptions: int64OrZero(m["num_subscriptions"]),
			InMsgs:        int64OrZero(m["in_msgs"]),
			OutMsgs:       int64OrZero(m["out_msgs"]),
			InBytes:       int64OrZero(m["in_bytes"]),
			OutBytes:      int64OrZero(m["out_bytes"]),
		}
		if js, ok := m["jetstream"].(map[string]any); ok {
			acc.JetStream = js != nil
		}
		accounts = append(accounts, acc)
	}
	return accounts, nil
}

// fetchAccountsFallback returns a minimal "$G" account built from varz connection count.
func (a *Aggregator) fetchAccountsFallback(ctx context.Context, mc *natsmgr.ManagedConn) ([]types.NATSAccount, error) {
	varz, err := a.fetchVarz(ctx, mc.Profile.Host, mc.Profile.MonitorPort)
	if err != nil {
		// Return a placeholder so the API doesn't error out
		return []types.NATSAccount{{
			Name:      "$G",
			JetStream: mc.IsJetStream(),
		}}, nil
	}
	return []types.NATSAccount{{
		Name:          "$G",
		Connections:   int(int64OrZero(varz["connections"])),
		Subscriptions: int64OrZero(varz["subscriptions"]),
		InMsgs:        int64OrZero(varz["in_msgs"]),
		OutMsgs:       int64OrZero(varz["out_msgs"]),
		InBytes:       int64OrZero(varz["in_bytes"]),
		OutBytes:      int64OrZero(varz["out_bytes"]),
		JetStream:     mc.IsJetStream(),
	}}, nil
}

// FetchConnz retrieves active connection details from the NATS monitoring /connz endpoint.
func (a *Aggregator) FetchConnz(ctx context.Context, mc *natsmgr.ManagedConn) ([]types.NATSUser, error) {
	monitorPort := mc.Profile.MonitorPort
	if monitorPort == 0 {
		monitorPort = 8222
	}

	url := fmt.Sprintf("http://%s:%d/connz?limit=256&auth=1", mc.Profile.Host, monitorPort)
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

	raw, ok := v["connections"]
	if !ok {
		return []types.NATSUser{}, nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return []types.NATSUser{}, nil
	}

	users := make([]types.NATSUser, 0, len(arr))
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		user := types.NATSUser{
			Username: stringOrEmpty(m["authorized_user"]),
			Account:  stringOrEmpty(m["account"]),
			IP:       stringOrEmpty(m["ip"]),
			Port:     int(int64OrZero(m["port"])),
			Subs:     int64OrZero(m["subscriptions"]),
			InMsgs:   int64OrZero(m["in_msgs"]),
			OutMsgs:  int64OrZero(m["out_msgs"]),
		}
		if user.Username == "" {
			user.Username = stringOrEmpty(m["name"])
		}
		users = append(users, user)
	}
	return users, nil
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
