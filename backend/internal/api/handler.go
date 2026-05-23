package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

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
}

// Mount registers all API routes under the given router.
func Mount(r chi.Router, hub *gateway.Hub, pool *natsmgr.Pool, dm *discovery.Manager) {
	agg := metrics.NewAggregator(hub, pool)
	ins := jetstream.NewInspector(pool)

	h := &handler{
		hub:        hub,
		pool:       pool,
		discovery:  dm,
		inspector:  ins,
		aggregator: agg,
	}

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
	mc, err := h.pool.Connect(profile)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         mc.ID,
		"connected":  true,
		"jetstream":  mc.IsJetStream(),
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
	// TODO: single consumer fetch
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
