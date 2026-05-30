# Docker Compose Guide

## Prerequisites

- Docker Desktop running
- `.env` file or environment variables set (optional)

---

## Quick Start

```bash
docker compose up --build -d
```

App is available at **http://localhost:3000**

Default login: `admin` / `changeme`
(credentials stored in `./natsui-config/natsui.json` after first run)

---

## Daily Workflow

### Pull latest changes and restart

```bash
git pull origin main && docker compose up --build -d
```

Rebuilds only what changed (Docker layer cache skips unchanged layers), swaps running containers.

---

## Rebuilding Containers

### Rebuild everything

```bash
docker compose up --build -d
```

### Rebuild a single service (faster)

```bash
docker compose up --build -d frontend   # only frontend changed
docker compose up --build -d backend    # only backend changed
```

NATS containers are untouched.

### Build images without stopping running containers

```bash
docker compose build          # build new images silently
docker compose up -d          # swap to new images with minimal downtime
```

---

## Managing Running Containers

### Check status

```bash
docker compose ps
```

### View logs

```bash
docker compose logs -f              # all services (live)
docker compose logs -f backend      # backend only
docker compose logs -f frontend     # frontend only
docker compose logs --tail=100 backend  # last 100 lines
```

### Restart a single service

```bash
docker compose restart backend
docker compose restart frontend
```

### Stop everything (keeps volumes)

```bash
docker compose down
```

### Stop and remove all containers + images

```bash
docker compose down --rmi all
```

---

## Data & Volumes

| Volume | Contains | Wiped by |
|---|---|---|
| `nats1-data` | NATS stream data (node 1) | `docker compose down -v` |
| `nats2-data` | NATS stream data (node 2) | `docker compose down -v` |
| `nats3-data` | NATS stream data (node 3) | `docker compose down -v` |
| `./natsui-config/` | Login credentials + saved connections | Manual delete |

### Full reset (wipes all NATS stream data)

```bash
docker compose down -v
docker compose up --build -d
```

> **Warning:** `-v` destroys all JetStream messages and consumer state.

---

## Configuration

### Change login credentials

Edit `./natsui-config/natsui.json`:

```json
{
  "auth": {
    "username": "admin",
    "password": "your-new-password",
    "secret": "keep-this-random-string"
  },
  "connections_file": "./natsui-connections.json"
}
```

Then restart the backend:

```bash
docker compose restart backend
```

### Change NATS auth token

```bash
NATS_AUTH_TOKEN=my-secret-token docker compose up -d
```

Or set it in a `.env` file at the project root:

```env
NATS_AUTH_TOKEN=my-secret-token
```

### Expose to other machines on the network

Add to the backend service environment in `docker-compose.yml`:

```yaml
environment:
  - NATSUI_ALLOWED_ORIGINS=http://YOUR_SERVER_IP:3000
```

---

## Services Overview

| Service | Port | Description |
|---|---|---|
| `frontend` | `3000` | React UI (Nginx) |
| `backend` | `8080` | Go API + WebSocket |
| `nats1` | `4222` / `8222` | NATS node 1 (leader candidate) |
| `nats2` | `4223` / `8223` | NATS node 2 |
| `nats3` | `4224` / `8224` | NATS node 3 |

---

## Troubleshooting

### Frontend shows old version after rebuild

```bash
docker compose down
docker compose up --build -d
```

Force Docker to discard the build cache:

```bash
docker compose build --no-cache frontend
docker compose up -d
```

### Backend can't connect to NATS

```bash
docker compose logs backend   # look for "auto-connect failed"
docker compose logs nats1     # check NATS is healthy
docker compose restart backend
```

### Port already in use

```bash
docker compose down           # free the ports
docker compose up --build -d
```

### View all container resource usage

```bash
docker stats
```
