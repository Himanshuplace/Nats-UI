package nats

import (
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/Himanshuplace/nats-ui/pkg/types"
	natsgo "github.com/nats-io/nats.go"
)

// ManagedConn wraps a NATS connection with metadata.
type ManagedConn struct {
	ID       string
	Profile  types.ConnectionProfile
	NC       *natsgo.Conn
	JS       natsgo.JetStreamContext
	mu       sync.RWMutex
	connectedAt time.Time
}

// IsJetStream returns true if JetStream is available on this connection.
func (mc *ManagedConn) IsJetStream() bool {
	mc.mu.RLock()
	defer mc.mu.RUnlock()
	return mc.JS != nil
}

// Pool manages multiple named NATS connections.
type Pool struct {
	conns map[string]*ManagedConn
	mu    sync.RWMutex
}

func NewPool() *Pool {
	return &Pool{
		conns: make(map[string]*ManagedConn),
	}
}

// Connect establishes a new NATS connection from a profile and stores it in the pool.
func (p *Pool) Connect(profile types.ConnectionProfile) (*ManagedConn, error) {
	// Derive host and port from URL if not explicit
	if profile.Host == "" || profile.ClientPort == 0 {
		if u, err := url.Parse(profile.URL); err == nil {
			profile.Host = u.Hostname()
			if port, err := strconv.Atoi(u.Port()); err == nil {
				profile.ClientPort = port
			}
		}
	}
	if profile.Host == "" {
		profile.Host = "localhost"
	}
	if profile.ClientPort == 0 {
		profile.ClientPort = 4222
	}
	if profile.MonitorPort == 0 {
		profile.MonitorPort = 8222
	}

	opts := []natsgo.Option{
		natsgo.Name("natsui-" + profile.ID),
		natsgo.MaxReconnects(-1),
		natsgo.ReconnectWait(2 * time.Second),
		natsgo.Timeout(10 * time.Second),
		natsgo.DisconnectErrHandler(func(nc *natsgo.Conn, err error) {
			slog.Warn("nats disconnected", "id", profile.ID, "err", err)
		}),
		natsgo.ReconnectHandler(func(nc *natsgo.Conn) {
			slog.Info("nats reconnected", "id", profile.ID, "url", nc.ConnectedUrl())
		}),
	}

	if profile.Token != "" {
		opts = append(opts, natsgo.Token(profile.Token))
	}
	if profile.CredsPath != "" {
		opts = append(opts, natsgo.UserCredentials(profile.CredsPath))
	}
	if profile.NKeyPath != "" {
		if nkeyOpt, err := natsgo.NkeyOptionFromSeed(profile.NKeyPath); err == nil {
			opts = append(opts, nkeyOpt)
		}
	}
	if profile.TLSCert != "" && profile.TLSKey != "" {
		opts = append(opts, natsgo.ClientCert(profile.TLSCert, profile.TLSKey))
	}
	if profile.TLSCA != "" {
		opts = append(opts, natsgo.RootCAs(profile.TLSCA))
	}

	nc, err := natsgo.Connect(profile.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("connect to %s: %w", profile.URL, err)
	}

	mc := &ManagedConn{
		ID:          profile.ID,
		Profile:     profile,
		NC:          nc,
		connectedAt: time.Now(),
	}

	// Try JetStream
	js, err := nc.JetStream(natsgo.PublishAsyncMaxPending(4096))
	if err == nil {
		mc.JS = js
		slog.Info("jetstream enabled", "id", profile.ID)
	} else {
		slog.Info("jetstream not available", "id", profile.ID, "reason", err)
	}

	p.mu.Lock()
	p.conns[profile.ID] = mc
	p.mu.Unlock()

	slog.Info("nats connection added to pool", "id", profile.ID, "url", profile.URL)
	return mc, nil
}

// ConnectURL is a convenience method for connecting with just a URL.
func (p *Pool) ConnectURL(id, url string) (*ManagedConn, error) {
	return p.Connect(types.ConnectionProfile{
		ID:   id,
		Name: id,
		URL:  url,
	})
}

// Get retrieves a managed connection by ID.
func (p *Pool) Get(id string) (*ManagedConn, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	mc, ok := p.conns[id]
	return mc, ok
}

// List returns all managed connections.
func (p *Pool) List() []*ManagedConn {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]*ManagedConn, 0, len(p.conns))
	for _, mc := range p.conns {
		out = append(out, mc)
	}
	return out
}

// Remove disconnects and removes a connection from the pool.
func (p *Pool) Remove(id string) {
	p.mu.Lock()
	mc, ok := p.conns[id]
	if ok {
		delete(p.conns, id)
	}
	p.mu.Unlock()

	if ok {
		mc.NC.Drain()
		slog.Info("nats connection removed", "id", id)
	}
}

// CloseAll drains all connections gracefully.
func (p *Pool) CloseAll() {
	p.mu.Lock()
	ids := make([]string, 0, len(p.conns))
	for id := range p.conns {
		ids = append(ids, id)
	}
	p.mu.Unlock()

	for _, id := range ids {
		p.Remove(id)
	}
}
