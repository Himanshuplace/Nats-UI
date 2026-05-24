package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/xid"

	"github.com/Himanshuplace/nats-ui/internal/discovery"
	"github.com/Himanshuplace/nats-ui/internal/gateway"
	"github.com/Himanshuplace/nats-ui/internal/jetstream"
	"github.com/Himanshuplace/nats-ui/internal/metrics"
	natsmgr "github.com/Himanshuplace/nats-ui/internal/nats"
	"github.com/Himanshuplace/nats-ui/pkg/types"
)

type handler struct {
	hub        *gateway.Hub
	pool       *natsmgr.Pool
	discovery  *discovery.Manager
	inspector  *jetstream.Inspector
	aggregator *metrics.Aggregator

	// tail/replay cancels keyed by clientID+":"+stream or replayID
	cancelsMu sync.Mutex
	cancels   map[string]context.CancelFunc
}

// Mount registers all API routes and wires WebSocket command handlers.
func Mount(r chi.Router, hub *gateway.Hub, pool *natsmgr.Pool, dm *discovery.Manager, agg *metrics.Aggregator) {
	ins := jetstream.NewInspector(pool)

	h := &handler{
		hub:        hub,
		pool:       pool,
		discovery:  dm,
		inspector:  ins,
		aggregator: agg,
		cancels:    make(map[string]context.CancelFunc),
	}

	// Register WebSocket command handlers
	h.registerWSHandlers()

	// Discovery
	r.Get("/discovery/scan", h.discoveryScan)
	r.Get("/discovery/known", h.discoveryKnown)

	// Connections
	r.Post("/connections", h.connectProfile)
	r.Get("/connections", h.listConnections)
	r.Delete("/connections/{id}", h.removeConnection)

	// Cluster
	r.Get("/clusters/{id}/topology", h.clusterTopology)
	r.Get("/clusters/{id}/health", h.clusterHealth)
	r.Get("/clusters/{id}/accounts", h.listAccounts)
	r.Get("/clusters/{id}/connz", h.listConnz)

	// Streams
	r.Get("/clusters/{id}/streams", h.listStreams)
	r.Get("/clusters/{id}/streams/{stream}", h.getStream)

	// Consumers
	r.Get("/clusters/{id}/streams/{stream}/consumers", h.listConsumers)
	r.Get("/clusters/{id}/streams/{stream}/consumers/{consumer}", h.getConsumer)

	// Metrics
	r.Get("/clusters/{id}/metrics/throughput", h.metricsThroughput)

	// WebSocket
	r.Get("/ws", hub.ServeWS)
}

// ── WebSocket command handlers ─────────────────────────────────────────────────

func (h *handler) registerWSHandlers() {
	h.hub.RegisterHandler(gateway.CmdTailStart, h.handleTailStart)
	h.hub.RegisterHandler(gateway.CmdTailStop, h.handleTailStop)
	h.hub.RegisterHandler(gateway.CmdReplayStart, h.handleReplayStart)
	h.hub.RegisterHandler(gateway.CmdReplayStop, h.handleReplayStop)
	h.hub.RegisterHandler(gateway.CmdMetricsWatch, h.handleMetricsWatch)
}

func (h *handler) handleTailStart(clientID string, payload json.RawMessage) {
	var req struct {
		ClusterID string `json:"clusterId"`
		Stream    string `json:"stream"`
	}
	if err := json.Unmarshal(payload, &req); err != nil || req.Stream == "" {
		return
	}
	if req.ClusterID == "" {
		req.ClusterID = "default"
	}

	cancelKey := clientID + ":tail:" + req.ClusterID + ":" + req.Stream

	// Cancel any existing tail for this client+stream
	h.cancelsMu.Lock()
	if cancel, ok := h.cancels[cancelKey]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.cancels[cancelKey] = cancel
	h.cancelsMu.Unlock()

	topic := gateway.TopicTail + req.ClusterID + ":" + req.Stream

	h.hub.BroadcastTopic(topic, gateway.EventTailStarted, map[string]string{
		"clusterId": req.ClusterID,
		"stream":    req.Stream,
	})

	go func() {
		defer func() {
			h.cancelsMu.Lock()
			delete(h.cancels, cancelKey)
			h.cancelsMu.Unlock()
			h.hub.BroadcastTopic(topic, gateway.EventTailStopped, map[string]string{
				"clusterId": req.ClusterID,
				"stream":    req.Stream,
			})
		}()

		err := h.inspector.TailStream(ctx, req.ClusterID, req.Stream, func(msg types.TailedMessage) {
			h.hub.BroadcastTopic(topic, gateway.EventMessageReceived, msg)
			h.hub.Broadcast(gateway.EventMessageReceived, msg)
		})
		if err != nil && ctx.Err() == nil {
			h.hub.BroadcastTopic(topic, gateway.EventError, map[string]string{
				"code":    "TAIL_ERROR",
				"message": err.Error(),
			})
		}
	}()
}

func (h *handler) handleTailStop(clientID string, payload json.RawMessage) {
	var req struct {
		ClusterID string `json:"clusterId"`
		Stream    string `json:"stream"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}
	if req.ClusterID == "" {
		req.ClusterID = "default"
	}

	cancelKey := clientID + ":tail:" + req.ClusterID + ":" + req.Stream
	h.cancelsMu.Lock()
	if cancel, ok := h.cancels[cancelKey]; ok {
		cancel()
		delete(h.cancels, cancelKey)
	}
	h.cancelsMu.Unlock()
}

func (h *handler) handleReplayStart(clientID string, payload json.RawMessage) {
	var cfg types.ReplayConfig
	if err := json.Unmarshal(payload, &cfg); err != nil || cfg.Stream == "" {
		return
	}
	if cfg.ID == "" {
		cfg.ID = xid.New().String()
	}
	if cfg.ClusterID == "" {
		cfg.ClusterID = "default"
	}

	cancelKey := clientID + ":replay:" + cfg.ID
	h.cancelsMu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	h.cancels[cancelKey] = cancel
	h.cancelsMu.Unlock()

	go func() {
		defer func() {
			h.cancelsMu.Lock()
			delete(h.cancels, cancelKey)
			h.cancelsMu.Unlock()
		}()
		h.inspector.ReplayStream(ctx, cfg, func(progress types.ReplayProgress) {
			h.hub.Broadcast(gateway.EventReplayProgress, progress)
		})
	}()
}

func (h *handler) handleReplayStop(clientID string, payload json.RawMessage) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}
	cancelKey := clientID + ":replay:" + req.ID
	h.cancelsMu.Lock()
	if cancel, ok := h.cancels[cancelKey]; ok {
		cancel()
		delete(h.cancels, cancelKey)
	}
	h.cancelsMu.Unlock()
}

func (h *handler) handleMetricsWatch(_ string, _ json.RawMessage) {
	// Client subscribes to metrics for a specific cluster; handled by topic subscription.
	// The aggregator already broadcasts metrics.throughput to all clients.
}

// ── Discovery ─────────────────────────────────────────────────────────────────

func (h *handler) discoveryScan(w http.ResponseWriter, r *http.Request) {
	servers := h.discovery.Scan(r.Context())
	writeJSON(w, http.StatusOK, servers)
}

func (h *handler) discoveryKnown(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.discovery.Known())
}

// ── Connections ───────────────────────────────────────────────────────────────

func (h *handler) connectProfile(w http.ResponseWriter, r *http.Request) {
	var profile types.ConnectionProfile
	if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if profile.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	// Generate ID if caller didn't provide one
	if profile.ID == "" {
		profile.ID = xid.New().String()
	}
	if profile.Name == "" {
		profile.Name = profile.URL
	}
	mc, err := h.pool.Connect(profile)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":        mc.ID,
		"connected": true,
		"jetstream": mc.IsJetStream(),
	})
}

func (h *handler) listConnections(w http.ResponseWriter, r *http.Request) {
	conns := h.pool.List()
	out := make([]map[string]any, 0, len(conns))
	for _, mc := range conns {
		out = append(out, map[string]any{
			"id":        mc.ID,
			"name":      mc.Profile.Name,
			"url":       mc.Profile.URL,
			"jetstream": mc.IsJetStream(),
			"status":    mc.NC.Status().String(),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *handler) removeConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.pool.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// ── Cluster ───────────────────────────────────────────────────────────────────

func (h *handler) clusterTopology(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mc, ok := h.pool.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "cluster not found")
		return
	}
	cluster, err := h.aggregator.CollectClusterTopology(r.Context(), mc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cluster)
}

func (h *handler) clusterHealth(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mc, ok := h.pool.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "cluster not found")
		return
	}
	cluster, err := h.aggregator.CollectClusterTopology(r.Context(), mc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"clusterId": id,
		"health":    cluster.Health,
		"nodes":     len(cluster.Nodes),
	})
}

func (h *handler) listAccounts(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mc, ok := h.pool.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "cluster not found")
		return
	}
	accounts, err := h.aggregator.FetchAccounts(r.Context(), mc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

func (h *handler) listConnz(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mc, ok := h.pool.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "cluster not found")
		return
	}
	connz, err := h.aggregator.FetchConnz(r.Context(), mc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, connz)
}

// ── Streams ───────────────────────────────────────────────────────────────────

func (h *handler) listStreams(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	streams, err := h.inspector.ListStreams(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, streams)
}

func (h *handler) getStream(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stream := chi.URLParam(r, "stream")
	si, err := h.inspector.GetStream(r.Context(), id, stream)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, si)
}

// ── Consumers ─────────────────────────────────────────────────────────────────

func (h *handler) listConsumers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stream := chi.URLParam(r, "stream")
	consumers, err := h.inspector.ListConsumers(r.Context(), id, stream)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, consumers)
}

func (h *handler) getConsumer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stream := chi.URLParam(r, "stream")
	consumer := chi.URLParam(r, "consumer")
	ci, err := h.inspector.GetConsumer(r.Context(), id, stream, consumer)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ci)
}

// ── Metrics ───────────────────────────────────────────────────────────────────

func (h *handler) metricsThroughput(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mc, ok := h.pool.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "cluster not found")
		return
	}
	cluster, err := h.aggregator.CollectClusterTopology(r.Context(), mc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(cluster.Nodes) > 0 {
		n := cluster.Nodes[0]
		writeJSON(w, http.StatusOK, types.ThroughputPoint{
			ClusterID: id,
			Timestamp: time.Now(),
			InMsgs:    n.InMsgs,
			OutMsgs:   n.OutMsgs,
			InBytes:   n.InBytes,
			OutBytes:  n.OutBytes,
		})
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
