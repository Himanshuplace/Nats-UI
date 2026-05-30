import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { useDataStore, useUIStore } from '@/store'
import { StatCard, EmptyState, Badge } from '@/components/ui'
import { formatNumber, formatBytes, formatBytesPerSec, formatMsgsPerSec } from '@/lib/format'
import { BarChart2 } from 'lucide-react'
import type { ThroughputPoint } from '@/types'

const CHART_COLORS = {
  in:    '#10B981',
  out:   '#06B6D4',
  bytes: '#A855F7',
}

export function MetricsDashboard() {
  const activeClusters = useUIStore(s => s.activeClusters)
  const throughputAll  = useDataStore(s => s.throughput)
  const clusters       = useDataStore(s => s.clusters)

  const hasData = Object.keys(throughputAll).length > 0

  if (!hasData && activeClusters.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="glass rounded-xl p-8 shadow-glass text-center space-y-2">
          <BarChart2 className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm font-mono text-text-secondary">No metrics available</p>
          <p className="text-xs font-mono text-text-muted">Connect to a NATS cluster to start collecting metrics</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {/* Per-cluster dashboards */}
      {Object.entries(throughputAll).map(([clusterId, points]) => {
        const cluster = clusters[clusterId]
        return (
          <ClusterMetrics
            key={clusterId}
            clusterId={clusterId}
            clusterName={cluster?.name ?? clusterId}
            points={points}
            health={cluster?.health ?? 'unknown'}
          />
        )
      })}

      {/* If connected but no throughput yet */}
      {activeClusters.length > 0 && Object.keys(throughputAll).length === 0 && (
        <div className="flex justify-center py-12 text-sm font-mono text-text-muted">
          Collecting metrics...
        </div>
      )}
    </div>
  )
}

function ClusterMetrics({
  clusterId, clusterName, points, health,
}: {
  clusterId: string
  clusterName: string
  points: ThroughputPoint[]
  health: string
}) {
  const last = points[points.length - 1]

  const chartData = useMemo(() => {
    return points.map((p, i) => ({
      i,
      time:     new Date(p.timestamp).toLocaleTimeString(),
      inMsgs:   p.inMsgs,
      outMsgs:  p.outMsgs,
      inBytes:  p.inBytes,
      outBytes: p.outBytes,
      total:    p.inMsgs + p.outMsgs,
    }))
  }, [points])

  return (
    <section className="space-y-5">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <h2 className="text-base font-mono font-bold text-text-primary">{clusterName}</h2>
        <Badge variant={health === 'ok' ? 'green' : health === 'critical' ? 'red' : 'yellow'} size="xs">
          {health.toUpperCase()}
        </Badge>
        <span className="text-2xs font-mono text-text-muted">{clusterId}</span>
      </div>

      {/* Current stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="In msgs/s"
          value={last ? formatNumber(last.inMsgs) : '—'}
          color="green"
        />
        <StatCard
          label="Out msgs/s"
          value={last ? formatNumber(last.outMsgs) : '—'}
          color="cyan"
        />
        <StatCard
          label="Throughput In"
          value={last ? formatBytesPerSec(last.inBytes) : '—'}
          color="purple"
        />
        <StatCard
          label="Throughput Out"
          value={last ? formatBytesPerSec(last.outBytes) : '—'}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Messages per Second">
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id={`in-${clusterId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.in} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.in} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`out-${clusterId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.out} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.out} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#1E2535" />
              <XAxis
                dataKey="i"
                hide
              />
              <YAxis
                width={50}
                tickFormatter={v => formatNumber(v)}
                tick={{ fill: '#4B5563', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: '#0D1117',
                  border: '1px solid #1E2535',
                  borderRadius: '6px',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '11px',
                  color: '#E2E8F0',
                }}
                formatter={(v: number, name: string) => [formatNumber(v), name === 'inMsgs' ? 'in' : 'out']}
                labelFormatter={() => ''}
              />
              <Area
                type="monotone"
                dataKey="inMsgs"
                stroke={CHART_COLORS.in}
                strokeWidth={1.5}
                fill={`url(#in-${clusterId})`}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="outMsgs"
                stroke={CHART_COLORS.out}
                strokeWidth={1.5}
                fill={`url(#out-${clusterId})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <Legend items={[
            { color: CHART_COLORS.in,  label: 'In' },
            { color: CHART_COLORS.out, label: 'Out' },
          ]} />
        </ChartCard>

        <ChartCard title="Bytes per Second">
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id={`bytes-${clusterId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.bytes} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.bytes} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#1E2535" />
              <XAxis dataKey="i" hide />
              <YAxis
                width={60}
                tickFormatter={v => formatBytes(v)}
                tick={{ fill: '#4B5563', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: '#0D1117',
                  border: '1px solid #1E2535',
                  borderRadius: '6px',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '11px',
                  color: '#E2E8F0',
                }}
                formatter={(v: number, name: string) => [formatBytesPerSec(v), name === 'inBytes' ? 'in' : 'out']}
                labelFormatter={() => ''}
              />
              <Area
                type="monotone"
                dataKey="inBytes"
                stroke={CHART_COLORS.bytes}
                strokeWidth={1.5}
                fill={`url(#bytes-${clusterId})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <Legend items={[{ color: CHART_COLORS.bytes, label: 'Throughput' }]} />
        </ChartCard>
      </div>
    </section>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl border-bg-border/50 p-4 shadow-glass">
      <h3 className="text-2xs font-mono font-semibold text-text-muted uppercase tracking-widest mb-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="flex items-center gap-4 mt-2">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="text-2xs font-mono text-text-muted">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
