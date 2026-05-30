/**
 * ClusterTopology — 3D NATS cluster visualization.
 *
 * Uses Three.js via @react-three/fiber (lazy-loaded — ~600KB only fetched
 * when this view opens, keeping the initial bundle small).
 */
import { Suspense, lazy, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { useDataStore, useUIStore } from '@/store'
import { api } from '@/lib/api'
import { HealthDot, Badge, Spinner } from '@/components/ui'
import { formatNumber } from '@/lib/format'
import type { ClusterInfo } from '@/types'

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {targetClusters.map(cluster => (
        <ClusterView key={cluster.id} cluster={cluster} />
      ))}
    </div>
  )
}

// ── Single cluster view ───────────────────────────────────────────────────────

function ClusterView({ cluster }: { cluster: ClusterInfo }) {
  const throughput = useDataStore(s => s.throughput)
  const pts = throughput[cluster.id] ?? []
  const last = pts[pts.length - 1]
  const nodes = cluster.nodes ?? []

  const totalInMsgs  = last?.inMsgs  ?? nodes.reduce((s, n) => s + n.inMsgs, 0)
  const totalOutMsgs = last?.outMsgs ?? nodes.reduce((s, n) => s + n.outMsgs, 0)
  const totalClients = nodes.reduce((s, n) => s + n.clients, 0)
  const totalMsgs    = totalInMsgs + totalOutMsgs

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

        <div className="ml-auto text-2xs font-mono text-text-muted">
          orbit · scroll to zoom
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
            nodes={nodes}
            routes={cluster.routes ?? []}
            totalThroughput={totalMsgs}
          />
        </Suspense>
      </div>
    </div>
  )
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
