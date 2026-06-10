# NatsUI — Project Status & Feature Map

> **Living doc — single source of truth for "what exists / what's a stub / what to work on".**
> For humans *and* AI agents. Update this whenever you ship, change, or remove a feature.
>
> Last updated: **2026-06-10** (Dead Letters analyzer shipped; uncommitted) · maintainer: Himanshu

---

## TL;DR

- NatsUI is a realtime **NATS + JetStream control plane** (Go backend + React/r3f frontend).
- The agreed **Tier 1·2·3 feature roadmap is COMPLETE** (KV, Request–Reply, Services, Consumer Lab,
  Config export, Health, Object Store, Latency, Backup/Restore, Federation topology).
- **1 stub** ships in the nav (Dead Letters), plus a handful of **misleading UI bits** and some
  **overlap** worth consolidating — see the backlogs below.
- **No next roadmap item is defined.** Candidate directions are in [Backlog → Product direction](#product-direction-candidates).

---

## How to run & verify (don't rediscover this each session)

| What | Command / value |
|---|---|
| UI dev server | `cd frontend && npm run dev` → http://localhost:5173 (Vite/HMR — the **only** UI port in dev) |
| Backend + cluster | `docker compose up -d` → backend `:8080`, nats1–5 |
| Prod frontend (`:3000`) | `docker compose --profile prod up -d` |
| Federation demo | `docker compose --profile federation up -d` (adds `nats-edge` gateway + `nats-leaf`) |
| App login | `admin` / `changeme` (see `natsui-config/natsui.json`) |
| Connected cluster id | `default` |
| API base | `http://localhost:8080/api/v1` · JWT via `POST /auth/login` |
| Pre-commit checks | backend `cd backend && go build ./...` · frontend `npm run typecheck` **and** `npm run lint` (eslint `--max-warnings 0`) |

---

## Feature inventory

Legend: ✅ shipped & working · ⚠️ works but thin/static · 🚧 stub / placeholder

### Monitor
| Feature | nav id | Frontend | Backend / route | Status |
|---|---|---|---|---|
| Overview | `overview` | `layout/AppShell.tsx` (`OverviewView`, inline) | — (static) | ⚠️ static cards + shortcut list; not a live dashboard |
| Topology (3D) | `topology` | `cluster/ClusterTopology.tsx` + `three/TopologyScene.tsx` | `metrics/aggregator.go` · `GET /clusters/{id}/topology` + WS flow | ✅ incl. Federation & Edge overlay |
| Metrics | `metrics` | `metrics/MetricsDashboard.tsx` | `GET /clusters/{id}/metrics/throughput` + WS | ✅ |
| Services (micro) | `services` | `services/ServicesExplorer.tsx` | `jetstream/services.go` · `GET …/services`, `…/services/ping` | ✅ |
| Health & Alerts | `health` | `health/HealthPanel.tsx` | client-computed from streams+consumers+topology · `GET …/health` | ✅ |
| Latency (RTT) | `latency` | `latency/ServerLatency.tsx` | `jetstream/rtt.go` · `GET …/rtt` | ✅ |

### Streams
| Feature | nav id | Frontend | Backend / route | Status |
|---|---|---|---|---|
| Streams | `streams` | `streams/StreamExplorer.tsx` | `GET/POST/PUT/DELETE …/streams` | ✅ |
| Consumers | `consumers` | `consumers/ConsumerInspector.tsx` | `…/streams/{stream}/consumers` | ✅ |
| Key-Value | `kv` | `kv/KVManager.tsx` | `jetstream/kv.go` · `…/kv*` (keys via `?key=`) | ✅ |
| Object Store | `objects` | `objects/ObjectStore.tsx` | `jetstream/objectstore.go` · `…/obj*` (names via `?name=`) | ✅ |
| Backup & Restore | `backup` | `backup/StreamBackupRestore.tsx` | `jetstream/backup.go` · `GET …/backup`, `POST …/restore` | ✅ **logical only** (see gotchas) |
| Accounts | `accounts` | `accounts/AccountsView.tsx` | `…/accounts`, `…/connz` | ✅ |

### Messages
| Feature | nav id | Frontend | Backend / route | Status |
|---|---|---|---|---|
| Live Tail | `tail` | `tail/MessageTail.tsx` | WS (`registerWSHandlers` → `TailStream`) | ✅ live subscribe |
| Message Browser | `browser` | `tail/MessageBrowser.tsx` | `GET …/streams/{stream}/messages` | ✅ stored, paginated 50/page |
| Publisher | `publisher` | `publisher/MessagePublisher.tsx` | `POST …/publish` | ✅ templates · `{{vars}}` · burst |
| Request–Reply | `request` | `request/RequestReplyConsole.tsx` | `jetstream/request.go` · `POST …/request` | ✅ |
| Replay Studio | `replay` | `replay/ReplayStudio.tsx` | WS (`handleReplayStart` → `ReplayStream`) | ✅ re-publishes stored msgs |
| Consumer Lab | `lab` | `debug/ConsumerLab.tsx` | `jetstream/debug.go` · `POST …/debug/fetch`, `…/debug/ack` | ✅ pull-fetch + ack/nak/term |

### Admin
| Feature | nav id | Frontend | Backend / route | Status |
|---|---|---|---|---|
| **Dead Letters (DLQ)** | `dlq` | `dlq/DeadLetterQueue.tsx` | `jetstream/dlq.go` · `GET …/dlq`, `GET …/dlq/message`, `POST …/dlq/redeliver`, `DELETE …/dlq` | ✅ advisory-based poison-message analyzer |

### Cross-cutting (not nav items)
| Feature | Where | Status |
|---|---|---|
| Settings / Connections | `AppShell.tsx` (`SettingsView`, `ConnectForm`, `ConnectionList`) | ✅ |
| App login + JWT | `auth/LoginPage.tsx`, `auth/ConnectionSetup.tsx` · `auth/auth.go` | ✅ |
| NATS auth (user/pass · token · creds · nkey · TLS) | `auth/NatsAuthFields.tsx` · `nats/pool.go` | ✅ |
| Server discovery (docker/local) | `discovery/*` · `…/discovery/scan`, `…/discovery/known` | ✅ |
| Config-as-code export (CLI/JSON/Terraform) | `export/ConfigExport.tsx` modal (in Stream/Consumer detail) | ✅ |
| Command Palette (⌘K) | `layout/CommandPalette.tsx` | ✅ (⌘K + Esc only — see misleading #2) |

---

## Architecture map (where things live)

```
frontend/src/
  components/<area>/        one folder per feature (cluster, streams, kv, tail, …)
  components/layout/        Sidebar (nav registry) · AppShell (view router) · TopBar · CommandPalette
  components/three/         r3f / WebGL topology scene + particle flow
  lib/                      api.ts (REST client) · ws.ts (WebSocket) · format.ts (formatNumber/Bytes) · gsap.ts
  store/                    zustand: useUIStore (activeView, …) · useDataStore (clusters, messages, …)
  types/index.ts           View union + all shared TS types

backend/internal/
  api/handler.go            ALL REST routes + registerWSHandlers (tail/flow/replay over WS)
  jetstream/*.go            per-feature inspectors (kv, objectstore, services, request, debug, backup, rtt)
  metrics/aggregator.go     topology + throughput (reads /varz /routez /gatewayz /leafz)
  nats/pool.go              connection pool + auth (authOptions)
  auth/auth.go              app login config + JWT
  discovery/*               docker + local server discovery plugins

nats-config/*.conf          per-node NATS configs       docker-compose.yml   stack + profiles (prod, federation)
```

---

## Known duplication / overlap (consolidation backlog)

- **🔴 Message views overlap** — `Live Tail` · `Message Browser` · `Replay Studio` · `Consumer Lab` all
  "deal with messages" with no signposting of which to use. Consider a shared core / clearer grouping.
- **🔴 `fmtMs()` duplicated** — same helper copy-pasted in `latency/ServerLatency.tsx` **and**
  `cluster/ClusterTopology.tsx`. RTT is also shown in Services + Request–Reply. → move `fmtMs` to `lib/format`.
- **🟠 Monitoring re-fetch** — `Overview`/`Metrics`/`Health`/`Topology`/`Latency` each fetch cluster data
  independently; `Health` re-pulls streams + all consumers + topology. No shared query/cache layer.
- **🟠 Message-composer built twice** — `Publisher` and `Request–Reply` each build subject+payload+headers forms.
- **🟡 Config serialization** — `Config-as-code export` and `Backup` both serialize `StreamConfig` separately.

## Known stubs & misleading UI (fix backlog)

- **🔴 Overview "Keyboard Shortcuts"** lists `G T / G S / G C / G L / G R / G M / ?` — **none are wired**
  (`CommandPalette.tsx` only handles ⌘K/Ctrl+K + Esc). Wire the chords or delete the dead rows.
- **🟠 "Backup & Restore" naming** implies a true snapshot; it's a logical re-publish. Rename / add caveat.
- **🟠 `npm run lint` is broken project-wide** — eslint `^9.13.0` is installed (needs a flat
  `eslint.config.js`) but the repo has no eslint config. Migrate to flat config or pin eslint v8. (Pre-existing.)
- ~~DLQ nav item is a "Coming soon" stub~~ — ✅ **shipped 2026-06-10** (real advisory-based analyzer).
- ~~Overview "Debug" card claims "analyze dead letters"~~ — now accurate (DLQ shipped); "trace ACKs" still only partial (Consumer Lab).

## Gotchas (don't re-learn the hard way)

- **Federation:** one NATS server may NOT define both a `gateway` and a `leafnode` listener without a
  system account (which also re-keys JetStream RAFT). We split them: gateway on **nats1**, leafnode on
  **nats2**; `nats-leaf` dials nats2:7422. (commits `7509f1f` + fix `99b48be`)
- **Backup is logical:** seqs/timestamps get reassigned on restore; cloning to a *new* stream with the
  *same* subjects fails (`subjects overlap`). Primary use = re-seed same name / recreate-after-delete.
- **Consumers API returns `null`** for empty (not `[]`) — always coerce `null → []` before iterating.
- **KV keys / object names** go in **query params** (`?key=` / `?name=`), not the path (they contain dots/slashes).
- **Topology** has a GPU/WebGL confirmation gate before mounting the heavy Three.js scene
  (localStorage `natsui-topology-gpu-ack`).

---

## Backlog / what to work on next

### P0 — quick, unambiguous wins
- [ ] Dedupe `fmtMs()` → `lib/format` and reuse everywhere RTT is shown.
- [ ] Fix Overview shortcuts: wire `G _` chords + `?`, or remove the rows that don't work.
- [ ] DLQ: decide **build vs hide** the nav item (stop advertising a stub).
- [ ] Rename "Backup & Restore" → "Logical Backup" or add an in-UI caveat.

### P1 — real features / consolidation
- [x] ~~Build the **Dead Letters / poison-message analyzer**~~ — ✅ shipped 2026-06-10 (`dlq/DeadLetterQueue.tsx` + `jetstream/dlq.go`).
- [ ] Make **Overview** a real live dashboard (cluster summary, not static cards).
- [ ] Shared **message-composer** component for Publisher + Request–Reply.
- [ ] Shared **query/cache layer** for the monitoring views (stop redundant fetches).

### Product direction candidates
*(no roadmap item is currently defined — pick one with the user)*
- Automated tests (project is currently hand-verified only).
- App-level **auth / RBAC** hardening (today: single `admin`/`changeme`).
- **Multi-cluster** management UX.
- Visual / UX polish pass.

---

> When you finish something here, tick the box, move the row's status, and bump the "Last updated" line.
