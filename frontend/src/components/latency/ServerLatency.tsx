/**
 * ServerLatency — per-server RTT / latency probe (`nats rtt`-style).
 *
 * Dials every server in the active cluster's configured URL list with its own
 * short-lived connection (reusing the cluster's auth) and measures round-trip
 * time via nc.RTT() over several samples. Surfaces min/avg/max per server plus
 * reachability — the network-health view that the JetStream admin screens lack.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gauge, RefreshCw, Server, Wifi, WifiOff, Activity } from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, Badge, EmptyState, Spinner, cn } from '@/components/ui'
import type { RTTResult } from '@/types'

/** Latency tiers (ms) → a color + label. Lower is better. */
function tier(ms: number): { color: string; label: string } {
  if (ms < 1)   return { color: '#34d399', label: 'excellent' } // green
  if (ms < 5)   return { color: '#34d399', label: 'excellent' }
  if (ms < 25)  return { color: '#22d3ee', label: 'good'      } // cyan
  if (ms < 100) return { color: '#a78bfa', label: 'fair'      } // violet
  if (ms < 250) return { color: '#fbbf24', label: 'slow'      } // yellow
  return { color: '#ff5252', label: 'very slow' }               // red
}

function fmtMs(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1) return ms.toFixed(2)
  if (ms < 10) return ms.toFixed(2)
  return ms.toFixed(1)
}

export function ServerLatency() {
  const clusterId = useUIStore(s => s.activeClusters[0] ?? '')

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['rtt', clusterId],
    queryFn: () => api.cluster.rtt(clusterId),
    enabled: Boolean(clusterId),
    refetchInterval: 10_000,
  })

  const results = data ?? []

  const summary = useMemo(() => {
    const reach = results.filter(r => r.reachable)
    const avgs = reach.map(r => r.avgMs ?? 0)
    return {
      total:     results.length,
      reachable: reach.length,
      down:      results.length - reach.length,
      bestMs:    avgs.length ? Math.min(...avgs) : undefined,
      worstMs:   avgs.length ? Math.max(...avgs) : undefined,
    }
  }, [results])

  if (!clusterId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState icon={<Gauge className="w-7 h-7" />} title="No cluster connected" description="Connect to a NATS server first" />
      </div>
    )
  }

  // Scale bars relative to the worst average so differences are visible.
  const scaleMax = Math.max(summary.worstMs ?? 1, 1)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-bg-border/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent-primary" />
          <span className="text-sm font-sans font-semibold text-text-primary tracking-tight">Server Latency</span>
          {isFetching && <Spinner size="xs" />}
        </div>
        <div className="h-3 w-px bg-bg-border" />
        <MetaChip label="servers"   value={String(summary.total)} />
        <MetaChip label="reachable" value={String(summary.reachable)} color="#34d399" />
        {summary.down > 0 && <MetaChip label="down" value={String(summary.down)} color="#ff5252" />}
        {summary.bestMs != null && <MetaChip label="best" value={`${fmtMs(summary.bestMs)}ms`} color="#22d3ee" />}

        <div className="ml-auto flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-2xs font-mono text-text-muted">
              probed {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <Button variant="secondary" size="xs" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <><Activity className="w-3 h-3 animate-pulse" /> Probing…</> : <><RefreshCw className="w-3 h-3" /> Probe</>}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Gauge className="w-10 h-10" />}
            title="No servers to probe"
            description="The active cluster has no configured server URLs to measure latency against."
          />
        ) : (
          <div className="grid gap-3 max-w-4xl" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {results.map((r, i) => (
              <LatencyCard key={`${r.server}-${i}`} r={r} scaleMax={scaleMax} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LatencyCard({ r, scaleMax }: { r: RTTResult; scaleMax: number }) {
  const t = r.reachable ? tier(r.avgMs ?? 0) : { color: '#ff5252', label: 'unreachable' }
  const pct = r.reachable ? Math.min(100, ((r.avgMs ?? 0) / scaleMax) * 100) : 100

  return (
    <div className="surface-card p-4">
      {/* Header: server + reachability */}
      <div className="flex items-start gap-2.5">
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 border"
          style={{ backgroundColor: `${t.color}1a`, borderColor: `${t.color}33` }}
        >
          <Server className="w-4 h-4" style={{ color: t.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono font-semibold text-text-primary truncate" title={r.server}>
            {r.server.replace(/^nats:\/\//, '')}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {r.reachable ? (
              <><Wifi className="w-3 h-3 text-accent-green" /><span className="text-2xs font-mono text-accent-green">reachable</span></>
            ) : (
              <><WifiOff className="w-3 h-3 text-accent-red" /><span className="text-2xs font-mono text-accent-red">unreachable</span></>
            )}
          </div>
        </div>
        <Badge variant="default" size="xs" style={{ color: t.color, borderColor: `${t.color}40` }}>{t.label}</Badge>
      </div>

      {r.reachable ? (
        <>
          {/* Big avg figure */}
          <div className="flex items-baseline gap-1.5 mt-3.5">
            <span className="text-2xl font-mono font-semibold tabular-nums leading-none" style={{ color: t.color }}>
              {fmtMs(r.avgMs)}
            </span>
            <span className="text-xs font-mono text-text-muted">ms avg</span>
            {r.samples != null && <span className="ml-auto text-2xs font-mono text-text-muted">{r.samples} samples</span>}
          </div>

          {/* Scaled bar */}
          <div className="mt-2.5 h-1.5 rounded-full bg-bg-border/40 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: t.color }} />
          </div>

          {/* min / max */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Metric label="min" value={`${fmtMs(r.minMs)}ms`} />
            <Metric label="max" value={`${fmtMs(r.maxMs)}ms`} />
          </div>

          {r.connectedUrl && r.connectedUrl !== r.server && (
            <div className="mt-2.5 text-2xs font-mono text-text-muted truncate" title={r.connectedUrl}>
              via {r.connectedUrl.replace(/^nats:\/\//, '')}
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 text-2xs font-mono text-accent-red/90 break-words leading-relaxed">
          {r.error || 'Connection failed'}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-secondary/40 border border-bg-border/40 px-2.5 py-1.5">
      <div className="text-2xs font-sans text-text-muted">{label}</div>
      <div className="text-sm font-mono tabular-nums text-text-secondary">{value}</div>
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
