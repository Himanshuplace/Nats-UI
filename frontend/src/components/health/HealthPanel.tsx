/**
 * HealthPanel — cluster-wide health & alerts.
 *
 * Scans every stream, consumer and node and turns the collected state into a
 * prioritized list of actionable warnings (redelivery storms, lagging/stuck
 * consumers, streams near their limits, degraded nodes, …) so operators see
 * what needs attention without hunting through each view. Each alert links to
 * the relevant view. Pure client-side aggregation of existing API data.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldCheck, AlertTriangle, AlertOctagon, Info, RefreshCw, ChevronRight,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, Spinner, cn } from '@/components/ui'
import { formatNumber, formatBytes } from '@/lib/format'
import type { StreamInfo, ConsumerInfo, ClusterInfo, View } from '@/types'

type Severity = 'critical' | 'warning' | 'info'

interface Alert {
  id: string
  severity: Severity
  title: string
  entity: string
  detail: string
  nav?: { view: View; stream?: string; consumer?: string }
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function computeAlerts(
  streams: StreamInfo[],
  consumersByStream: { stream: string; consumers: ConsumerInfo[] }[],
  topology: ClusterInfo | null,
): Alert[] {
  const out: Alert[] = []

  // ── Nodes ──
  for (const n of topology?.nodes ?? []) {
    if (n.health === 'critical') {
      out.push({ id: `node-${n.id}`, severity: 'critical', title: 'Node unhealthy', entity: `node ${n.name}`, detail: 'Server reports a critical state.', nav: { view: 'topology' } })
    } else if (n.health === 'degraded') {
      out.push({ id: `node-${n.id}`, severity: 'warning', title: 'Node degraded', entity: `node ${n.name}`, detail: 'Server health is degraded.', nav: { view: 'topology' } })
    }
    if ((n.slowClients ?? 0) > 0) {
      out.push({ id: `node-slow-${n.id}`, severity: 'warning', title: 'Slow consumers', entity: `node ${n.name}`, detail: `${n.slowClients} slow client(s) detected on this server.`, nav: { view: 'topology' } })
    }
  }

  // ── Streams ──
  for (const s of streams) {
    const name = s.config.name
    if (s.health === 'critical') out.push({ id: `stream-${name}`, severity: 'critical', title: 'Stream unhealthy', entity: `stream ${name}`, detail: 'Stream reports a critical state.', nav: { view: 'streams', stream: name } })
    else if (s.health === 'degraded') out.push({ id: `stream-${name}`, severity: 'warning', title: 'Stream degraded', entity: `stream ${name}`, detail: 'Stream health is degraded (possibly under-replicated).', nav: { view: 'streams', stream: name } })

    const maxMsgs = s.config.maxMsgs ?? 0
    if (maxMsgs > 0 && pct(s.state.messages, maxMsgs) >= 85) {
      out.push({ id: `stream-msgs-${name}`, severity: 'warning', title: 'Stream near message limit', entity: `stream ${name}`, detail: `${pct(s.state.messages, maxMsgs)}% of max-msgs (${formatNumber(s.state.messages)}/${formatNumber(maxMsgs)}) — old messages will be discarded.`, nav: { view: 'streams', stream: name } })
    }
    const maxBytes = s.config.maxBytes ?? 0
    if (maxBytes > 0 && pct(s.state.bytes, maxBytes) >= 85) {
      out.push({ id: `stream-bytes-${name}`, severity: 'warning', title: 'Stream near size limit', entity: `stream ${name}`, detail: `${pct(s.state.bytes, maxBytes)}% of max-bytes (${formatBytes(s.state.bytes)}/${formatBytes(maxBytes)}).`, nav: { view: 'streams', stream: name } })
    }
  }

  // ── Consumers ──
  for (const { stream, consumers } of consumersByStream) {
    for (const c of consumers ?? []) {
      const navTo = { view: 'consumers' as View, stream, consumer: c.name }
      if (c.health === 'redelivery_storm') out.push({ id: `cons-${stream}-${c.name}`, severity: 'critical', title: 'Redelivery storm', entity: `consumer ${c.name}`, detail: `${formatNumber(c.numRedelivered)} redeliveries — messages keep failing. Check the handler / ACK wait.`, nav: navTo })
      else if (c.health === 'dead' || c.health === 'stuck') out.push({ id: `cons-${stream}-${c.name}`, severity: 'critical', title: c.health === 'dead' ? 'Consumer dead' : 'Consumer stuck', entity: `consumer ${c.name}`, detail: 'No progress — nothing is acking. Check the subscriber.', nav: navTo })
      else if (c.health === 'slow' || c.health === 'lagging') out.push({ id: `cons-${stream}-${c.name}`, severity: 'warning', title: c.health === 'slow' ? 'Slow consumer' : 'Consumer lagging', entity: `consumer ${c.name}`, detail: `Falling behind — lag ${formatNumber(c.lag)} on stream ${stream}.`, nav: navTo })
      else if (c.lag > 50_000) out.push({ id: `cons-lag-${stream}-${c.name}`, severity: 'warning', title: 'High lag', entity: `consumer ${c.name}`, detail: `${formatNumber(c.lag)} messages behind on stream ${stream}.`, nav: navTo })

      const maxAck = c.config.maxAckPending ?? 0
      if (maxAck > 0 && pct(c.numAckPending, maxAck) >= 90) {
        out.push({ id: `cons-ack-${stream}-${c.name}`, severity: 'warning', title: 'ACK pending near max', entity: `consumer ${c.name}`, detail: `${pct(c.numAckPending, maxAck)}% of max-ack-pending (${formatNumber(c.numAckPending)}/${formatNumber(maxAck)}) — delivery will stall.`, nav: navTo })
      }
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}

const SEV_META: Record<Severity, { Icon: typeof AlertTriangle; color: string; bg: string }> = {
  critical: { Icon: AlertOctagon,  color: 'text-accent-red',    bg: 'border-accent-red/30 bg-accent-red/5' },
  warning:  { Icon: AlertTriangle, color: 'text-accent-yellow', bg: 'border-accent-yellow/30 bg-accent-yellow/5' },
  info:     { Icon: Info,          color: 'text-accent-cyan',   bg: 'border-accent-cyan/30 bg-accent-cyan/5' },
}

export function HealthPanel() {
  const clusterId        = useUIStore(s => s.activeClusters[0] ?? '')
  const setView          = useUIStore(s => s.setView)
  const setConsumerState = useUIStore(s => s.setConsumerState)
  const setActiveStream  = useUIStore(s => s.setActiveStream)

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['health', clusterId],
    enabled: Boolean(clusterId),
    refetchInterval: 8_000,
    queryFn: async () => {
      const streams = await api.streams.list(clusterId)
      const consumersByStream = await Promise.all(
        streams.map(s =>
          api.consumers.list(clusterId, s.config.name)
            .then(consumers => ({ stream: s.config.name, consumers: consumers ?? [] }))
            .catch(() => ({ stream: s.config.name, consumers: [] as ConsumerInfo[] })),
        ),
      )
      const topology = await api.cluster.topology(clusterId).catch(() => null)
      return { streams, consumersByStream, topology }
    },
  })

  const alerts = useMemo(
    () => data ? computeAlerts(data.streams, data.consumersByStream, data.topology) : [],
    [data],
  )
  const counts = useMemo(() => ({
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning:  alerts.filter(a => a.severity === 'warning').length,
    info:     alerts.filter(a => a.severity === 'info').length,
  }), [alerts])

  const scanned = data
    ? { streams: data.streams.length, consumers: data.consumersByStream.reduce((n, x) => n + x.consumers.length, 0), nodes: data.topology?.nodes?.length ?? 0 }
    : { streams: 0, consumers: 0, nodes: 0 }

  const goTo = (a: Alert) => {
    if (!a.nav) return
    if (a.nav.view === 'consumers' && a.nav.stream) setConsumerState({ selectedStream: a.nav.stream, selectedConsumer: a.nav.consumer ?? null })
    if (a.nav.view === 'streams' && a.nav.stream) setActiveStream(a.nav.stream)
    setView(a.nav.view)
  }

  if (!clusterId) {
    return <div className="flex-1 flex items-center justify-center"><EmptyHealth title="No cluster connected" description="Connect to a NATS server first" /></div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-bg-border/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent-primary" />
          <span className="text-sm font-sans font-semibold text-text-primary tracking-tight">Health &amp; Alerts</span>
          {isFetching && <Spinner size="xs" />}
        </div>
        <div className="h-3 w-px bg-bg-border" />
        <Chip label="critical" value={counts.critical} color={counts.critical > 0 ? '#ff4040' : undefined} />
        <Chip label="warning"  value={counts.warning}  color={counts.warning > 0 ? '#ffcc00' : undefined} />
        <span className="text-2xs font-mono text-text-muted">scanned {scanned.streams} streams · {scanned.consumers} consumers · {scanned.nodes} nodes</span>
        <Button variant="ghost" size="xs" className="ml-auto" onClick={() => refetch()}><RefreshCw className="w-3 h-3" /> Refresh</Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>
        ) : alerts.length === 0 ? (
          <EmptyHealth title="All healthy" description="No alerts — every stream, consumer and node looks good." ok />
        ) : (
          <div className="space-y-2 max-w-4xl">
            {alerts.map(a => {
              const m = SEV_META[a.severity]
              return (
                <button key={a.id} onClick={() => goTo(a)}
                  className={cn('w-full text-left surface-card border flex items-start gap-3 px-4 py-3 hover:bg-bg-hover/40 transition-colors', m.bg)}>
                  <m.Icon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', m.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-sans font-semibold text-text-primary">{a.title}</span>
                      <span className="text-2xs font-mono text-text-muted">{a.entity}</span>
                    </div>
                    <p className="text-xs font-mono text-text-secondary mt-0.5">{a.detail}</p>
                  </div>
                  {a.nav && <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs font-mono tabular-nums font-semibold" style={{ color: color ?? 'rgb(var(--c-text-secondary))' }}>{value}</span>
      <span className="text-2xs font-sans text-text-muted">{label}</span>
    </div>
  )
}

function EmptyHealth({ title, description, ok }: { title: string; description?: string; ok?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShieldCheck className={cn('w-10 h-10 mb-3', ok ? 'text-accent-green' : 'text-text-muted')} />
      <p className="text-sm font-sans font-medium text-text-secondary">{title}</p>
      {description && <p className="text-xs font-mono text-text-muted mt-1 max-w-sm">{description}</p>}
    </div>
  )
}
