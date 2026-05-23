.PHONY: up down logs build dev backend frontend lint test clean

# ── Local dev ──────────────────────────────────────────
up:
	docker compose up -d

down:
	docker compose down -v

logs:
	docker compose logs -f

nats-up:
	docker compose up nats1 nats2 nats3 -d

# ── Backend ────────────────────────────────────────────
backend:
	cd backend && go run ./cmd/natsui

backend-build:
	cd backend && CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/natsui ./cmd/natsui

backend-test:
	cd backend && go test ./... -race -count=1

backend-lint:
	cd backend && golangci-lint run ./...

backend-tidy:
	cd backend && go mod tidy

# ── Frontend ───────────────────────────────────────────
frontend:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

frontend-lint:
	cd frontend && npm run lint

frontend-install:
	cd frontend && npm install

# ── Full dev (parallel) ────────────────────────────────
dev:
	@make nats-up
	@echo "Starting backend and frontend in parallel..."
	$(MAKE) -j2 backend frontend

# ── Docker build ───────────────────────────────────────
docker-build:
	docker build -f backend/Dockerfile -t natsui-backend:latest ./backend
	docker build -f frontend/Dockerfile -t natsui-frontend:latest ./frontend

# ── K8s deploy ─────────────────────────────────────────
k8s-apply:
	kubectl apply -f k8s/

k8s-delete:
	kubectl delete -f k8s/

# ── Cleanup ────────────────────────────────────────────
clean:
	rm -rf backend/bin/
	rm -rf frontend/dist/
	rm -rf frontend/node_modules/
