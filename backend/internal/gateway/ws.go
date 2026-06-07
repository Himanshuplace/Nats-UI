package gateway

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/xid"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024 // 512 KB
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// Client represents a connected WebSocket client.
type Client struct {
	id   string
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
	subs map[string]bool
	mu   sync.RWMutex
}

// Hub manages all active WebSocket clients and message fanout.
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	targeted   chan targetedMsg
	subscribe  chan subscribeReq
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex

	// Pluggable command handlers registered by API layer
	handlers   map[string]CommandHandler
	handlersMu sync.RWMutex

	// Callbacks invoked when a client disconnects (for per-client cleanup)
	disconnectFns []func(clientID string)
	discMu        sync.RWMutex
}

type targetedMsg struct {
	topic   string
	payload []byte
}

type subscribeReq struct {
	client *Client
	topic  string
	add    bool
}

// CommandHandler is called when a client sends a command of that type.
type CommandHandler func(clientID string, payload json.RawMessage)

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 8192),
		targeted:   make(chan targetedMsg, 4096),
		subscribe:  make(chan subscribeReq, 512),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		handlers:   make(map[string]CommandHandler),
	}
}

// RegisterHandler registers a command handler for a given command type.
func (h *Hub) RegisterHandler(cmdType string, fn CommandHandler) {
	h.handlersMu.Lock()
	h.handlers[cmdType] = fn
	h.handlersMu.Unlock()
}

// OnClientDisconnect registers a callback invoked (async) when a client's
// WebSocket disconnects — used to tear down per-client subscriptions (tail,
// replay, topology flow) so they don't leak when a tab closes.
func (h *Hub) OnClientDisconnect(fn func(clientID string)) {
	h.discMu.Lock()
	h.disconnectFns = append(h.disconnectFns, fn)
	h.discMu.Unlock()
}

func (h *Hub) notifyDisconnect(clientID string) {
	h.discMu.RLock()
	fns := make([]func(string), len(h.disconnectFns))
	copy(fns, h.disconnectFns)
	h.discMu.RUnlock()
	for _, fn := range fns {
		go fn(clientID)
	}
}

// Run starts the hub event loop — call in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			slog.Info("ws client connected", "id", client.id, "total", len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			_, existed := h.clients[client]
			if existed {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			if existed {
				h.notifyDisconnect(client.id)
			}
			slog.Info("ws client disconnected", "id", client.id, "total", len(h.clients))

		case req := <-h.subscribe:
			req.client.mu.Lock()
			if req.add {
				req.client.subs[req.topic] = true
			} else {
				delete(req.client.subs, req.topic)
			}
			req.client.mu.Unlock()

		case payload := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				h.safeWrite(client, payload)
			}
			h.mu.RUnlock()

		case msg := <-h.targeted:
			h.mu.RLock()
			for client := range h.clients {
				client.mu.RLock()
				_, subbed := client.subs[msg.topic]
				client.mu.RUnlock()
				if subbed {
					h.safeWrite(client, msg.payload)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) safeWrite(c *Client, data []byte) {
	select {
	case c.send <- data:
	default:
		// Slow consumer — disconnect to protect hub throughput
		slog.Warn("dropping slow ws client", "id", c.id)
		h.mu.Lock()
		delete(h.clients, c)
		close(c.send)
		h.mu.Unlock()
	}
}

// Broadcast sends an event to every connected client.
func (h *Hub) Broadcast(eventType string, data any) {
	payload := h.marshal(eventType, data)
	if payload == nil {
		return
	}
	select {
	case h.broadcast <- payload:
	default:
		slog.Warn("broadcast channel full", "type", eventType)
	}
}

// SendToClient sends an event to exactly one client by ID.
// Used for tail messages so only the requesting tab receives them.
func (h *Hub) SendToClient(clientID, eventType string, data any) {
	payload := h.marshal(eventType, data)
	if payload == nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client.id == clientID {
			h.safeWrite(client, payload)
			return
		}
	}
}

// BroadcastTopic sends to clients subscribed to a topic prefix.
func (h *Hub) BroadcastTopic(topic, eventType string, data any) {
	payload := h.marshal(eventType, data)
	if payload == nil {
		return
	}
	select {
	case h.targeted <- targetedMsg{topic: topic, payload: payload}:
	default:
	}
}

func (h *Hub) marshal(eventType string, data any) []byte {
	env := map[string]any{
		"type": eventType,
		"ts":   time.Now().UnixMilli(),
		"data": data,
	}
	b, err := json.Marshal(env)
	if err != nil {
		slog.Error("failed to marshal ws event", "type", eventType, "err", err)
		return nil
	}
	return b
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}

	client := &Client{
		id:   xid.New().String(),
		hub:  h,
		conn: conn,
		send: make(chan []byte, 512),
		subs: make(map[string]bool),
	}

	h.register <- client

	// Send welcome with client ID
	welcome, _ := json.Marshal(map[string]any{
		"type": "connected",
		"ts":   time.Now().UnixMilli(),
		"data": map[string]string{"clientId": client.id},
	})
	client.send <- welcome

	go client.writePump()
	go client.readPump()
}

// ── Client pumps ──────────────────────────────────────────────────────────────

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Warn("ws read error", "id", c.id, "err", err)
			}
			break
		}
		c.handleCommand(msg)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			// Batch flush: drain queue into same frame
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}
			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleCommand(raw []byte) {
	var cmd struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(raw, &cmd); err != nil {
		slog.Warn("invalid ws command", "id", c.id, "err", err)
		return
	}

	switch cmd.Type {
	case CmdSubscribe:
		var p struct{ Topic string `json:"topic"` }
		if json.Unmarshal(cmd.Payload, &p) == nil && p.Topic != "" {
			c.hub.subscribe <- subscribeReq{client: c, topic: p.Topic, add: true}
		}

	case CmdUnsubscribe:
		var p struct{ Topic string `json:"topic"` }
		if json.Unmarshal(cmd.Payload, &p) == nil && p.Topic != "" {
			c.hub.subscribe <- subscribeReq{client: c, topic: p.Topic, add: false}
		}

	case CmdPing:
		pong, _ := json.Marshal(map[string]any{
			"type": EventPong,
			"ts":   time.Now().UnixMilli(),
		})
		select {
		case c.send <- pong:
		default:
		}

	default:
		// Dispatch to registered handlers
		c.hub.handlersMu.RLock()
		handler, ok := c.hub.handlers[cmd.Type]
		c.hub.handlersMu.RUnlock()
		if ok {
			// Dispatch synchronously so a single client's commands are processed
			// in arrival order. readPump reads one message at a time, and every
			// handler does quick setup then spawns its own goroutine for the
			// long-running work — so this never blocks the read loop. (Using a
			// goroutine here reordered stateful command pairs like
			// flow.start→flow.stop→flow.start, which could land as
			// start→start→stop and cancel the live subscription → no events.)
			handler(c.id, cmd.Payload)
		} else {
			slog.Warn("unknown ws command", "type", cmd.Type, "id", c.id)
			errMsg, _ := json.Marshal(map[string]any{
				"type": EventError,
				"ts":   time.Now().UnixMilli(),
				"data": map[string]string{
					"code":    "UNKNOWN_COMMAND",
					"message": fmt.Sprintf("unknown command: %s", cmd.Type),
				},
			})
			select {
			case c.send <- errMsg:
			default:
			}
		}
	}
}
