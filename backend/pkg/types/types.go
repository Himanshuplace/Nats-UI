package types

import "time"

// ── Server discovery ──────────────────────────────────────────────────────────

type ServerSource string

const (
	SourceLocal  ServerSource = "local"
	SourceDocker ServerSource = "docker"
	SourceK8s    ServerSource = "kubernetes"
	SourceManual ServerSource = "manual"
)

type NATSServer struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Host         string            `json:"host"`
	ClientPort   int               `json:"clientPort"`
	MonitorPort  int               `json:"monitorPort"`
	ClusterPort  int               `json:"clusterPort"`
	Source       ServerSource      `json:"source"`
	Labels       map[string]string `json:"labels,omitempty"`
	TLSEnabled   bool              `json:"tlsEnabled"`
	DiscoveredAt time.Time         `json:"discoveredAt"`
}

// ── Cluster ───────────────────────────────────────────────────────────────────

type ClusterHealth string

const (
	HealthOK       ClusterHealth = "ok"
	HealthDegraded ClusterHealth = "degraded"
	HealthCritical ClusterHealth = "critical"
	HealthUnknown  ClusterHealth = "unknown"
)

type ClusterInfo struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Nodes    []NodeInfo    `json:"nodes"`
	Routes   []RouteInfo   `json:"routes"`
	Health   ClusterHealth `json:"health"`
	NumNodes int           `json:"numNodes"`
}

type NodeInfo struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Host        string        `json:"host"`
	Port        int           `json:"port"`
	Role        string        `json:"role"` // leader, follower, candidate
	Clients     int64         `json:"clients"`
	Subscriptions int64       `json:"subscriptions"`
	InMsgs      int64         `json:"inMsgs"`
	OutMsgs     int64         `json:"outMsgs"`
	InBytes     int64         `json:"inBytes"`
	OutBytes    int64         `json:"outBytes"`
	SlowClients int64         `json:"slowClients"`
	Routes      int           `json:"routes"`
	Uptime      string        `json:"uptime"`
	Version     string        `json:"version"`
	Health      ClusterHealth `json:"health"`
	JetStream   bool          `json:"jetstream"`
}

type RouteInfo struct {
	From       string  `json:"from"`
	To         string  `json:"to"`
	LatencyMs  float64 `json:"latencyMs"`
	Healthy    bool    `json:"healthy"`
}

// ── JetStream streams ─────────────────────────────────────────────────────────

type RetentionPolicy string
type StorageType string
type DiscardPolicy string
type DeliverPolicy string
type AckPolicy string
type ReplayPolicy string

const (
	RetentionLimits    RetentionPolicy = "limits"
	RetentionInterest  RetentionPolicy = "interest"
	RetentionWorkQueue RetentionPolicy = "workqueue"

	StorageFile   StorageType = "file"
	StorageMemory StorageType = "memory"

	DiscardOld DiscardPolicy = "old"
	DiscardNew DiscardPolicy = "new"

	DeliverAll       DeliverPolicy = "all"
	DeliverLast      DeliverPolicy = "last"
	DeliverNew       DeliverPolicy = "new"
	DeliverBySeq     DeliverPolicy = "by_start_sequence"
	DeliverByTime    DeliverPolicy = "by_start_time"

	AckExplicit AckPolicy = "explicit"
	AckNone     AckPolicy = "none"
	AckAll      AckPolicy = "all"

	ReplayInstant  ReplayPolicy = "instant"
	ReplayOriginal ReplayPolicy = "original"
)

type StreamConfig struct {
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	Subjects     []string        `json:"subjects"`
	Retention    RetentionPolicy `json:"retention"`
	Storage      StorageType     `json:"storage"`
	MaxAge       time.Duration   `json:"maxAge,omitempty"`
	MaxBytes     int64           `json:"maxBytes,omitempty"`
	MaxMsgs      int64           `json:"maxMsgs,omitempty"`
	MaxMsgSize   int32           `json:"maxMsgSize,omitempty"`
	Replicas     int             `json:"replicas"`
	NoAck        bool            `json:"noAck,omitempty"`
	Discard      DiscardPolicy   `json:"discard,omitempty"`
	Duplicates   time.Duration   `json:"duplicates,omitempty"`
}

type StreamState struct {
	Messages     uint64    `json:"messages"`
	Bytes        uint64    `json:"bytes"`
	FirstSeq     uint64    `json:"firstSeq"`
	FirstTime    time.Time `json:"firstTime"`
	LastSeq      uint64    `json:"lastSeq"`
	LastTime     time.Time `json:"lastTime"`
	NumSubjects  int       `json:"numSubjects"`
	NumDeleted   uint64    `json:"numDeleted"`
}

type StreamInfo struct {
	Config    StreamConfig `json:"config"`
	State     StreamState  `json:"state"`
	ClusterID string       `json:"clusterId"`
	Created   time.Time    `json:"created"`
	Health    string       `json:"health"`
}

// ── Consumers ─────────────────────────────────────────────────────────────────

type ConsumerConfig struct {
	Name           string        `json:"name"`
	DurableName    string        `json:"durableName,omitempty"`
	Description    string        `json:"description,omitempty"`
	DeliverSubject string        `json:"deliverSubject,omitempty"`
	DeliverGroup   string        `json:"deliverGroup,omitempty"`
	DeliverPolicy  DeliverPolicy `json:"deliverPolicy"`
	OptStartSeq    uint64        `json:"optStartSeq,omitempty"`
	OptStartTime   *time.Time    `json:"optStartTime,omitempty"`
	AckPolicy      AckPolicy     `json:"ackPolicy"`
	AckWait        time.Duration `json:"ackWait,omitempty"`
	MaxDeliver     int           `json:"maxDeliver,omitempty"`
	FilterSubject  string        `json:"filterSubject,omitempty"`
	ReplayPolicy   ReplayPolicy  `json:"replayPolicy"`
	MaxAckPending  int           `json:"maxAckPending,omitempty"`
}

type ConsumerSequenceInfo struct {
	ConsumerSeq uint64 `json:"consumerSeq"`
	StreamSeq   uint64 `json:"streamSeq"`
}

type ConsumerInfo struct {
	Stream         string               `json:"stream"`
	Name           string               `json:"name"`
	Config         ConsumerConfig       `json:"config"`
	Created        time.Time            `json:"created"`
	Delivered      ConsumerSequenceInfo `json:"delivered"`
	AckFloor       ConsumerSequenceInfo `json:"ackFloor"`
	NumAckPending  int                  `json:"numAckPending"`
	NumRedelivered int                  `json:"numRedelivered"`
	NumWaiting     int                  `json:"numWaiting"`
	NumPending     uint64               `json:"numPending"`
	ClusterID      string               `json:"clusterId"`
	Lag            uint64               `json:"lag"`
	Health         string               `json:"health"` // ok, slow, stuck, dead
}

// ── Messages ──────────────────────────────────────────────────────────────────

type TailedMessage struct {
	ClusterID     string            `json:"clusterId"`
	Stream        string            `json:"stream"`
	Subject       string            `json:"subject"`
	SubjectFilter string            `json:"subjectFilter,omitempty"` // set for raw-NATS subject tails
	Seq           uint64            `json:"seq"`
	Timestamp     time.Time         `json:"timestamp"`
	Payload       string            `json:"payload"`       // base64 for binary
	PayloadText   string            `json:"payloadText"`   // if valid UTF-8
	PayloadSize   int               `json:"payloadSize"`
	Headers       map[string]string `json:"headers,omitempty"`
	Redelivered   bool              `json:"redelivered"`
	ReplyTo       string            `json:"replyTo,omitempty"`
}

// StoredMessage — a message fetched directly from the JetStream key-value store by seq.
type StoredMessage struct {
	Stream      string            `json:"stream"`
	ClusterID   string            `json:"clusterId"`
	Subject     string            `json:"subject"`
	Seq         uint64            `json:"seq"`
	Timestamp   time.Time         `json:"timestamp"`
	Payload     string            `json:"payload"`
	PayloadText string            `json:"payloadText"`
	PayloadSize int               `json:"payloadSize"`
	Headers     map[string]string `json:"headers,omitempty"`
}

// PublishRequest — body for POST /clusters/{id}/publish.
type PublishRequest struct {
	Subject string            `json:"subject"`
	Payload string            `json:"payload"`
	Headers map[string]string `json:"headers,omitempty"`
	ReplyTo string            `json:"replyTo,omitempty"`
}

// PublishResult — response from POST /clusters/{id}/publish.
type PublishResult struct {
	Subject  string `json:"subject"`
	Stream   string `json:"stream,omitempty"`
	Seq      uint64 `json:"seq,omitempty"`
	Accepted bool   `json:"accepted"`
}

// ── Metrics ───────────────────────────────────────────────────────────────────

type ThroughputPoint struct {
	ClusterID string    `json:"clusterId"`
	NodeID    string    `json:"nodeId,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	InMsgs    int64     `json:"inMsgs"`    // msgs/sec
	OutMsgs   int64     `json:"outMsgs"`
	InBytes   int64     `json:"inBytes"`   // bytes/sec
	OutBytes  int64     `json:"outBytes"`
}

type LatencyPoint struct {
	ClusterID string    `json:"clusterId"`
	RouteFrom string    `json:"routeFrom"`
	RouteTo   string    `json:"routeTo"`
	Timestamp time.Time `json:"timestamp"`
	P50Ms     float64   `json:"p50Ms"`
	P95Ms     float64   `json:"p95Ms"`
	P99Ms     float64   `json:"p99Ms"`
}

type ConsumerLagPoint struct {
	ClusterID  string    `json:"clusterId"`
	Stream     string    `json:"stream"`
	Consumer   string    `json:"consumer"`
	Timestamp  time.Time `json:"timestamp"`
	Lag        uint64    `json:"lag"`
	Redeliveries int     `json:"redeliveries"`
}

// ── Replay ────────────────────────────────────────────────────────────────────

type ReplayConfig struct {
	ID            string     `json:"id"`
	ClusterID     string     `json:"clusterId"`
	Stream        string     `json:"stream"`
	ConsumerName  string     `json:"consumerName"`
	StartSeq      *uint64    `json:"startSeq,omitempty"`
	StartTime     *time.Time `json:"startTime,omitempty"`
	EndSeq        *uint64    `json:"endSeq,omitempty"`
	EndTime       *time.Time `json:"endTime,omitempty"`
	ThrottleMs    int        `json:"throttleMs,omitempty"` // delay between msgs
	ShadowSubject string     `json:"shadowSubject,omitempty"`
	FilterSubject string     `json:"filterSubject,omitempty"`
}

type ReplayProgress struct {
	ID          string    `json:"id"`
	CurrentSeq  uint64    `json:"currentSeq"`
	TotalMsgs   uint64    `json:"totalMsgs"`
	Processed   uint64    `json:"processed"`
	Rate        float64   `json:"rate"` // msgs/sec
	ElapsedMs   int64     `json:"elapsedMs"`
	Done        bool      `json:"done"`
	Error       string    `json:"error,omitempty"`
}

// SubjectInfo describes a known NATS subject with its stream and source.
type SubjectInfo struct {
	Subject string `json:"subject"`
	Stream  string `json:"stream,omitempty"`
	Source  string `json:"source"` // "stream" | "consumer"
}

// ── Connection profiles ───────────────────────────────────────────────────────

type ConnectionProfile struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Host        string `json:"host,omitempty"`        // derived or explicit
	ClientPort  int    `json:"clientPort,omitempty"`  // derived or explicit
	MonitorPort int    `json:"monitorPort,omitempty"` // default 8222
	NKeyPath    string `json:"nkeyPath,omitempty"`
	CredsPath   string `json:"credsPath,omitempty"`
	TLSCert     string `json:"tlsCert,omitempty"`
	TLSKey      string `json:"tlsKey,omitempty"`
	TLSCA       string `json:"tlsCa,omitempty"`
	Token       string `json:"token,omitempty"`
}

// ── WebSocket events ──────────────────────────────────────────────────────────

type WSEvent struct {
	Type string `json:"type"`
	Ts   int64  `json:"ts"`
	Data any    `json:"data"`
}

type ErrorEvent struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ── Accounts & Users ──────────────────────────────────────────────────────────

type NATSAccount struct {
	Name          string     `json:"name"`
	Connections   int        `json:"connections"`
	Subscriptions int64      `json:"subscriptions"`
	LeafNodes     int        `json:"leafNodes"`
	InMsgs        int64      `json:"inMsgs"`
	OutMsgs       int64      `json:"outMsgs"`
	InBytes       int64      `json:"inBytes"`
	OutBytes      int64      `json:"outBytes"`
	JetStream     bool       `json:"jetStream"`
	Users         []NATSUser `json:"users,omitempty"`
}

type NATSUser struct {
	Username string `json:"username"`
	Account  string `json:"account"`
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	Subs     int64  `json:"subs"`
	InMsgs   int64  `json:"inMsgs"`
	OutMsgs  int64  `json:"outMsgs"`
}
