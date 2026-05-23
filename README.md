# NatsUI — NATS & JetStream Control Plane

> A production-grade, developer-first observability platform for NATS and JetStream.  
> Built for infrastructure engineers operating high-throughput event-driven systems.

```
  ███╗   ██╗ █████╗ ████████╗███████╗    ██╗   ██╗██╗
  ████╗  ██║██╔══██╗╚══██╔══╝██╔════╝    ██║   ██║██║
  ██╔██╗ ██║███████║   ██║   ███████╗    ██║   ██║██║
  ██║╚██╗██║██╔══██║   ██║   ╚════██║    ██║   ██║██║
  ██║ ╚████║██║  ██║   ██║   ███████║    ╚██████╔╝██║
  ╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝   ╚══════╝     ╚═════╝ ╚═╝
```

---

## What it is

NatsUI is **not** a CRUD admin dashboard. It is a realtime distributed systems control plane — the kind of tooling senior backend and platform engineers trust in production.

| Capability | Description |
|---|---|
| **Cluster Topology** | Live graph of NATS cluster — nodes, routes, replication, health |
| **Stream Explorer** | Inspect JetStream streams, retention, storage, subject hierarchies |
| **Consumer Inspector** | Consumer lag, ACK tracing, redelivery storm detection |
| **Live Message Tail** | `kubectl logs -f` quality message streaming with filters |
| **Replay Studio** | Temporal debugging — replay by timestamp, sequence, with throttling |
| **Dead Letter Queue** | Poison message analysis and redelivery visualization |
| **Metrics Dashboards** | Throughput, latency, consumer lag heatmaps |
| **Multi-Cluster** | Manage multiple NATS clusters from one control plane |
| **Smart Discovery** | Auto-detect NATS on localhost, Docker, Kubernetes |

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Browser (React)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐  │
│  │ Topology │  │  Tail    │  │ Replay   │  │ Metr  │  │
│  │  (Flow)  │  │ (xterm)  │  │ Studio   │  │  ics  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬───┘  │
│       └─────────────┴─────────────┴─────────────┘      │
│                   WebSocket / SSE                        │
└─────────────────────────┬──────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────┐
│               Go Gateway (Backend)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  WS Hub  │  │ REST API │  │ Metrics  │             │
│  │ (fanout) │  │  (chi)   │  │ Aggreg.  │             │
│  └────┬─────┘  └──────────┘  └──────────┘             │
│       │                                                 │
│  ┌────▼──────────────────────────────────────┐         │
│  │           Discovery Manager               │         │
│  │  ┌────────┐  ┌────────┐  ┌────────┐      │         │
│  │  │ Local  │  │ Docker │  │  K8s   │      │         │
│  │  └────────┘  └────────┘  └────────┘      │         │
│  └───────────────────────────────────────────┘         │
│                                                         │
│  ┌──────────────────────────────────────────┐          │
│  │           NATS Connection Pool            │          │
│  │   ┌────────┐  ┌────────┐  ┌────────┐    │          │
│  │   │Cluster1│  │Cluster2│  │Cluster3│    │          │
│  │   └────────┘  └────────┘  └────────┘    │          │
│  └──────────────────────────────────────────┘          │
└────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Go 1.22+
- Node 20+
- Docker + Docker Compose (for local NATS)

### 1. Start a local NATS cluster

```bash
docker compose up nats1 nats2 nats3 -d
```

### 2. Run the backend

```bash
cd backend
go run ./cmd/natsui
```

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — NatsUI auto-discovers your local NATS cluster.

---

## Full Stack (Docker Compose)

```bash
# Start everything: NATS cluster + backend + frontend
make up

# Tail logs
make logs

# Stop
make down
```

---

## Stack

### Frontend
| Tech | Role |
|---|---|
| React 18 + TypeScript | UI framework |
| TailwindCSS | Styling — dark-mode-first design system |
| Zustand | Client state management |
| TanStack Query | Server state + caching |
| React Flow | Cluster topology graph |
| Monaco Editor | Payload inspection / editing |
| xterm.js | Terminal-quality message tail |
| @tanstack/react-virtual | Virtualised lists (millions of messages) |
| cmdk | Command palette (⌘K) |
| Recharts | Metrics visualisation |
| framer-motion | Minimal, purposeful animations |

### Backend
| Tech | Role |
|---|---|
| Go 1.22 | Backend runtime |
| chi | HTTP router |
| gorilla/websocket | WebSocket gateway |
| nats.go | NATS native client |
| Docker SDK | Container discovery |
| client-go | Kubernetes discovery |

---

## Project Structure

```
nats-ui/
├── backend/
│   ├── cmd/natsui/          # Entrypoint
│   ├── internal/
│   │   ├── api/             # REST handlers
│   │   ├── gateway/         # WebSocket hub + fanout
│   │   ├── discovery/       # Plugin-based server discovery
│   │   │   ├── local/
│   │   │   ├── docker/
│   │   │   └── k8s/
│   │   ├── nats/            # Connection pool + client
│   │   ├── jetstream/       # Stream + consumer inspection
│   │   ├── metrics/         # Aggregation + collection
│   │   └── replay/          # Replay orchestration
│   └── pkg/types/           # Shared domain types
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/      # AppShell, Sidebar, CommandPalette
│   │   │   ├── cluster/     # Topology, NodeCard
│   │   │   ├── streams/     # StreamExplorer, StreamDetail
│   │   │   ├── consumers/   # ConsumerInspector, LagHeatmap
│   │   │   ├── tail/        # MessageTail, PayloadViewer
│   │   │   ├── replay/      # ReplayStudio
│   │   │   ├── metrics/     # MetricsDashboard
│   │   │   └── ui/          # Design system components
│   │   ├── store/           # Zustand state
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # WS client, API client, utils
│   │   └── types/           # TypeScript types
│   └── ...
├── k8s/                     # Kubernetes manifests
├── docker-compose.yml
└── Makefile
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘T` | New message tail |
| `⌘R` | Open replay studio |
| `⌘G` | Cluster topology |
| `⌘S` | Stream explorer |
| `⌘C` | Consumer inspector |
| `⌘M` | Metrics dashboard |
| `⌘,` | Settings |
| `?` | Keyboard shortcuts help |
| `Esc` | Close panel / dismiss |

---

## WebSocket Event Protocol

The backend communicates with the frontend via a typed WebSocket protocol:

```typescript
// Server → Client
type ServerEvent =
  | { type: 'cluster.topology';   data: ClusterTopology }
  | { type: 'cluster.health';     data: NodeHealth[] }
  | { type: 'stream.list';        data: StreamInfo[] }
  | { type: 'stream.stats';       data: StreamStats }
  | { type: 'consumer.list';      data: ConsumerInfo[] }
  | { type: 'consumer.lag';       data: ConsumerLag }
  | { type: 'message.received';   data: TailedMessage }
  | { type: 'metrics.throughput'; data: ThroughputPoint }
  | { type: 'metrics.latency';    data: LatencyPoint }
  | { type: 'discovery.found';    data: NATSServer }
  | { type: 'replay.progress';    data: ReplayProgress }
  | { type: 'error';              data: ErrorEvent }

// Client → Server
type ClientCommand =
  | { type: 'tail.start';     payload: TailConfig }
  | { type: 'tail.stop';      payload: { id: string } }
  | { type: 'replay.start';   payload: ReplayConfig }
  | { type: 'replay.stop';    payload: { id: string } }
  | { type: 'subscribe';      payload: { topic: string } }
  | { type: 'unsubscribe';    payload: { topic: string } }
  | { type: 'metrics.watch';  payload: { streams: string[] } }
  | { type: 'ping' }
```

---

## Discovery Plugins

NatsUI uses a plugin-based discovery architecture. Out of the box:

| Plugin | Detects |
|---|---|
| **Local** | NATS on `localhost:4222`, `127.0.0.1:4222` |
| **Docker** | Containers with port `4222` exposed |
| **Kubernetes** | Services with label `app=nats` or `app.kubernetes.io/name=nats` |

Custom plugins implement the `discovery.Plugin` interface:

```go
type Plugin interface {
    Name() string
    Discover(ctx context.Context) ([]types.NATSServer, error)
    Watch(ctx context.Context, ch chan<- types.NATSServer) error
}
```

---

## Deployment

### Docker Compose

```bash
docker compose up -d
```

### Kubernetes

```bash
kubectl apply -f k8s/
```

---

## License

MIT

---

*Built for engineers who care about what happens inside their message bus.*
