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

export interface ClusterInfo {
  id: string
  name: string
  nodes: NodeInfo[]
  routes: RouteInfo[]
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
  stream: string
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
  nkeyPath?: string
  credsPath?: string
  tlsCert?: string
  tlsKey?: string
  tlsCa?: string
  token?: string
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
  | 'tail'
  | 'replay'
  | 'metrics'
  | 'dlq'
  | 'settings'

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
