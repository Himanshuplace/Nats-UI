// ── Server discovery ──────────────────────────────────────────────────────────

export type ServerSource = 'local' | 'docker' | 'kubernetes' | 'manual'

export interface NATSServer {
  id: string
  name: string
  host: string
  clientPort: number
  monitorPort: number
  source: ServerSource
  labels?: Record<string, string>
  tlsEnabled: boolean
  discoveredAt: string
}

// ── Cluster ───────────────────────────────────────────────────────────────────

export type ClusterHealth = 'ok' | 'degraded' | 'critical' | 'unknown'

export interface NodeInfo {
  id: string
  name: string
  host: string
  port: number
  role: 'leader' | 'follower' | 'candidate' | 'standalone'
  clients: number
  subscriptions: number
  inMsgs: number
  outMsgs: number
  inBytes: number
  outBytes: number
  slowClients: number
  routes: number
  uptime: string
  version: string
  health: ClusterHealth
  jetstream: boolean
}

export interface RouteInfo {
  from: string
  to: string
  latencyMs: number
  healthy: boolean
}

export interface GatewayConn {
  serverId: string
  serverName: string
  remoteCluster: string
  direction: 'outbound' | 'inbound'
  configured: boolean
  numConnections?: number
  ip?: string
  port?: number
  rttMs?: number
  healthy: boolean
}

export interface LeafNodeConn {
  serverId: string
  serverName: string
  name: string
  account: string
  ip?: string
  port?: number
  rttMs?: number
  subscriptions: number
  inMsgs: number
  outMsgs: number
  inBytes: number
  outBytes: number
}

export interface ClusterInfo {
  id: string
  name: string
  nodes: NodeInfo[]
  routes: RouteInfo[]
  gateways?: GatewayConn[]
  leafNodes?: LeafNodeConn[]
  health: ClusterHealth
  numNodes: number
}

// ── Streams ───────────────────────────────────────────────────────────────────

export type RetentionPolicy = 'limits' | 'interest' | 'workqueue'
export type StorageType = 'file' | 'memory'
export type DiscardPolicy = 'old' | 'new'
export type DeliverPolicy = 'all' | 'last' | 'new' | 'by_start_sequence' | 'by_start_time'
export type AckPolicy = 'explicit' | 'none' | 'all'
export type ReplayPolicy = 'instant' | 'original'

export interface StreamConfig {
  name: string
  description?: string
  subjects: string[]
  retention: RetentionPolicy
  storage: StorageType
  maxAge?: number
  maxBytes?: number
  maxMsgs?: number
  maxMsgSize?: number
  replicas: number
  discard?: DiscardPolicy
  duplicates?: number
}

export interface StreamState {
  messages: number
  bytes: number
  firstSeq: number
  firstTime: string
  lastSeq: number
  lastTime: string
  numSubjects: number
  numDeleted: number
}

export interface StreamInfo {
  config: StreamConfig
  state: StreamState
  clusterId: string
  created: string
  health: string
}

// ── Consumers ─────────────────────────────────────────────────────────────────

export interface ConsumerConfig {
  name: string
  durableName?: string
  description?: string
  deliverSubject?: string
  deliverGroup?: string
  deliverPolicy: DeliverPolicy
  optStartSeq?: number
  optStartTime?: string
  ackPolicy: AckPolicy
  ackWait?: number
  maxDeliver?: number
  filterSubject?: string
  replayPolicy: ReplayPolicy
  maxAckPending?: number
}

export interface ConsumerSequenceInfo {
  consumerSeq: number
  streamSeq: number
}

export type ConsumerHealth = 'ok' | 'slow' | 'lagging' | 'redelivery_storm' | 'stuck' | 'dead'

export interface ConsumerInfo {
  stream: string
  name: string
  config: ConsumerConfig
  created: string
  delivered: ConsumerSequenceInfo
  ackFloor: ConsumerSequenceInfo
  numAckPending: number
  numRedelivered: number
  numWaiting: number
  numPending: number
  clusterId: string
  lag: number
  health: ConsumerHealth
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface TailedMessage {
  id?: string  // local generated ID for rendering
  clusterId?: string
  stream: string
  subjectFilter?: string  // set for raw-NATS subject tails
  subject: string
  seq: number
  timestamp: string
  payload: string       // base64 for binary
  payloadText: string   // decoded UTF-8 if valid
  payloadSize: number
  headers?: Record<string, string>
  redelivered: boolean
  replyTo?: string
}

export interface StoredMessage {
  stream: string
  clusterId: string
  subject: string
  seq: number
  timestamp: string
  payload: string
  payloadText: string
  payloadSize: number
  headers?: Record<string, string>
}

export interface PublishRequest {
  subject: string
  payload: string
  headers?: Record<string, string>
  replyTo?: string
}

export interface PublishResult {
  subject: string
  stream?: string
  seq?: number
  accepted: boolean
}

export interface SubjectInfo {
  subject: string
  stream?: string
  source: 'stream' | 'consumer'
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface ThroughputPoint {
  clusterId: string
  nodeId?: string
  timestamp: string
  inMsgs: number
  outMsgs: number
  inBytes: number
  outBytes: number
}

export interface LatencyPoint {
  clusterId: string
  routeFrom: string
  routeTo: string
  timestamp: string
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export interface ConsumerLagPoint {
  clusterId: string
  stream: string
  consumer: string
  timestamp: string
  lag: number
  redeliveries: number
}

// ── Replay ────────────────────────────────────────────────────────────────────

export interface ReplayConfig {
  id: string
  clusterId: string
  stream: string
  consumerName: string
  startSeq?: number
  startTime?: string
  endSeq?: number
  endTime?: string
  throttleMs?: number
  shadowSubject?: string
  filterSubject?: string
}

export interface ReplayProgress {
  id: string
  currentSeq: number
  totalMsgs: number
  processed: number
  rate: number
  elapsedMs: number
  done: boolean
  error?: string
}

// ── Connection profiles ───────────────────────────────────────────────────────

export interface ConnectionProfile {
  id: string
  name: string
  url: string
  // NATS auth — whatever the server requires
  username?: string
  password?: string
  token?: string
  nkeyPath?: string
  credsPath?: string
  tlsCert?: string
  tlsKey?: string
  tlsCa?: string
  // browser-pasted credential contents (materialized to temp files server-side)
  credsContent?: string
  nkeySeed?: string
  tlsCaContent?: string
}

// ── WebSocket protocol ────────────────────────────────────────────────────────

export interface WSEvent<T = unknown> {
  type: string
  ts: number
  data: T
}

export type WSEventType =
  | 'connected'
  | 'cluster.topology'
  | 'cluster.health'
  | 'stream.list'
  | 'stream.stats'
  | 'consumer.list'
  | 'consumer.lag'
  | 'message.received'
  | 'tail.started'
  | 'tail.stopped'
  | 'replay.progress'
  | 'replay.done'
  | 'metrics.throughput'
  | 'metrics.latency'
  | 'topology.flow'
  | 'discovery.found'
  | 'discovery.lost'
  | 'discovery.scanned'
  | 'error'
  | 'pong'

// ── UI types ──────────────────────────────────────────────────────────────────

export type View =
  | 'overview'
  | 'topology'
  | 'streams'
  | 'consumers'
  | 'kv'
  | 'objects'
  | 'tail'
  | 'browser'
  | 'publisher'
  | 'request'
  | 'replay'
  | 'lab'
  | 'metrics'
  | 'services'
  | 'health'
  | 'latency'
  | 'backup'
  | 'dlq'
  | 'accounts'
  | 'settings'

// ── NATS micro Services ───────────────────────────────────────────────────────

export interface ServiceEndpointStat {
  name:             string
  subject:          string
  queueGroup?:      string
  numRequests:      number
  numErrors:        number
  processingTimeNs: number
  avgProcessingNs:  number
  lastError?:       string
}

export interface ServiceInfo {
  name:        string
  version:     string
  instances:   number
  numRequests: number
  numErrors:   number
  endpoints:   ServiceEndpointStat[]
}

export interface ServicePingResult {
  instances: number
  minMs:     number
  avgMs:     number
  maxMs:     number
}

// ── Per-server RTT / latency probe ────────────────────────────────────────────

export interface RTTResult {
  server:        string
  connectedUrl?: string
  reachable:     boolean
  samples?:      number
  minMs?:        number
  avgMs?:        number
  maxMs?:        number
  error?:        string
}

// ── Stream backup / restore ───────────────────────────────────────────────────

export interface BackupMessage {
  subject:  string
  seq:      number
  time:     string
  headers?: Record<string, string>
  data:     string // base64
}

export interface StreamBackup {
  version:      number
  stream:       string
  capturedAt:   string
  config:       StreamConfig
  messageCount: number
  truncated?:   boolean
  messages:     BackupMessage[]
}

export interface RestoreRequest {
  targetStream?: string
  createStream:  boolean
  backup:        StreamBackup
}

export interface RestoreResult {
  targetStream:  string
  streamCreated: boolean
  total:         number
  restored:      number
  failed:        number
  error?:        string
}

// ── Pull-consumer debugger ────────────────────────────────────────────────────

export interface DebugMessage {
  id:           string
  subject:      string
  streamSeq:    number
  consumerSeq:  number
  numDelivered: number
  timestamp:    string
  payload:      string
  size:         number
  headers?:     Record<string, string>
}

export interface DebugFetchResult {
  sessionId: string
  messages:  DebugMessage[]
}

// ── Request–Reply ─────────────────────────────────────────────────────────────

export interface RequestReplyRequest {
  subject:   string
  payload:   string
  headers?:  Record<string, string>
  timeoutMs: number
}

export interface RequestReplyResult {
  subject?:      string
  payload:       string
  headers?:      Record<string, string>
  size:          number
  rttMs:         number
  noResponders?: boolean
  timedOut?:     boolean
}

// ── Key-Value store ───────────────────────────────────────────────────────────

export interface KVBucketInfo {
  bucket:   string
  values:   number
  history:  number
  ttl:      number   // ns (0 = unlimited)
  bytes:    number
  replicas: number
}

export interface KVEntry {
  bucket:    string
  key:       string
  value:     string
  revision:  number
  created:   string  // ISO timestamp
  operation: 'PUT' | 'DELETE' | 'PURGE'
  size:      number
}

export interface KVBucketConfig {
  bucket:        string
  description?:  string
  history:       number
  ttl:           number   // seconds (0 = unlimited)
  storage:       'file' | 'memory'
  replicas:      number
  maxValueSize:  number   // bytes (0 = unlimited)
}

// ── Object store ──────────────────────────────────────────────────────────────

export interface ObjectBucketInfo {
  bucket:       string
  description?: string
  size:         number
  ttl:          number   // ns (0 = unlimited)
  replicas:     number
}

export interface ObjectEntry {
  name:         string
  description?: string
  bucket:       string
  size:         number
  chunks:       number
  modTime:      string
  digest?:      string
  headers?:     Record<string, string>
}

export interface ObjectData {
  name:      string
  size:      number
  base64:    string
  tooLarge?: boolean
}

export interface ObjectBucketConfig {
  bucket:       string
  description?: string
  ttl:          number   // seconds (0 = unlimited)
  storage:      'file' | 'memory'
  replicas:     number
}

// ── Accounts & Users ──────────────────────────────────────────────────────────

export interface NATSAccount {
  name: string
  connections: number
  subscriptions: number
  leafNodes: number
  inMsgs: number
  outMsgs: number
  inBytes: number
  outBytes: number
  jetStream: boolean
  users?: NATSUser[]
}

export interface NATSUser {
  username: string
  account: string
  ip: string
  port: number
  subs: number
  inMsgs: number
  outMsgs: number
}

export interface Tab {
  id: string
  label: string
  view: View
  clusterId?: string
  stream?: string
  consumer?: string
  pinned?: boolean
}

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string[]
  action: () => void
  group?: string
}
