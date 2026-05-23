package discovery

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/Himanshuplace/nats-ui/internal/gateway"
	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// Plugin is the interface that all discovery backends implement.
type Plugin interface {
	Name() string
	// Discover performs a one-shot scan and returns found servers.
	Discover(ctx context.Context) ([]types.NATSServer, error)
	// Watch streams server discovery events continuously until ctx is cancelled.
	Watch(ctx context.Context, ch chan<- Event) error
}

// EventKind classifies a discovery event.
type EventKind string

const (
	EventFound EventKind = "found"
	EventLost  EventKind = "lost"
)

// Event is emitted by a plugin when a server appears or disappears.
type Event struct {
	Kind   EventKind
	Server types.NATSServer
}

// Manager orchestrates all registered discovery plugins.
type Manager struct {
	hub      *gateway.Hub
	plugins  map[string]Plugin
	known    map[string]types.NATSServer
	mu       sync.RWMutex
	scanOnce sync.Once
}

func NewManager(hub *gateway.Hub) *Manager {
	return &Manager{
		hub:     hub,
		plugins: make(map[string]Plugin),
		known:   make(map[string]types.NATSServer),
	}
}

// Register adds a discovery plugin.
func (m *Manager) Register(name string, p Plugin) {
	m.mu.Lock()
	m.plugins[name] = p
	m.mu.Unlock()
	slog.Info("discovery plugin registered", "name", name)
}

// Start kicks off background scanning across all plugins.
func (m *Manager) Start(ctx context.Context) {
	ch := make(chan Event, 256)

	// Launch each plugin watcher
	m.mu.RLock()
	plugins := make([]Plugin, 0, len(m.plugins))
	for _, p := range m.plugins {
		plugins = append(plugins, p)
	}
	m.mu.RUnlock()

	for _, p := range plugins {
		go func(plug Plugin) {
			if err := plug.Watch(ctx, ch); err != nil && ctx.Err() == nil {
				slog.Error("discovery plugin watch error", "plugin", plug.Name(), "err", err)
			}
		}(p)
	}

	// Periodic rescan every 30 seconds
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Initial scan
	go m.scan(ctx, ch)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			go m.scan(ctx, ch)
		case evt := <-ch:
			m.handleEvent(evt)
		}
	}
}

// Scan performs a one-shot discovery across all plugins and returns results.
func (m *Manager) Scan(ctx context.Context) []types.NATSServer {
	ch := make(chan Event, 256)
	go m.scan(ctx, ch)

	m.mu.RLock()
	out := make([]types.NATSServer, 0, len(m.known))
	for _, s := range m.known {
		out = append(out, s)
	}
	m.mu.RUnlock()
	return out
}

func (m *Manager) scan(ctx context.Context, ch chan<- Event) {
	m.mu.RLock()
	plugins := make([]Plugin, 0, len(m.plugins))
	for _, p := range m.plugins {
		plugins = append(plugins, p)
	}
	m.mu.RUnlock()

	var wg sync.WaitGroup
	for _, p := range plugins {
		wg.Add(1)
		go func(plug Plugin) {
			defer wg.Done()
			servers, err := plug.Discover(ctx)
			if err != nil {
				slog.Warn("discovery scan error", "plugin", plug.Name(), "err", err)
				return
			}
			for _, s := range servers {
				select {
				case ch <- Event{Kind: EventFound, Server: s}:
				case <-ctx.Done():
					return
				}
			}
		}(p)
	}
	wg.Wait()

	m.hub.Broadcast(gateway.EventDiscoveryScanned, map[string]any{
		"count": len(m.known),
	})
}

func (m *Manager) handleEvent(evt Event) {
	switch evt.Kind {
	case EventFound:
		m.mu.Lock()
		_, already := m.known[evt.Server.ID]
		m.known[evt.Server.ID] = evt.Server
		m.mu.Unlock()

		if !already {
			slog.Info("nats server discovered", "id", evt.Server.ID, "host", evt.Server.Host, "source", evt.Server.Source)
			m.hub.Broadcast(gateway.EventDiscoveryFound, evt.Server)
		}

	case EventLost:
		m.mu.Lock()
		delete(m.known, evt.Server.ID)
		m.mu.Unlock()

		slog.Info("nats server lost", "id", evt.Server.ID)
		m.hub.Broadcast(gateway.EventDiscoveryLost, evt.Server)
	}
}

// Known returns all currently known servers.
func (m *Manager) Known() []types.NATSServer {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]types.NATSServer, 0, len(m.known))
	for _, s := range m.known {
		out = append(out, s)
	}
	return out
}
