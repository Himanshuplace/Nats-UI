package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/xid"

	authmw "github.com/Himanshuplace/nats-ui/internal/auth"
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
	authCfg    *authmw.AuthConfig
	connStore  *authmw.ConnectionStore

	cancelsMu sync.Mutex
	cancels   map[string]context.CancelFunc
}

// Mount registers all API routes. Public auth routes are registered without middleware;
// everything else is behind the JWT middleware.
func Mount(r chi.Router, hub *gateway.Hub, pool *natsmgr.Pool, dm *discovery.Manager, agg *metrics.Aggregator, authCfg *authmw.AuthConfig, cs *authmw.ConnectionStore) {
	ins := jetstream.NewInspector(pool)

	h := &handler{
		hub:        hub,
		pool:       pool,
		discovery:  dm,
		inspector:  ins,
		aggregator: agg,
		authCfg:    authCfg,
		connStore:  cs,
		cancels:    make(map[string]context.CancelFunc),
	}

	h.registerWSHandlers()

	// ── Public: no auth required ─────────────────────────────────────────────
	r.Post("/auth/login", h.login)

	// ── Protected: JWT required ──────────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(authmw.Middleware(authCfg.Secret))

		r.Get("/auth/me", h.me)

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
		r.Post("/clusters/{id}/streams", h.createStream)
		r.Get("/clusters/{id}/streams/{stream}", h.getStream)
		r.Put("/clusters/{id}/streams/{stream}", h.updateStream)
		r.Delete("/clusters/{id}/streams/{stream}", h.deleteStream)

		// Consumers
		r.Get("/clusters/{id}/streams/{stream}/consumers", h.listConsumers)
		r.Get("/clusters/{id}/streams/{stream}/consumers/{consumer}", h.getConsumer)
		r.Post("/clusters/{id}/streams/{stream}/consumers", h.createConsumer)
		r.Delete("/clusters/{id}/streams/{stream}/consumers/{consumer}", h.deleteConsumer)

		// Messages + publish + request-reply
		r.Get("/clusters/{id}/streams/{stream}/messages", h.listMessages)
		r.Post("/clusters/{id}/publish", h.publish)
		r.Post("/clusters/{id}/request", h.request)

		// Subjects
		r.Get("/clusters/{id}/subjects", h.listSubjects)

		// Services (micro $SRV discovery)
		r.Get("/clusters/{id}/services", h.listServices)
		r.Get("/clusters/{id}/services/ping", h.pingServices)

		// Per-server RTT / latency
		r.Get("/clusters/{id}/rtt", h.rttProbe)

		// Pull-consumer debugger (fetch + ack/nak/term)
		r.Post("/clusters/{id}/debug/fetch", h.debugFetch)
		r.Post("/clusters/{id}/debug/ack", h.debugAck)

		// Key-Value (keys via ?key= query param)
		r.Get("/clusters/{id}/kv", h.listKVBuckets)
		r.Post("/clusters/{id}/kv", h.createKVBucket)
		r.Delete("/clusters/{id}/kv/{bucket}", h.deleteKVBucket)
		r.Get("/clusters/{id}/kv/{bucket}/keys", h.listKVKeys)
		r.Get("/clusters/{id}/kv/{bucket}/history", h.getKVHistory)
		r.Put("/clusters/{id}/kv/{bucket}/entry", h.putKVKey)
		r.Delete("/clusters/{id}/kv/{bucket}/entry", h.deleteKVKey)

		// Object store (object names via ?name= query param)
		r.Get("/clusters/{id}/obj", h.listObjectBuckets)
		r.Post("/clusters/{id}/obj", h.createObjectBucket)
		r.Delete("/clusters/{id}/obj/{bucket}", h.deleteObjectBucket)
		r.Get("/clusters/{id}/obj/{bucket}/objects", h.listObjects)
		r.Get("/clusters/{id}/obj/{bucket}/object", h.getObject)
		r.Put("/clusters/{id}/obj/{bucket}/object", h.putObject)
		r.Delete("/clusters/{id}/obj/{bucket}/object", h.deleteObject)

		// Metrics
		r.Get("/clusters/{id}/metrics/throughput", h.metricsThroughput)

		// WebSocket (token via ?token= query param)
		r.Get("/ws", hub.ServeWS)
	})
}

// ── Auth ──────────────────────────────────────────────────────────────────────

func (h *handler) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !authmw.ValidateCredentials(h.authCfg, req.Username, req.Password) {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	token, err := authmw.GenerateToken(req.Username, h.authCfg.Secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token generation failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"token":    token,
		"username": req.Username,
	})
}

func (h *handler) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"username": h.authCfg.Username,
		"status":   "authenticated",
	})
}

// ── WebSocket command handlers ────────────────────────────────────────────────

func (h *handler) registerWSHandlers() {
	h.hub.RegisterHandler(gateway.CmdTailStart, h.handleTailStart)
	h.hub.RegisterHandler(gateway.CmdTailStop, h.handleTailStop)
	h.hub.RegisterHandler(gateway.CmdSubjectTailStart, h.handleSubjectTailStart)
	h.hub.RegisterHandler(gateway.CmdSubjectTailStop, h.handleSubjectTailStop)
	h.hub.RegisterHandler(gateway.CmdReplayStart, h.handleReplayStart)
	h.hub.RegisterHandler(gateway.CmdReplayStop, h.handleReplayStop)
	h.hub.RegisterHandler(gateway.CmdMetricsWatch, h.handleMetricsWatch)
	h.hub.RegisterHandler(gateway.CmdFlowStart, h.handleFlowStart)
	h.hub.RegisterHandler(gateway.CmdFlowStop, h.handleFlowStop)

	// Tear down a client's subscriptions (tail / replay / flow) when its
	// WebSocket drops, so they don't leak if the tab closes without stopping.
	h.hub.OnClientDisconnect(func(clientID string) {
		prefix := clientID + ":"
		h.cancelsMu.Lock()
		for key, cancel := range h.cancels {
			if strings.HasPrefix(key, prefix) {
				cancel()
				delete(h.cancels, key)
			}
		}
		h.cancelsMu.Unlock()
	})
}

// ── Topology live flow ──────────────────────────────────────────────────────
// Streams a rate-capped sample of real ">" traffic to the requesting client
// only, so the 3D topology can pulse on genuine messages. Scoped per client so
// it starts when the topology view opens and stops when it closes.

func (h *handler) handleFlowStart(clientID string, payload json.RawMessage) {
	var req struct {
		ClusterID       string `json:"clusterId"`
		IncludeInternal bool   `json:"includeInternal"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}
	if req.ClusterID == "" {
		req.ClusterID = "default"
	}

	cancelKey := clientID + ":flow:" + req.ClusterID
	h.cancelsMu.Lock()
	if cancel, ok := h.cancels[cancelKey]; ok {
		cancel() // restart if already running
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.cancels[cancelKey] = cancel
	h.cancelsMu.Unlock()

	go func() {
		defer func() {
			h.cancelsMu.Lock()
			delete(h.cancels, cancelKey)
			h.cancelsMu.Unlock()
		}()
		err := h.inspector.FlowSample(ctx, req.ClusterID, req.IncludeInternal, func(ev jetstream.FlowEvent) {
			h.hub.SendToClient(clientID, gateway.EventTopologyFlow, ev)
		})
		if err != nil && ctx.Err() == nil {
			h.hub.SendToClient(clientID, gateway.EventError, map[string]string{
				"code":    "FLOW_ERROR",
				"message": err.Error(),
			})
		}
	}()
}

func (h *handler) handleFlowStop(clientID string, payload json.RawMessage) {
	var req struct {
		ClusterID string `json:"clusterId"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}
	if req.ClusterID == "" {
		req.ClusterID = "default"
	}
	cancelKey := clientID + ":flow:" + req.ClusterID
	h.cancelsMu.Lock()
	if cancel, ok := h.cancels[cancelKey]; ok {
		cancel()
		delete(h.cancels, cancelKey)
	}
	h.cancelsMu.Unlock()
}

// Stream-bound tail
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
	h.cancelsMu.Lock()
	if cancel, ok := h.cancels[cancelKey]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.cancels[cancelKey] = cancel
	h.cancelsMu.Unlock()

	h.hub.Broadcast(gateway.EventTailStarted, map[string]string{
		"clusterId": req.ClusterID,
		"stream":    req.Stream,
	})

	go func() {
		defer func() {
			h.cancelsMu.Lock()
			delete(h.cancels, cancelKey)
			h.cancelsMu.Unlock()
			h.hub.Broadcast(gateway.EventTailStopped, map[string]string{
				"clusterId": req.ClusterID,
				"stream":    req.Stream,
			})
		}()

		err := h.inspector.TailStream(ctx, req.ClusterID, req.Stream, func(msg types.TailedMessage) {
			h.hub.SendToClient(clientID, gateway.EventMessageReceived, msg)
		})
		if err != nil && ctx.Err() == nil {
			h.hub.SendToClient(clientID, gateway.EventError, map[string]string{
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

// Raw NATS subject tail
func (h *handler) handleSubjectTailStart(clientID string, payload json.RawMessage) {
	var req struct {
		ClusterID string `json:"clusterId"`
		Subject   string `json:"subject"`
	}
	if err := json.Unmarshal(payload, &req); err != nil || req.Subject == "" {
		return
	}
	if req.ClusterID == "" {
		req.ClusterID = "default"
	}

	cancelKey := clientID + ":subjtail:" + req.ClusterID + ":" + req.Subject
	h.cancelsMu.Lock()
	if cancel, ok := h.cancels[cancelKey]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.cancels[cancelKey] = cancel
	h.cancelsMu.Unlock()

	h.hub.Broadcast(gateway.EventTailStarted, map[string]string{
		"clusterId":     req.ClusterID,
		"subjectFilter": req.Subject,
	})

	go func() {
		defer func() {
			h.cancelsMu.Lock()
			delete(h.cancels, cancelKey)
			h.cancelsMu.Unlock()
			h.hub.Broadcast(gateway.EventTailStopped, map[string]string{
				"clusterId":     req.ClusterID,
				"subjectFilter": req.Subject,
			})
		}()

		err := h.inspector.TailSubject(ctx, req.ClusterID, req.Subject, func(msg types.TailedMessage) {
			h.hub.SendToClient(clientID, gateway.EventMessageReceived, msg)
		})
		if err != nil && ctx.Err() == nil {
			h.hub.SendToClient(clientID, gateway.EventError, map[string]string{
				"code":    "SUBJECT_TAIL_ERROR",
				"message": err.Error(),
			})
		}
	}()
}

func (h *handler) handleSubjectTailStop(clientID string, payload json.RawMessage) {
	var req struct {
		ClusterID string `json:"clusterId"`
		Subject   string `json:"subject"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}
	if req.ClusterID == "" {
		req.ClusterID = "default"
	}
	cancelKey := clientID + ":subjtail:" + req.ClusterID + ":" + req.Subject
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

func (h *handler) handleMetricsWatch(_ string, _ json.RawMessage) {}

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
	h.syncConnections()
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
	h.syncConnections()
	w.WriteHeader(http.StatusNoContent)
}

// syncConnections persists the current pool state to disk.
func (h *handler) syncConnections() {
	if h.connStore == nil {
		return
	}
	conns := h.pool.List()
	profiles := make([]types.ConnectionProfile, 0, len(conns))
	for _, mc := range conns {
		profiles = append(profiles, mc.Profile)
	}
	if err := h.connStore.Save(profiles); err != nil {
		slog.Warn("failed to persist connections", "err", err)
	}
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

func (h *handler) createStream(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var cfg types.StreamConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if cfg.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	si, err := h.inspector.CreateStream(r.Context(), id, cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, si)
}

func (h *handler) updateStream(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var cfg types.StreamConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if name := chi.URLParam(r, "stream"); name != "" {
		cfg.Name = name
	}
	si, err := h.inspector.UpdateStream(r.Context(), id, cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, si)
}

func (h *handler) deleteStream(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stream := chi.URLParam(r, "stream")
	if err := h.inspector.DeleteStream(r.Context(), id, stream); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

func (h *handler) createConsumer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stream := chi.URLParam(r, "stream")
	var cfg types.ConsumerConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ci, err := h.inspector.CreateConsumer(r.Context(), id, stream, cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ci)
}

func (h *handler) deleteConsumer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stream := chi.URLParam(r, "stream")
	consumer := chi.URLParam(r, "consumer")
	if err := h.inspector.DeleteConsumer(r.Context(), id, stream, consumer); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Messages ──────────────────────────────────────────────────────────────────

func (h *handler) listMessages(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stream := chi.URLParam(r, "stream")
	q := r.URL.Query()

	var startSeq uint64
	if s := q.Get("startSeq"); s != "" {
		if v, err := strconv.ParseUint(s, 10, 64); err == nil {
			startSeq = v
		}
	}

	limit := 50
	if l := q.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}

	subjectFilter := q.Get("subject")

	msgs, err := h.inspector.FetchMessages(r.Context(), id, stream, startSeq, limit, subjectFilter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if msgs == nil {
		msgs = []types.StoredMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}

func (h *handler) publish(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req types.PublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Subject == "" {
		writeError(w, http.StatusBadRequest, "subject is required")
		return
	}
	result, err := h.inspector.Publish(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handler) request(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req types.RequestReplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Subject == "" {
		writeError(w, http.StatusBadRequest, "subject is required")
		return
	}
	result, err := h.inspector.RequestReply(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// ── Services (micro) ────────────────────────────────────────────────────────────

func (h *handler) listServices(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	services, err := h.inspector.ListServices(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if services == nil {
		services = []types.ServiceInfo{}
	}
	writeJSON(w, http.StatusOK, services)
}

func (h *handler) pingServices(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	result, err := h.inspector.PingServices(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handler) rttProbe(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	results, err := h.inspector.RTTProbe(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if results == nil {
		results = []types.RTTResult{}
	}
	writeJSON(w, http.StatusOK, results)
}

// ── Pull-consumer debugger ──────────────────────────────────────────────────────

func (h *handler) debugFetch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req types.DebugFetchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Stream == "" || req.Consumer == "" {
		writeError(w, http.StatusBadRequest, "stream and consumer are required")
		return
	}
	res, err := h.inspector.DebugFetch(r.Context(), id, req.Stream, req.Consumer, req.Batch)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *handler) debugAck(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req types.DebugAckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.inspector.DebugAck(r.Context(), id, req.SessionID, req.MessageID, req.Action); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handler) listSubjects(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	subjects, err := h.inspector.ListSubjects(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if subjects == nil {
		subjects = []types.SubjectInfo{}
	}
	writeJSON(w, http.StatusOK, subjects)
}

// ── Key-Value ───────────────────────────────────────────────────────────────────
// Keys are passed as the ?key= query param (KV keys may contain dots/slashes that
// would break path routing); bucket names are restricted to [A-Za-z0-9_-] so they
// are path-safe.

func (h *handler) listKVBuckets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	buckets, err := h.inspector.ListKVBuckets(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, buckets)
}

func (h *handler) createKVBucket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var cfg types.KVBucketConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if cfg.Bucket == "" {
		writeError(w, http.StatusBadRequest, "bucket is required")
		return
	}
	info, err := h.inspector.CreateKVBucket(r.Context(), id, cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (h *handler) deleteKVBucket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	if err := h.inspector.DeleteKVBucket(r.Context(), id, bucket); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handler) listKVKeys(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	entries, err := h.inspector.ListKVKeys(r.Context(), id, bucket)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entries == nil {
		entries = []types.KVEntry{}
	}
	writeJSON(w, http.StatusOK, entries)
}

func (h *handler) getKVHistory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	hist, err := h.inspector.GetKVHistory(r.Context(), id, bucket, key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if hist == nil {
		hist = []types.KVEntry{}
	}
	writeJSON(w, http.StatusOK, hist)
}

func (h *handler) putKVKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	var req types.KVPutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	rev, err := h.inspector.PutKVKey(r.Context(), id, bucket, key, req.Value)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": rev})
}

func (h *handler) deleteKVKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	var err error
	if r.URL.Query().Get("purge") == "true" {
		err = h.inspector.PurgeKVKey(r.Context(), id, bucket, key)
	} else {
		err = h.inspector.DeleteKVKey(r.Context(), id, bucket, key)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Object store ────────────────────────────────────────────────────────────────
// Object names (which can contain dots/slashes) are passed as ?name=; bucket
// names are [A-Za-z0-9_-] so they're path-safe.

func (h *handler) listObjectBuckets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	buckets, err := h.inspector.ListObjectBuckets(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, buckets)
}

func (h *handler) createObjectBucket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var cfg types.ObjectBucketConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if cfg.Bucket == "" {
		writeError(w, http.StatusBadRequest, "bucket is required")
		return
	}
	info, err := h.inspector.CreateObjectBucket(r.Context(), id, cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (h *handler) deleteObjectBucket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	if err := h.inspector.DeleteObjectBucket(r.Context(), id, bucket); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handler) listObjects(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	objs, err := h.inspector.ListObjects(r.Context(), id, bucket)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if objs == nil {
		objs = []types.ObjectEntry{}
	}
	writeJSON(w, http.StatusOK, objs)
}

func (h *handler) getObject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	data, err := h.inspector.GetObject(r.Context(), id, bucket, name)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func (h *handler) putObject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	var req types.ObjectPutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var data []byte
	if req.Base64 != "" {
		b, derr := base64.StdEncoding.DecodeString(req.Base64)
		if derr != nil {
			writeError(w, http.StatusBadRequest, "invalid base64")
			return
		}
		data = b
	} else {
		data = []byte(req.Text)
	}
	entry, err := h.inspector.PutObject(r.Context(), id, bucket, name, data)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entry)
}

func (h *handler) deleteObject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bucket := chi.URLParam(r, "bucket")
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := h.inspector.DeleteObject(r.Context(), id, bucket, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
