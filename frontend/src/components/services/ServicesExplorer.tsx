/**
 * ServicesExplorer — NATS micro Services ($SRV) discovery.
 *
 * Discovers running services built with the NATS 2.10+ micro framework via a
 * scatter-gather $SRV.STATS request, aggregates their per-endpoint stats across
 * instances, and can $SRV.PING them for liveness + round-trip latency. This is
 * first-class microservice observability that the request-reply console can't
 * give you — request counts, error rates and processing time per endpoint.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Workflow, RefreshCw, ChevronRight, ChevronDown, Radio, Zap,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, Badge, EmptyState, Spinner, cn } from '@/components/ui'
import { formatNumber } from '@/lib/format'
import type { ServiceInfo, ServicePingResult } from '@/types'

function fmtNs(ns: number): string {
  if (!ns) return '—'
  if (ns < 1_000) return `${ns}ns`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)}µs`
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`
  return `${(ns / 1_000_000_000).toFixed(2)}s`
}

export function ServicesExplorer() {
  const clusterId = useUIStore(s => s.activeClusters[0] ?? '')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [ping, setPing] = useState<ServicePingResult | null>(null)
  const [pinging, setPinging] = useState(false)

  const { data: services, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['services', clusterId],
    queryFn: () => api.services.list(clusterId),
    enabled: Boolean(clusterId),
    refetchInterval: 5_000,
  })

  const toggle = (name: string) => setExpanded(s => {
    const n = new Set(s)
    n.has(name) ? n.delete(name) : n.add(name)
    return n
  })

  const doPing = async () => {
    if (!clusterId) return
    setPinging(true)
    try { setPing(await api.services.ping(clusterId)) }
    catch { /* surfaced via empty result */ }
    finally { setPinging(false) }
  }

  const totals = useMemo(() => {
    const list = services ?? []
    return {
      services:  list.length,
      instances: list.reduce((s, x) => s + x.instances, 0),
      requests:  list.reduce((s, x) => s + x.numRequests, 0),
      errors:    list.reduce((s, x) => s + x.numErrors, 0),
    }
  }, [services])

  if (!clusterId) {
    return <div className="flex-1 flex items-center justify-center"><EmptyState icon={<Workflow className="w-7 h-7" />} title="No cluster connected" description="Connect to a NATS server first" /></div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-bg-border/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Workflow className="w-4 h-4 text-accent-primary" />
          <span className="text-sm font-sans font-semibold text-text-primary tracking-tight">Services</span>
          {isFetching && <Spinner size="xs" />}
        </div>
        <div className="h-3 w-px bg-bg-border" />
        <MetaChip label="services"  value={String(totals.services)} />
        <MetaChip label="instances" value={String(totals.instances)} />
        <MetaChip label="requests"  value={formatNumber(totals.requests)} color="var(--accent-primary)" />
        <MetaChip label="errors"    value={formatNumber(totals.errors)} color={totals.errors > 0 ? '#ff4040' : undefined} />

        <div className="ml-auto flex items-center gap-3">
          {ping && (
            <span className="text-2xs font-mono text-text-muted">
              ping: <span className="text-accent-green">{ping.instances}</span> up · {ping.avgMs.toFixed(1)}ms avg ({ping.minMs.toFixed(1)}–{ping.maxMs.toFixed(1)})
            </span>
          )}
          <Button variant="secondary" size="xs" onClick={doPing} disabled={pinging}>
            {pinging ? <><Zap className="w-3 h-3 animate-pulse" /> Pinging…</> : <><Radio className="w-3 h-3" /> Ping all</>}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => refetch()}><RefreshCw className="w-3 h-3" /> Refresh</Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>
        ) : !services || services.length === 0 ? (
          <EmptyState
            icon={<Workflow className="w-10 h-10" />}
            title="No services discovered"
            description="No NATS micro services responded to $SRV. Start a service built with the NATS micro framework (NATS 2.10+) and it'll appear here automatically."
          />
        ) : (
          <div className="space-y-3 max-w-5xl">
            {services.map(svc => (
              <ServiceCard key={svc.name} svc={svc} open={expanded.has(svc.name)} onToggle={() => toggle(svc.name)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ServiceCard({ svc, open, onToggle }: { svc: ServiceInfo; open: boolean; onToggle: () => void }) {
  const errRate = svc.numRequests > 0 ? (svc.numErrors / svc.numRequests) * 100 : 0
  return (
    <div className="surface-card overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover/40 transition-colors">
        {open ? <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />}
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 flex-shrink-0">
          <Workflow className="w-4 h-4 text-accent-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold text-text-primary truncate">{svc.name}</span>
            <Badge variant="violet" size="xs">v{svc.version}</Badge>
            <Badge variant="default" size="xs">{svc.instances} {svc.instances === 1 ? 'instance' : 'instances'}</Badge>
          </div>
          <div className="text-2xs font-mono text-text-muted mt-0.5">{svc.endpoints.length} endpoint{svc.endpoints.length === 1 ? '' : 's'}</div>
        </div>
        <div className="flex items-center gap-5 text-right flex-shrink-0">
          <Stat value={formatNumber(svc.numRequests)} label="requests" />
          <Stat value={formatNumber(svc.numErrors)} label="errors" danger={svc.numErrors > 0} />
          <Stat value={`${errRate.toFixed(1)}%`} label="err rate" warn={errRate > 1} />
        </div>
      </button>

      {open && (
        <div className="border-t border-bg-border/50 overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Subject</th>
                <th className="text-right">Requests</th>
                <th className="text-right">Errors</th>
                <th className="text-right">Avg time</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {svc.endpoints.map(ep => (
                <tr key={ep.name}>
                  <td className="text-text-primary">{ep.name}{ep.queueGroup && <span className="text-text-muted ml-1.5">· {ep.queueGroup}</span>}</td>
                  <td className="text-accent-cyan">{ep.subject}</td>
                  <td className="text-right tabular-nums">{formatNumber(ep.numRequests)}</td>
                  <td className={cn('text-right tabular-nums', ep.numErrors > 0 && 'text-accent-red')}>{formatNumber(ep.numErrors)}</td>
                  <td className="text-right tabular-nums">{fmtNs(ep.avgProcessingNs)}</td>
                  <td className="text-text-muted truncate max-w-[220px]">{ep.lastError || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ value, label, danger, warn }: { value: string; label: string; danger?: boolean; warn?: boolean }) {
  return (
    <div>
      <div className={cn('text-sm font-mono tabular-nums', danger ? 'text-accent-red' : warn ? 'text-accent-yellow' : 'text-text-primary')}>{value}</div>
      <div className="text-2xs font-mono text-text-muted">{label}</div>
    </div>
  )
}

function MetaChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-2xs font-sans text-text-muted">{label}</span>
      <span className="text-xs font-mono tabular-nums font-medium" style={{ color: color ?? 'rgb(var(--c-text-secondary))' }}>{value}</span>
    </div>
  )
}
