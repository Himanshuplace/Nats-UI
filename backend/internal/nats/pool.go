package nats

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Himanshuplace/nats-ui/pkg/types"
	natsgo "github.com/nats-io/nats.go"
)

// ManagedConn wraps a NATS connection with metadata.
type ManagedConn struct {
	ID          string
	Profile     types.ConnectionProfile
	NC          *natsgo.Conn
	JS          natsgo.JetStreamContext
	mu          sync.RWMutex
	connectedAt time.Time
	tempFiles   []string // temp credential files to clean up on Remove
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
	// Derive host and port from URL if not explicit.
	// For multi-server URLs (comma-separated), use only the first server for monitoring.
	if profile.Host == "" || profile.ClientPort == 0 {
		firstURL := profile.URL
		if idx := strings.IndexByte(firstURL, ','); idx > 0 {
			firstURL = firstURL[:idx]
		}
		if u, err := url.Parse(firstURL); err == nil {
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

	// Track any temp credential files so we can clean them up on Remove.
	var tempFiles []string
	cleanupTemp := func() {
		for _, f := range tempFiles {
			_ = os.Remove(f)
		}
	}

	// ── Authentication ──────────────────────────────────────────────────────
	if profile.Username != "" {
		opts = append(opts, natsgo.UserInfo(profile.Username, profile.Password))
	}
	if profile.Token != "" {
		opts = append(opts, natsgo.Token(profile.Token))
	}

	// Credentials (JWT): pasted content wins over file path.
	if profile.CredsContent != "" {
		path, err := writeTempSecret("natsui-creds-"+profile.ID+"-*.creds", profile.CredsContent)
		if err != nil {
			return nil, fmt.Errorf("write creds: %w", err)
		}
		tempFiles = append(tempFiles, path)
		opts = append(opts, natsgo.UserCredentials(path))
	} else if profile.CredsPath != "" {
		opts = append(opts, natsgo.UserCredentials(profile.CredsPath))
	}

	// NKey: pasted seed wins over file path.
	if profile.NKeySeed != "" {
		path, err := writeTempSecret("natsui-nkey-"+profile.ID+"-*.nk", profile.NKeySeed)
		if err != nil {
			return nil, fmt.Errorf("write nkey seed: %w", err)
		}
		tempFiles = append(tempFiles, path)
		if nkeyOpt, err := natsgo.NkeyOptionFromSeed(path); err == nil {
			opts = append(opts, nkeyOpt)
		} else {
			cleanupTemp()
			return nil, fmt.Errorf("invalid nkey seed: %w", err)
		}
	} else if profile.NKeyPath != "" {
		if nkeyOpt, err := natsgo.NkeyOptionFromSeed(profile.NKeyPath); err == nil {
			opts = append(opts, nkeyOpt)
		}
	}

	// TLS
	if profile.TLSCert != "" && profile.TLSKey != "" {
		opts = append(opts, natsgo.ClientCert(profile.TLSCert, profile.TLSKey))
	}
	if profile.TLSCAContent != "" {
		path, err := writeTempSecret("natsui-ca-"+profile.ID+"-*.pem", profile.TLSCAContent)
		if err != nil {
			return nil, fmt.Errorf("write tls ca: %w", err)
		}
		tempFiles = append(tempFiles, path)
		opts = append(opts, natsgo.RootCAs(path))
	} else if profile.TLSCA != "" {
		opts = append(opts, natsgo.RootCAs(profile.TLSCA))
	}

	nc, err := natsgo.Connect(profile.URL, opts...)
	if err != nil {
		cleanupTemp()
		return nil, fmt.Errorf("connect to %s: %w", profile.URL, err)
	}

	mc := &ManagedConn{
		ID:          profile.ID,
		Profile:     profile,
		NC:          nc,
		connectedAt: time.Now(),
		tempFiles:   tempFiles,
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

// writeTempSecret writes credential content to a 0600 temp file and returns its
// path. pattern follows os.CreateTemp semantics (a "*" is replaced by a random
// string). Used to materialize browser-pasted creds/nkey/CA into files that the
// nats.go client options can read.
func writeTempSecret(pattern, content string) (string, error) {
	f, err := os.CreateTemp(filepath.Join(os.TempDir()), pattern)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if err := f.Chmod(0o600); err != nil {
		// best-effort on platforms that support it; ignore otherwise
		_ = err
	}
	if _, err := f.WriteString(content); err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// authOptions builds the NATS auth options (user/pass, token, creds, nkey, TLS)
// for a profile, returning any temp credential files the caller must clean up.
// Mirrors Connect's auth handling; used by ProbeRTT for one-off dials.
func authOptions(profile types.ConnectionProfile) ([]natsgo.Option, []string, error) {
	var opts []natsgo.Option
	var tempFiles []string
	if profile.Username != "" {
		opts = append(opts, natsgo.UserInfo(profile.Username, profile.Password))
	}
	if profile.Token != "" {
		opts = append(opts, natsgo.Token(profile.Token))
	}
	if profile.CredsContent != "" {
		path, err := writeTempSecret("natsui-creds-"+profile.ID+"-*.creds", profile.CredsContent)
		if err != nil {
			return nil, tempFiles, fmt.Errorf("write creds: %w", err)
		}
		tempFiles = append(tempFiles, path)
		opts = append(opts, natsgo.UserCredentials(path))
	} else if profile.CredsPath != "" {
		opts = append(opts, natsgo.UserCredentials(profile.CredsPath))
	}
	if profile.NKeySeed != "" {
		path, err := writeTempSecret("natsui-nkey-"+profile.ID+"-*.nk", profile.NKeySeed)
		if err != nil {
			return nil, tempFiles, fmt.Errorf("write nkey seed: %w", err)
		}
		tempFiles = append(tempFiles, path)
		if nk, err := natsgo.NkeyOptionFromSeed(path); err == nil {
			opts = append(opts, nk)
		} else {
			return nil, tempFiles, fmt.Errorf("invalid nkey seed: %w", err)
		}
	} else if profile.NKeyPath != "" {
		if nk, err := natsgo.NkeyOptionFromSeed(profile.NKeyPath); err == nil {
			opts = append(opts, nk)
		}
	}
	if profile.TLSCert != "" && profile.TLSKey != "" {
		opts = append(opts, natsgo.ClientCert(profile.TLSCert, profile.TLSKey))
	}
	if profile.TLSCAContent != "" {
		path, err := writeTempSecret("natsui-ca-"+profile.ID+"-*.pem", profile.TLSCAContent)
		if err != nil {
			return nil, tempFiles, fmt.Errorf("write tls ca: %w", err)
		}
		tempFiles = append(tempFiles, path)
		opts = append(opts, natsgo.RootCAs(path))
	} else if profile.TLSCA != "" {
		opts = append(opts, natsgo.RootCAs(profile.TLSCA))
	}
	return opts, tempFiles, nil
}

// ProbeRTT dials a single server URL (reusing the managed connection's auth)
// and measures round-trip time over a few PINGs.
func (p *Pool) ProbeRTT(clusterID, serverURL string, samples int) types.RTTResult {
	res := types.RTTResult{Server: serverURL}
	mc, ok := p.Get(clusterID)
	if !ok {
		res.Error = "cluster not connected"
		return res
	}
	authOpts, tempFiles, err := authOptions(mc.Profile)
	defer func() {
		for _, f := range tempFiles {
			_ = os.Remove(f)
		}
	}()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	if samples < 1 {
		samples = 5
	}
	opts := append([]natsgo.Option{
		natsgo.Name("natsui-rttprobe"),
		natsgo.Timeout(5 * time.Second),
		natsgo.MaxReconnects(0),
	}, authOpts...)

	nc, err := natsgo.Connect(serverURL, opts...)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer nc.Close()
	res.ConnectedURL = nc.ConnectedUrl()

	var minD, maxD, sumD time.Duration
	n := 0
	for i := 0; i < samples; i++ {
		rtt, rerr := nc.RTT()
		if rerr != nil {
			continue
		}
		if n == 0 || rtt < minD {
			minD = rtt
		}
		if rtt > maxD {
			maxD = rtt
		}
		sumD += rtt
		n++
		time.Sleep(15 * time.Millisecond)
	}
	if n == 0 {
		res.Error = "no RTT samples"
		return res
	}
	res.Reachable = true
	res.Samples = n
	res.MinMs = float64(minD.Microseconds()) / 1000
	res.MaxMs = float64(maxD.Microseconds()) / 1000
	res.AvgMs = float64(sumD.Microseconds()) / 1000 / float64(n)
	return res
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
		for _, f := range mc.tempFiles {
			_ = os.Remove(f)
		}
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
