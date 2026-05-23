package gateway

// Event type constants for the WebSocket protocol.
// All events use the format: { type, ts, data }.

const (
	// Cluster events
	EventClusterTopology = "cluster.topology"
	EventClusterHealth   = "cluster.health"
	EventClusterNode     = "cluster.node"
	EventClusterRoute    = "cluster.route"

	// Stream events
	EventStreamList    = "stream.list"
	EventStreamStats   = "stream.stats"
	EventStreamCreated = "stream.created"
	EventStreamDeleted = "stream.deleted"

	// Consumer events
	EventConsumerList    = "consumer.list"
	EventConsumerLag     = "consumer.lag"
	EventConsumerUpdated = "consumer.updated"

	// Message tail events
	EventMessageReceived = "message.received"
	EventTailStarted     = "tail.started"
	EventTailStopped     = "tail.stopped"

	// Replay events
	EventReplayProgress = "replay.progress"
	EventReplayDone     = "replay.done"
	EventReplayError    = "replay.error"

	// Metrics events
	EventMetricsThroughput = "metrics.throughput"
	EventMetricsLatency    = "metrics.latency"
	EventMetricsLag        = "metrics.lag"

	// Discovery events
	EventDiscoveryFound   = "discovery.found"
	EventDiscoveryLost    = "discovery.lost"
	EventDiscoveryScanned = "discovery.scanned"

	// System events
	EventError = "error"
	EventPong  = "pong"
)

// Topic namespaces for targeted broadcasts
const (
	TopicCluster   = "cluster:"
	TopicStream    = "stream:"
	TopicConsumer  = "consumer:"
	TopicTail      = "tail:"
	TopicMetrics   = "metrics:"
	TopicDiscovery = "discovery"
)

// Command types from client
const (
	CmdSubscribe    = "subscribe"
	CmdUnsubscribe  = "unsubscribe"
	CmdTailStart    = "tail.start"
	CmdTailStop     = "tail.stop"
	CmdReplayStart  = "replay.start"
	CmdReplayStop   = "replay.stop"
	CmdMetricsWatch = "metrics.watch"
	CmdPing         = "ping"
)
