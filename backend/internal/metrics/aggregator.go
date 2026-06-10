package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
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

// serverAddr holds the parsed host/port pair from a NATS URL.
type serverAddr struct {
	host       string
	clientPort int
}

// parseServerAddrs splits a (possibly comma-separated) NATS URL list and returns
// each server's host and client port. This lets us derive the monitoring port for
// each node without relying on routez internal IPs (which aren't reachable from
// the host when NATS runs inside Docker).
func parseServerAddrs(rawURL string) []serverAddr {
	parts := strings.Split(rawURL, ",")
	out := make([]serverAddr, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		u, err := url.Parse(part)
		if err != nil {
			continue
		}
		host := u.Hostname()
		if host == "" {
			continue
		}
		port := 4222
		if p, err := strconv.Atoi(u.Port()); err == nil && p > 0 {
			port = p
		}
		key := fmt.Sprintf("%s:%d", host, port)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, serverAddr{host: host, clientPort: port})
	}
	return out
}

// monitorPort derives the HTTP monitoring port from a NATS client port.
// NATS convention: monitoring = clientPort + (8222 - 4222) = clientPort + 4000.
// Falls back to 8222 if the result is out of range.
func monitorPort(clientPort int) int {
	m := clientPort + 4000
	if m < 1025 || m > 65534 {
		return 8222
	}
	return m
}

// CollectClusterTopology builds a ClusterInfo by fetching varz from every server
// address listed in the connection profile URL. This works whether NATS nodes are
// running locally, behind port-mapped Docker containers, or on real hosts — because
// we use the same addresses the client already knows how to reach, not the Docker-
// internal IPs that routez would return.
func (a *Aggregator) CollectClusterTopology(ctx context.Context, mc *natsmgr.ManagedConn) (*types.ClusterInfo, error) {
	addrs := parseServerAddrs(mc.Profile.URL)
	// Always include the primary address even if URL parsing produced nothing
	if len(addrs) == 0 {
		addrs = []serverAddr{{host: mc.Profile.Host, clientPort: mc.Profile.ClientPort}}
	}

	var nodes []types.NodeInfo
	var gateways []types.GatewayConn
	var leafNodes []types.LeafNodeConn
	clusterName := mc.Profile.Name

	for _, addr := range addrs {
		mp := monitorPort(addr.clientPort)
		// Override with explicit MonitorPort for the primary node
		if addr.host == mc.Profile.Host && addr.clientPort == mc.Profile.ClientPort && mc.Profile.MonitorPort > 0 {
			mp = mc.Profile.MonitorPort
		}

		varz, err := a.fetchVarz(ctx, addr.host, mp)
		if err != nil {
			slog.Debug("topology: varz fetch failed", "host", addr.host, "port", mp, "err", err)
			continue
		}

		if cn := stringOrEmpty(varz["cluster"]); cn != "" {
			clusterName = cn
		}

		node := types.NodeInfo{
			ID:            stringOrEmpty(varz["server_id"]),
			Name:          stringOrEmpty(varz["server_name"]),
			Host:          addr.host,
			Port:          addr.clientPort,
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
		if node.ID == "" {
			node.ID = fmt.Sprintf("%s:%d", addr.host, addr.clientPort)
		}
		if node.Name == "" {
			node.Name = node.ID
		}
		if node.SlowClients > 0 {
			node.Health = types.HealthDegraded
		}
		nodes = append(nodes, node)

		// Federation/edge links: gateways (supercluster) + leaf nodes (spokes).
		// Best-effort — endpoints are absent unless the server is configured for them.
		gateways = append(gateways, a.fetchGateways(ctx, addr.host, mp, node.ID, node.Name)...)
		leafNodes = append(leafNodes, a.fetchLeafNodes(ctx, addr.host, mp, node.ID, node.Name)...)
	}

	if len(nodes) == 0 {
		return nil, fmt.Errorf("could not reach any NATS node for cluster %s", mc.ID)
	}

	// Build a full-mesh route graph between all reachable nodes
	routes := make([]types.RouteInfo, 0)
	for i := 0; i < len(nodes); i++ {
		for j := i + 1; j < len(nodes); j++ {
			routes = append(routes, types.RouteInfo{
				From:    nodes[i].ID,
				To:      nodes[j].ID,
				Healthy: true,
			})
		}
	}

	cluster := &types.ClusterInfo{
		ID:        mc.ID,
		Name:      clusterName,
		Nodes:     nodes,
		Routes:    routes,
		Gateways:  gateways,
		LeafNodes: leafNodes,
		Health:    types.HealthOK,
		NumNodes:  len(nodes),
	}

	for _, n := range nodes {
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

// fetchMonitorObj GETs a monitoring endpoint and decodes the top-level JSON object.
func (a *Aggregator) fetchMonitorObj(ctx context.Context, host string, monPort int, path string) (map[string]any, error) {
	if monPort == 0 {
		monPort = 8222
	}
	endpoint := fmt.Sprintf("http://%s:%d/%s", host, monPort, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: status %d", path, resp.StatusCode)
	}
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

// fetchGateways reads /gatewayz and returns this server's gateway connections to
// remote clusters (both outbound and inbound). Best-effort: returns nil when the
// server has no gateways configured or the endpoint is unavailable.
func (a *Aggregator) fetchGateways(ctx context.Context, host string, monPort int, serverID, serverName string) []types.GatewayConn {
	v, err := a.fetchMonitorObj(ctx, host, monPort, "gatewayz")
	if err != nil {
		return nil
	}
	var out []types.GatewayConn

	// outbound_gateways: map[remoteCluster] -> { configured, connection {...} }
	if om, ok := v["outbound_gateways"].(map[string]any); ok {
		for remote, raw := range om {
			m, _ := raw.(map[string]any)
			gc := types.GatewayConn{
				ServerID:      serverID,
				ServerName:    serverName,
				RemoteCluster: remote,
				Direction:     "outbound",
				Configured:    boolOrFalse(m["configured"]),
			}
			if conn, ok := m["connection"].(map[string]any); ok {
				gc.IP = stringOrEmpty(conn["ip"])
				gc.Port = int(int64OrZero(conn["port"]))
				gc.RTTMs = parseRTTms(conn["rtt"])
				gc.Healthy = true
			}
			out = append(out, gc)
		}
	}

	// inbound_gateways: map[remoteCluster] -> [ { connection {...} }, ... ]
	if im, ok := v["inbound_gateways"].(map[string]any); ok {
		for remote, raw := range im {
			arr, ok := raw.([]any)
			if !ok || len(arr) == 0 {
				continue
			}
			gc := types.GatewayConn{
				ServerID:       serverID,
				ServerName:     serverName,
				RemoteCluster:  remote,
				Direction:      "inbound",
				NumConnections: len(arr),
				Healthy:        true,
			}
			if first, ok := arr[0].(map[string]any); ok {
				gc.Configured = boolOrFalse(first["configured"])
				if conn, ok := first["connection"].(map[string]any); ok {
					gc.IP = stringOrEmpty(conn["ip"])
					gc.Port = int(int64OrZero(conn["port"]))
					gc.RTTMs = parseRTTms(conn["rtt"])
				}
			}
			out = append(out, gc)
		}
	}
	return out
}

// fetchLeafNodes reads /leafz and returns the leaf-node connections attached to
// this server. Best-effort: nil when no leaf nodes / endpoint unavailable.
func (a *Aggregator) fetchLeafNodes(ctx context.Context, host string, monPort int, serverID, serverName string) []types.LeafNodeConn {
	v, err := a.fetchMonitorObj(ctx, host, monPort, "leafz")
	if err != nil {
		return nil
	}
	raw, ok := v["leafs"].([]any)
	if !ok || len(raw) == 0 {
		return nil
	}
	out := make([]types.LeafNodeConn, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, types.LeafNodeConn{
			ServerID:      serverID,
			ServerName:    serverName,
			Name:          stringOrEmpty(m["name"]),
			Account:       stringOrEmpty(m["account"]),
			IP:            stringOrEmpty(m["ip"]),
			Port:          int(int64OrZero(m["port"])),
			RTTMs:         parseRTTms(m["rtt"]),
			Subscriptions: int64OrZero(m["subscriptions"]),
			InMsgs:        int64OrZero(m["in_msgs"]),
			OutMsgs:       int64OrZero(m["out_msgs"]),
			InBytes:       int64OrZero(m["in_bytes"]),
			OutBytes:      int64OrZero(m["out_bytes"]),
		})
	}
	return out
}

// parseRTTms converts a NATS duration string (e.g. "1.2ms", "350µs") to ms.
func parseRTTms(v any) float64 {
	s, ok := v.(string)
	if !ok || s == "" {
		return 0
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0
	}
	return float64(d.Microseconds()) / 1000.0
}

func boolOrFalse(v any) bool {
	b, ok := v.(bool)
	return ok && b
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
