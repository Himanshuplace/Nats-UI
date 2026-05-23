package docker

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	dockertypes "github.com/docker/docker/api/types"
	dockerclient "github.com/docker/docker/client"

	"github.com/Himanshuplace/nats-ui/internal/discovery"
	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// Plugin discovers NATS servers running in Docker containers.
type Plugin struct {
	cli *dockerclient.Client
}

func New() *Plugin {
	cli, err := dockerclient.NewClientWithOpts(
		dockerclient.FromEnv,
		dockerclient.WithAPIVersionNegotiation(),
	)
	if err != nil {
		slog.Warn("docker client init failed — docker discovery disabled", "err", err)
		return &Plugin{}
	}
	return &Plugin{cli: cli}
}

func (p *Plugin) Name() string { return "docker" }

func (p *Plugin) Discover(ctx context.Context) ([]types.NATSServer, error) {
	if p.cli == nil {
		return nil, nil
	}

	filterArgs := filters.NewArgs()
	filterArgs.Add("status", "running")

	containers, err := p.cli.ContainerList(ctx, container.ListOptions{
		Filters: filterArgs,
	})
	if err != nil {
		return nil, fmt.Errorf("docker list containers: %w", err)
	}

	var found []types.NATSServer

	for _, c := range containers {
		if !isNATSContainer(c.Image, c.Labels) {
			continue
		}

		clientPort, monitorPort := extractPorts(c.Ports)
		if clientPort == 0 {
			continue
		}

		name := strings.TrimPrefix(c.Names[0], "/")
		labels := make(map[string]string)
		for k, v := range c.Labels {
			labels[k] = v
		}

		server := types.NATSServer{
			ID:           fmt.Sprintf("docker-%s", c.ID[:12]),
			Name:         name,
			Host:         "127.0.0.1",
			ClientPort:   clientPort,
			MonitorPort:  monitorPort,
			Source:       types.SourceDocker,
			Labels:       labels,
			DiscoveredAt: time.Now(),
		}
		found = append(found, server)
	}

	return found, nil
}

func (p *Plugin) Watch(ctx context.Context, ch chan<- discovery.Event) error {
	if p.cli == nil {
		return nil
	}

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			servers, err := p.Discover(ctx)
			if err != nil {
				slog.Warn("docker discovery error", "err", err)
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

func isNATSContainer(image string, labels map[string]string) bool {
	img := strings.ToLower(image)
	if strings.Contains(img, "nats") {
		return true
	}
	if labels["app"] == "nats" ||
		labels["natsui.discover"] == "true" ||
		labels["app.kubernetes.io/name"] == "nats" {
		return true
	}
	return false
}

func extractPorts(ports []dockertypes.Port) (clientPort, monitorPort int) {
	for _, p := range ports {
		if p.PublicPort == 0 {
			continue
		}
		switch p.PrivatePort {
		case 4222:
			clientPort = int(p.PublicPort)
		case 8222:
			monitorPort = int(p.PublicPort)
		}
	}
	return
}
