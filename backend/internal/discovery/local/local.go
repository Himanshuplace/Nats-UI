package local

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/Himanshuplace/nats-ui/internal/discovery"
	"github.com/Himanshuplace/nats-ui/pkg/types"
)

var candidates = []struct {
	host        string
	clientPort  int
	monitorPort int
}{
	{"127.0.0.1", 4222, 8222},
	{"localhost", 4222, 8222},
	{"127.0.0.1", 4223, 8223},
	{"127.0.0.1", 4224, 8224},
}

// Plugin discovers NATS servers running on localhost.
type Plugin struct {
	client *http.Client
}

func New() *Plugin {
	return &Plugin{
		client: &http.Client{Timeout: 2 * time.Second},
	}
}

func (p *Plugin) Name() string { return "local" }

func (p *Plugin) Discover(ctx context.Context) ([]types.NATSServer, error) {
	var found []types.NATSServer

	for _, c := range candidates {
		if !p.tcpOpen(c.host, c.clientPort) {
			continue
		}

		server := types.NATSServer{
			ID:          fmt.Sprintf("local-%s-%d", c.host, c.clientPort),
			Name:        fmt.Sprintf("local@%s:%d", c.host, c.clientPort),
			Host:        c.host,
			ClientPort:  c.clientPort,
			MonitorPort: c.monitorPort,
			Source:      types.SourceLocal,
			DiscoveredAt: time.Now(),
		}

		// Enrich with monitoring info if available
		if info := p.fetchMonitor(ctx, c.host, c.monitorPort); info != nil {
			if name, ok := info["server_name"].(string); ok {
				server.Name = name
			}
		}

		found = append(found, server)
	}

	return found, nil
}

// Watch polls every 10 seconds for local NATS servers.
func (p *Plugin) Watch(ctx context.Context, ch chan<- discovery.Event) error {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			servers, err := p.Discover(ctx)
			if err != nil {
				continue
			}
			for _, s := range servers {
				select {
				case ch <- discovery.Event{Kind: discovery.EventFound, Server: s}:
				case <-ctx.Done():
					return nil
				}
			}
		}
	}
}

func (p *Plugin) tcpOpen(host string, port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func (p *Plugin) fetchMonitor(ctx context.Context, host string, port int) map[string]any {
	url := fmt.Sprintf("http://%s:%d/varz", host, port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	var info map[string]any
	json.NewDecoder(resp.Body).Decode(&info)
	return info
}
