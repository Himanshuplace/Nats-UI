/**
 * ClusterTopology — 3D NATS cluster visualization.
 *
 * Uses Three.js via @react-three/fiber (lazy-loaded — ~600KB only fetched
 * when this view opens, keeping the initial bundle small).
 */
import { Suspense, lazy, useEffect, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Server, Cpu, Boxes, AlertTriangle, Check, Network, Leaf, ArrowRight, ArrowLeft } from 'lucide-react'
import { useDataStore, useUIStore } from '@/store'
import { api } from '@/lib/api'
import { HealthDot, Badge, Spinner, Button, cn } from '@/components/ui'
import { formatNumber } from '@/lib/format'
import type { ClusterInfo, GatewayConn, LeafNodeConn } from '@/types'

const GPU_ACK_KEY = 'natsui-topology-gpu-ack'

// Lazy-load the heavy Three.js scene so it doesn't block initial paint
const TopologyScene = lazy(() =>
  import('@/components/three/TopologyScene').then(m => ({ default: m.TopologyScene })),
)

// ── Main component ────────────────────────────────────────────────────────────

interface ClusterTopologyProps {
  clusterId?: string
}

export function ClusterTopology({ clusterId }: ClusterTopologyProps) {
  const clusters       = useDataStore(s => s.clusters)
  const setCluster     = useDataStore(s => s.setCluster)
  const activeClusters = useUIStore(s => s.activeClusters)

  const targetId = clusterId ?? activeClusters[0]

  const { data: fetchedCluster } = useQuery({
    queryKey: ['topology', targetId],
    queryFn:  () => api.cluster.topology(targetId!),
    enabled:  Boolean(targetId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  })

  useEffect(() => {
    if (fetchedCluster) setCluster(fetchedCluster)
  }, [fetchedCluster, setCluster])

  // GPU gate — the 3D scene is WebGL/GPU-intensive, so confirm before mounting it.
  // Persisted acks skip the prompt; otherwise it shows each time the view opens.
  const [confirmed, setConfirmed] = useState<boolean>(() => {
    try { return localStorage.getItem(GPU_ACK_KEY) === '1' } catch { return false }
  })

  const targetClusters = clusterId
    ? (clusters[clusterId] ? [clusters[clusterId]] : [])
    : Object.values(clusters)

  if (targetClusters.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-base">
        <div className="surface-card p-8 text-center space-y-3 max-w-sm">
          <Server className="w-7 h-7 text-text-muted mx-auto mb-3" />
          <p className="text-sm font-sans font-medium text-text-secondary">No clusters connected</p>
          <p className="text-xs font-sans text-text-muted">Connect to a NATS server in Settings</p>
        </div>
      </div>
    )
  }

  // Until confirmed, render the gate INSTEAD of the scene — this also prevents the
  // heavy Three.js chunk from being fetched (lazy import loads on first render).
  if (!confirmed) {
    return (
      <GpuGate
        onConfirm={(remember) => {
          if (remember) { try { localStorage.setItem(GPU_ACK_KEY, '1') } catch { /* ignore */ } }
          setConfirmed(true)
        }}
      />
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {targetClusters.map(cluster => (
        <ClusterView key={cluster.id} cluster={cluster} />
      ))}
    </div>
  )
}

// ── GPU confirmation gate ───────────────────────────────────────────────────────

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')))
  } catch {
    return false
  }
}

function GpuGate({ onConfirm }: { onConfirm: (remember: boolean) => void }) {
  const [remember, setRemember] = useState(false)
  const webgl = useMemo(hasWebGL, [])

  return (
    <div className="flex-1 flex items-center justify-center bg-bg-base p-6">
      <div className="surface-card w-full max-w-md p-7 text-center space-y-4 animate-fade-in">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 mx-auto">
          <Boxes className="w-7 h-7 text-accent-primary" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-sans font-semibold text-text-primary">Enter 3D Topology?</h2>
          <p className="text-sm font-sans text-text-secondary leading-relaxed">
            This view renders a real-time <span className="text-text-primary">WebGL 3D scene</span> of your cluster.
            It's GPU-accelerated and can use noticeable CPU/GPU and battery — best on a machine with a GPU.
          </p>
        </div>

        <div className={cn(
          'flex items-center justify-center gap-2 text-xs font-mono px-3 py-2 rounded-lg border',
          webgl
            ? 'text-accent-green border-accent-green/20 bg-accent-green/5'
            : 'text-accent-yellow border-accent-yellow/20 bg-accent-yellow/5',
        )}>
          {webgl
            ? <><Check className="w-3.5 h-3.5 flex-shrink-0" /> WebGL detected — your browser can render this</>
            : <><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> WebGL not detected — it may not render</>}
        </div>

        <label className="flex items-center justify-center gap-2 text-xs font-sans text-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            className="accent-accent-primary w-3.5 h-3.5"
          />
          Don't ask again on this device
        </label>

        <div className="pt-1">
          <Button variant="primary" size="md" onClick={() => onConfirm(remember)} className="w-full justify-center">
            <Cpu className="w-4 h-4" /> Enter 3D View
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Single cluster view ───────────────────────────────────────────────────────

function ClusterView({ cluster }: { cluster: ClusterInfo }) {
  const throughput = useDataStore(s => s.throughput)
  const pts = throughput[cluster.id] ?? []
  const last = pts[pts.length - 1]
  const nodes = cluster.nodes ?? []

  // External-only (default) hides internal NATS/JetStream traffic ($…, _…) so
  // the topology shows only messages real publishers/subscribers send & receive.
  const [externalOnly, setExternalOnly] = useState(true)

  const totalInMsgs  = last?.inMsgs  ?? nodes.reduce((s, n) => s + n.inMsgs, 0)
  const totalOutMsgs = last?.outMsgs ?? nodes.reduce((s, n) => s + n.outMsgs, 0)
  const totalClients = nodes.reduce((s, n) => s + n.clients, 0)
  // Real per-second flow rate (0 until the first live sample) — drives the
  // ambient particle density honestly so an idle server stays calm.
  const flowRate     = last ? Math.max(0, last.inMsgs + last.outMsgs) : 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Signal-style cluster bar */}
      <div
        className="flex items-center gap-4 px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <HealthDot health={cluster.health} />
          <span className="text-sm font-sans font-semibold text-text-primary tracking-tight">
            {cluster.name}
          </span>
          <Badge
            variant={cluster.health === 'ok' ? 'green' : cluster.health === 'critical' ? 'red' : 'yellow'}
            size="xs"
          >
            {cluster.health.toUpperCase()}
          </Badge>
        </div>

        <div className="h-3 w-px bg-bg-border" />

        <MetaChip label="nodes"   value={String(cluster.numNodes)} />
        <MetaChip label="clients" value={formatNumber(totalClients)} />
        <MetaChip label="in/s"    value={formatNumber(totalInMsgs)} color="var(--accent-primary)" />
        <MetaChip label="out/s"   value={formatNumber(totalOutMsgs)} color="#06B6D4" />

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExternalOnly(v => !v)}
            title={externalOnly
              ? 'Showing only external/app messages — click to ALSO show internal NATS ($…, _…) traffic'
              : 'Showing ALL traffic incl. internal NATS — click to show external/app messages only'}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-2xs font-mono border transition-colors"
            style={{
              borderColor: 'var(--surface-border)',
              color: externalOnly ? 'var(--accent-primary)' : '#f59e0b',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: 9999, display: 'inline-block',
              background: externalOnly ? 'var(--accent-primary)' : '#f59e0b',
            }} />
            {externalOnly ? 'External only' : 'All traffic'}
          </button>
          <span className="text-2xs font-mono text-text-muted">drag to spin · scroll to zoom · right-drag pan</span>
        </div>
      </div>

      {/* Three.js canvas fills everything */}
      <div className="flex-1 relative overflow-hidden" style={{ background: '#000' }}>
        <Suspense fallback={
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Spinner size="md" />
              <span className="text-xs font-mono text-text-muted">Loading 3D scene…</span>
            </div>
          </div>
        }>
          <TopologyScene
            clusterId={cluster.id}
            nodes={nodes}
            routes={cluster.routes ?? []}
            totalThroughput={flowRate}
            externalOnly={externalOnly}
          />
        </Suspense>

        {/* Federation & edge links overlay — only when gateways/leaf nodes exist */}
        <FederationOverlay cluster={cluster} />
      </div>
    </div>
  )
}

// ── Federation & edge overlay ─────────────────────────────────────────────────

/** One remote cluster's gateway link, merged across direction + per-server conns. */
interface GatewayLink {
  remote: string
  outbound: boolean
  inbound: boolean
  connections: number
  rttMs: number
}

function groupGateways(gws: GatewayConn[]): GatewayLink[] {
  const byRemote = new Map<string, GatewayLink>()
  for (const g of gws) {
    const link = byRemote.get(g.remoteCluster) ?? {
      remote: g.remoteCluster, outbound: false, inbound: false, connections: 0, rttMs: 0,
    }
    if (g.direction === 'outbound') link.outbound = true
    else link.inbound = true
    link.connections += g.numConnections && g.numConnections > 0 ? g.numConnections : 1
    if (g.rttMs && g.rttMs > link.rttMs) link.rttMs = g.rttMs
    byRemote.set(g.remoteCluster, link)
  }
  return [...byRemote.values()].sort((a, b) => a.remote.localeCompare(b.remote))
}

function FederationOverlay({ cluster }: { cluster: ClusterInfo }) {
  const gateways = useMemo(() => groupGateways(cluster.gateways ?? []), [cluster.gateways])
  const leafs: LeafNodeConn[] = cluster.leafNodes ?? []

  if (gateways.length === 0 && leafs.length === 0) return null

  return (
    <div className="absolute bottom-3 left-3 w-[290px] max-h-[60%] overflow-y-auto rounded-xl border border-bg-border/70 bg-bg-base/80 backdrop-blur-md shadow-xl animate-fade-in">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bg-border/50">
        <Network className="w-3.5 h-3.5 text-accent-primary" />
        <span className="text-2xs font-sans font-semibold text-text-primary tracking-wide uppercase">Federation &amp; Edge</span>
      </div>

      {gateways.length > 0 && (
        <div className="px-3 py-2.5">
          <div className="text-2xs font-mono text-text-muted mb-1.5">Gateways · supercluster</div>
          <div className="space-y-1.5">
            {gateways.map(g => (
              <div key={g.remote} className="flex items-center gap-2">
                <span className="flex items-center gap-0.5 text-accent-primary">
                  {g.outbound && <ArrowRight className="w-3 h-3" />}
                  {g.inbound && <ArrowLeft className="w-3 h-3" />}
                </span>
                <span className="text-xs font-mono font-semibold text-text-primary truncate flex-1">{g.remote}</span>
                <Badge variant="default" size="xs">{g.connections} conn</Badge>
                {g.rttMs > 0 && <span className="text-2xs font-mono text-accent-cyan tabular-nums">{fmtMs(g.rttMs)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {leafs.length > 0 && (
        <div className="px-3 py-2.5 border-t border-bg-border/40">
          <div className="text-2xs font-mono text-text-muted mb-1.5">Leaf nodes · {leafs.length}</div>
          <div className="space-y-1.5">
            {leafs.map((l, i) => (
              <div key={`${l.serverId}-${i}`} className="flex items-center gap-2">
                <Leaf className="w-3 h-3 text-accent-green flex-shrink-0" />
                <span className="text-xs font-mono text-text-primary truncate flex-1" title={l.name || l.account}>
                  {l.name || l.account || 'leaf'}
                </span>
                <span className="text-2xs font-mono text-text-muted tabular-nums">{formatNumber(l.subscriptions)} subs</span>
                {l.rttMs ? <span className="text-2xs font-mono text-accent-cyan tabular-nums">{fmtMs(l.rttMs)}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`
  if (ms < 10) return `${ms.toFixed(2)}ms`
  return `${ms.toFixed(1)}ms`
}

function MetaChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-2xs font-sans text-text-muted">{label}</span>
      <span
        className="text-xs font-mono tabular-nums font-medium"
        style={{ color: color ?? 'rgb(var(--c-text-secondary))' }}
      >
        {value}
      </span>
    </div>
  )
}
