import { useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  BackgroundVariant, useNodesState, useEdgesState,
  MarkerType, Position,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useDataStore, useUIStore } from '@/store'
import { api } from '@/lib/api'
import { HealthDot, Badge, StatCard, EmptyState } from '@/components/ui'
import { formatNumber, formatBytes, healthColor } from '@/lib/format'
import { Server } from 'lucide-react'
import type { ClusterInfo, NodeInfo } from '@/types'

// ── Custom node component ─────────────────────────────────────────────────────

function NATSNode({ data }: { data: NodeInfo & { clusterId: string } }) {
  const isLeader = data.role === 'leader'

  return (
    <div
      className={`
        w-52 rounded-lg border glass p-3 font-mono
        ${isLeader ? 'border-accent-cyan shadow-glow-cyan' : 'border-bg-border-strong'}
        shadow-lg
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <HealthDot health={data.health} />
          <span className="text-xs text-text-primary font-semibold truncate max-w-28">
            {data.name}
          </span>
        </div>
        {isLeader && (
          <Badge variant="cyan" size="xs">LEADER</Badge>
        )}
        {data.role === 'follower' && (
          <Badge variant="default" size="xs">FOLLOW</Badge>
        )}
      </div>

      {/* Address */}
      <p className="text-2xs text-text-muted mb-2">{data.host}:{data.port}</p>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-1.5 text-2xs">
        <div>
          <span className="text-text-muted">clients</span>
          <p className="text-text-secondary">{formatNumber(data.clients)}</p>
        </div>
        <div>
          <span className="text-text-muted">subs</span>
          <p className="text-text-secondary">{formatNumber(data.subscriptions)}</p>
        </div>
        <div>
          <span className="text-text-muted">in</span>
          <p className="text-accent-green">{formatNumber(data.inMsgs)}/s</p>
        </div>
        <div>
          <span className="text-text-muted">out</span>
          <p className="text-accent-cyan">{formatNumber(data.outMsgs)}/s</p>
        </div>
      </div>

      {/* JetStream indicator */}
      {data.jetstream && (
        <div className="mt-2 pt-2 border-t border-bg-border">
          <Badge variant="purple" size="xs">JetStream</Badge>
        </div>
      )}

      {/* Slow consumer warning */}
      {data.slowClients > 0 && (
        <div className="mt-1">
          <Badge variant="yellow" size="xs">{data.slowClients} slow consumers</Badge>
        </div>
      )}
    </div>
  )
}

const nodeTypes = { nats: NATSNode }

// ── Cluster topology ──────────────────────────────────────────────────────────

interface ClusterTopologyProps {
  clusterId?: string
}

export function ClusterTopology({ clusterId }: ClusterTopologyProps) {
  const clusters       = useDataStore(s => s.clusters)
  const setCluster     = useDataStore(s => s.setCluster)
  const activeClusters = useUIStore(s => s.activeClusters)

  // Pick a target — prop takes precedence, otherwise first active cluster
  const targetId = clusterId ?? activeClusters[0]

  // REST fetch seeds the store immediately (WS topology broadcast has a 10s delay)
  const { data: fetchedCluster } = useQuery({
    queryKey: ['topology', targetId],
    queryFn: () => api.cluster.topology(targetId!),
    enabled: Boolean(targetId),
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
      <div className="flex-1 flex items-center justify-center">
        <div className="glass rounded-xl p-8 shadow-glass text-center space-y-2">
          <Server className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm font-mono text-text-secondary">No clusters connected</p>
          <p className="text-xs font-mono text-text-muted">Connect to a NATS server in Settings, then come back here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Cluster selector tabs when multiple */}
      {targetClusters.length > 1 && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-bg-border/50 glass flex-shrink-0">
          {targetClusters.map(c => (
            <div key={c.id} className="flex items-center gap-1.5 px-3 py-1 rounded bg-bg-surface border border-bg-border text-xs font-mono text-text-secondary">
              <HealthDot health={c.health} size="xs" />
              {c.name}
            </div>
          ))}
        </div>
      )}

      {targetClusters.map(cluster => (
        <ClusterGraph key={cluster.id} cluster={cluster} />
      ))}
    </div>
  )
}

function ClusterGraph({ cluster }: { cluster: ClusterInfo }) {
  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => buildGraph(cluster),
    [cluster],
  )

  const [nodes, , onNodesChange] = useNodesState(flowNodes)
  const [edges, , onEdgesChange] = useEdgesState(flowEdges)

  const totalInMsgs  = cluster.nodes.reduce((s, n) => s + n.inMsgs, 0)
  const totalOutMsgs = cluster.nodes.reduce((s, n) => s + n.outMsgs, 0)
  const totalClients = cluster.nodes.reduce((s, n) => s + n.clients, 0)

  return (
    <div className="flex-1 flex flex-col">
      {/* Cluster summary bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-bg-border/50 glass flex-shrink-0">
        <div className="flex items-center gap-2">
          <HealthDot health={cluster.health} />
          <span className="text-sm font-mono font-semibold text-text-primary">{cluster.name}</span>
          <Badge variant={cluster.health === 'ok' ? 'green' : 'yellow'} size="xs">
            {cluster.health.toUpperCase()}
          </Badge>
        </div>
        <div className="h-4 w-px bg-bg-border" />
        <StatRow label="nodes"   value={String(cluster.numNodes)} />
        <StatRow label="clients" value={formatNumber(totalClients)} />
        <StatRow label="in"      value={formatNumber(totalInMsgs) + '/s'} color="text-accent-green" />
        <StatRow label="out"     value={formatNumber(totalOutMsgs) + '/s'} color="text-accent-cyan" />
      </div>

      {/* React Flow canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          attributionPosition="bottom-left"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#1E2535"
          />
          <Controls
            className="glass border border-bg-border/50 rounded-md overflow-hidden"
            showInteractive={false}
          />
          <MiniMap
            className="glass border border-bg-border/50 rounded-md overflow-hidden"
            nodeColor={n => {
              const data = n.data as NodeInfo
              return data.health === 'ok' ? '#10B981' : data.health === 'degraded' ? '#F59E0B' : '#EF4444'
            }}
            maskColor="rgba(7,10,13,0.7)"
          />
        </ReactFlow>
      </div>
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-2xs font-mono text-text-muted">{label}</span>
      <span className={`text-xs font-mono font-semibold ${color ?? 'text-text-secondary'}`}>{value}</span>
    </div>
  )
}

// ── Graph builder ─────────────────────────────────────────────────────────────

function buildGraph(cluster: ClusterInfo): { nodes: Node[]; edges: Edge[] } {
  const n = cluster.nodes.length
  const radius = Math.max(200, n * 80)
  const centerX = 400
  const centerY = 300

  const nodes: Node[] = cluster.nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    const x = centerX + radius * Math.cos(angle) - 104 // 104 = half node width
    const y = centerY + radius * Math.sin(angle) - 70

    return {
      id:       node.id,
      type:     'nats',
      position: { x, y },
      data:     node,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
  })

  const edges: Edge[] = (cluster.routes ?? []).map((route, i) => ({
    id:             `route-${i}`,
    source:         route.from,
    target:         route.to,
    type:           'smoothstep',
    animated:       route.healthy,
    style:          {
      stroke: route.healthy ? '#06B6D4' : '#EF4444',
      strokeWidth: 1.5,
      opacity: 0.6,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: route.healthy ? '#06B6D4' : '#EF4444',
      width: 12,
      height: 12,
    },
    label: route.latencyMs ? `${route.latencyMs.toFixed(1)}ms` : undefined,
    labelStyle: { fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' },
    labelBgStyle: { fill: '#0D1117' },
  }))

  // If no routes provided but multiple nodes, draw a full mesh
  if (edges.length === 0 && cluster.nodes.length > 1) {
    for (let i = 0; i < cluster.nodes.length; i++) {
      for (let j = i + 1; j < cluster.nodes.length; j++) {
        edges.push({
          id:     `mesh-${i}-${j}`,
          source: cluster.nodes[i].id,
          target: cluster.nodes[j].id,
          type:   'smoothstep',
          animated: true,
          style: { stroke: '#1E2535', strokeWidth: 1, opacity: 0.8 },
        })
      }
    }
  }

  return { nodes, edges }
}
