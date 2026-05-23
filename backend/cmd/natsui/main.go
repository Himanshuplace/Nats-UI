package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/Himanshuplace/nats-ui/internal/api"
	"github.com/Himanshuplace/nats-ui/internal/discovery"
	discoverdocker "github.com/Himanshuplace/nats-ui/internal/discovery/docker"
	discoverlocal "github.com/Himanshuplace/nats-ui/internal/discovery/local"
	"github.com/Himanshuplace/nats-ui/internal/gateway"
	"github.com/Himanshuplace/nats-ui/internal/metrics"
	natsmgr "github.com/Himanshuplace/nats-ui/internal/nats"
)

func main() {
	setupLogging()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	hub := gateway.NewHub()
	go hub.Run()

	pool := natsmgr.NewPool()

	dm := discovery.NewManager(hub)
	dm.Register("local", discoverlocal.New())
	dm.Register("docker", discoverdocker.New())

	// Auto-connect if NATS_URL is set
	if url := os.Getenv("NATS_URL"); url != "" {
		if _, err := pool.ConnectURL("default", url); err != nil {
			slog.Warn("auto-connect failed", "url", url, "err", err)
		} else {
			slog.Info("auto-connected to NATS", "url", url)
		}
	}

	// Start background discovery
	go dm.Start(ctx)

	// Start metrics aggregation
	agg := metrics.NewAggregator(hub, pool)
	go agg.Run(ctx)

	// Router
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(slogMiddleware)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", "http://localhost:3000", "http://localhost:4173"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"natsui","clients":` +
			string(rune('0'+hub.ClientCount())) + `}`))
	})

	r.Route("/api/v1", func(r chi.Router) {
		api.Mount(r, hub, pool, dm)
	})

	port := env("PORT", "8080")
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // Streaming — no write timeout
		IdleTimeout:  120 * time.Second,
	}

	slog.Info("NatsUI starting", "addr", srv.Addr, "version", "0.1.0")

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool.CloseAll()
	srv.Shutdown(shutdownCtx)
	slog.Info("shutdown complete")
}

func setupLogging() {
	level := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))
}

func slogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		slog.Debug("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"latency_ms", time.Since(start).Milliseconds(),
		)
	})
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
