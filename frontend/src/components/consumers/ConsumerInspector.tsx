import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Users, AlertTriangle, TrendingDown, Activity,
  Zap, Clock,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import {
  Badge, Button, HealthDot, SectionHeader,
  StatCard, EmptyState, Spinner, cn,
} from '@/components/ui'
import { formatNumber, formatTimeAgo, formatDuration, healthColor } from '@/lib/format'
import type { ConsumerInfo, ConsumerHealth } from '@/types'

export function ConsumerInspector() {
  const [selectedStream,   setSelectedStream]   = useState<string>('')
  const [selectedConsumer, setSelectedConsumer] = useState<string | null>(null)

  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId = activeClusters[0] ?? ''

  const { data: streams } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
    refetchInterval: 10_000,
    enabled: activeClusters.length > 0 && Boolean(clusterId),
  })

  const { data: consumers, isLoading } = useQuery({
    queryKey: ['consumers', clusterId, selectedStream],
    queryFn: () => api.consumers.list(clusterId, selectedStream),
    refetchInterval: 3000,
    enabled: Boolean(selectedStream),
  })

  const selected = consumers?.find(c => c.name === selectedConsumer)

  // Health summary
  const slow   = consumers?.filter(c => c.health === 'slow' || c.health === 'lagging').length ?? 0
  const storms = consumers?.filter(c => c.health === 'redelivery_storm').length ?? 0
  const dead   = consumers?.filter(c => c.health === 'dead').length ?? 0

  return (
    <div className="flex h-full bg-bg-base">
      {/* Left panel */}
      <div className="w-80 flex-shrink-0 border-r border-bg-border flex flex-col">
        {/* Stream selector */}
        <div className="p-3 border-b border-bg-border">
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">
            Stream
          </label>
          <select
            value={selectedStream}
            onChange={e => { setSelectedStream(e.target.value); setSelectedConsumer(null) }}
            className="w-full bg-bg-surface border border-bg-border text-text-secondary text-xs font-mono rounded px-2 py-1.5 outline-none focus:border-accent-cyan/50"
          >
            <option value="">— select stream —</option>
            {streams?.map(s => (
              <option key={s.config.name} value={s.config.name}>
                {s.config.name}
              </option>
            ))}
          </select>
        </div>

        {/* Health summary */}
        {consumers && consumers.length > 0 && (slow > 0 || storms > 0 || dead > 0) && (
          <div className="px-3 py-2 border-b border-bg-border flex flex-wrap gap-2">
            {slow > 0 && (
              <Badge variant="yellow" size="xs">
                <TrendingDown className="w-2.5 h-2.5 mr-1" /> {slow} slow
              </Badge>
            )}
            {storms > 0 && (
              <Badge variant="red" size="xs">
                <AlertTriangle className="w-2.5 h-2.5 mr-1" /> {storms} storm
              </Badge>
            )}
            {dead > 0 && (
              <Badge variant="red" size="xs">{dead} dead</Badge>
            )}
          </div>
        )}

        <SectionHeader
          label="Consumers"
          count={consumers?.length}
        />

        <div className="flex-1 overflow-y-auto">
          {!selectedStream && (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title="Select a stream"
              description="Choose a stream to inspect its consumers"
            />
          )}

          {selectedStream && isLoading && (
            <div className="flex justify-center py-8"><Spinner /></div>
          )}

          {consumers?.map(c => (
            <ConsumerListItem
              key={c.name}
              consumer={c}
              selected={selectedConsumer === c.name}
              onSelect={() => setSelectedConsumer(c.name)}
            />
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <ConsumerDetail consumer={selected} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<Activity className="w-10 h-10" />}
              title="Select a consumer"
              description="Inspect ACK state, lag, redeliveries, and config"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Consumer list item ────────────────────────────────────────────────────────

function ConsumerListItem({
  consumer, selected, onSelect,
}: {
  consumer: ConsumerInfo
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex flex-col gap-0.5 px-3 py-2.5 border-b border-bg-border/50 text-left transition-colors',
        selected ? 'bg-accent-cyan/5 border-l-2 border-l-accent-cyan' : 'hover:bg-bg-hover',
      )}
    >
      <div className="flex items-center gap-2">
        <HealthDot health={consumer.health} size="xs" />
        <span className={cn(
          'flex-1 text-xs font-mono font-medium truncate',
          selected ? 'text-accent-cyan' : 'text-text-primary',
        )}>
          {consumer.name}
        </span>
        <LagBadge lag={consumer.lag} />
      </div>

      <div className="flex items-center gap-3 ml-4 text-2xs font-mono text-text-muted">
        <span>pending: {consumer.numAckPending}</span>
        {consumer.numRedelivered > 0 && (
          <span className="text-accent-yellow">redeliv: {consumer.numRedelivered}</span>
        )}
      </div>
    </button>
  )
}

function LagBadge({ lag }: { lag: number }) {
  if (lag === 0) return <Badge variant="green" size="xs">0</Badge>
  if (lag < 1000) return <Badge variant="default" size="xs">{formatNumber(lag)}</Badge>
  if (lag < 100_000) return <Badge variant="yellow" size="xs">{formatNumber(lag)}</Badge>
  return <Badge variant="red" size="xs">{formatNumber(lag)}</Badge>
}

// ── Consumer detail ───────────────────────────────────────────────────────────

function ConsumerDetail({ consumer }: { consumer: ConsumerInfo }) {
  const lagPct = consumer.numPending > 0
    ? Math.min((consumer.lag / consumer.numPending) * 100, 100)
    : 0

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-mono font-bold text-text-primary">{consumer.name}</h1>
            <HealthDot health={consumer.health} size="md" />
            <HealthBadge health={consumer.health} />
          </div>
          <p className="text-xs font-mono text-text-muted">stream: {consumer.stream}</p>
        </div>
        <div className="text-xs font-mono text-text-muted">{formatTimeAgo(consumer.created)}</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Lag"         value={formatNumber(consumer.lag)}           color={consumer.lag > 10000 ? 'red' : consumer.lag > 0 ? 'yellow' : 'green'} />
        <StatCard label="ACK Pending" value={String(consumer.numAckPending)}       color={consumer.numAckPending > 0 ? 'yellow' : 'green'} />
        <StatCard label="Redelivered" value={formatNumber(consumer.numRedelivered)} color={consumer.numRedelivered > 100 ? 'red' : 'default'} />
        <StatCard label="Waiting"     value={String(consumer.numWaiting)} />
      </div>

      {/* Lag bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-2xs font-mono text-text-muted">
          <span>Consumer lag</span>
          <span>{formatNumber(consumer.lag)} / {formatNumber(consumer.numPending)} pending</span>
        </div>
        <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              lagPct > 80 ? 'bg-accent-red' : lagPct > 40 ? 'bg-accent-yellow' : 'bg-accent-green',
            )}
            style={{ width: `${lagPct}%` }}
          />
        </div>
      </div>

      {/* Sequence info */}
      <div className="grid grid-cols-2 gap-6">
        <SequenceBlock
          label="Delivered"
          consumerSeq={consumer.delivered.consumerSeq}
          streamSeq={consumer.delivered.streamSeq}
        />
        <SequenceBlock
          label="ACK Floor"
          consumerSeq={consumer.ackFloor.consumerSeq}
          streamSeq={consumer.ackFloor.streamSeq}
          dim
        />
      </div>

      {/* Configuration */}
      <div>
        <h2 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest mb-3">
          Configuration
        </h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono">
          <ConfigRow label="Deliver Policy" value={consumer.config.deliverPolicy} />
          <ConfigRow label="ACK Policy"     value={consumer.config.ackPolicy} />
          <ConfigRow label="Replay Policy"  value={consumer.config.replayPolicy} />
          <ConfigRow label="Max Deliver"    value={consumer.config.maxDeliver ? String(consumer.config.maxDeliver) : '∞'} />
          <ConfigRow label="ACK Wait"       value={consumer.config.ackWait ? formatDuration(consumer.config.ackWait / 1e6) : '30s'} />
          <ConfigRow label="Filter Subject" value={consumer.config.filterSubject || '(all)'} />
          {consumer.config.durableName && (
            <ConfigRow label="Durable Name" value={consumer.config.durableName} />
          )}
          {consumer.config.deliverGroup && (
            <ConfigRow label="Queue Group" value={consumer.config.deliverGroup} />
          )}
        </div>
      </div>

      {/* Redelivery storm warning */}
      {consumer.health === 'redelivery_storm' && (
        <div className="flex items-start gap-3 p-3 bg-accent-red/5 border border-accent-red/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-accent-red flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-mono font-semibold text-accent-red">Redelivery Storm Detected</p>
            <p className="text-xs font-mono text-text-secondary mt-0.5">
              {consumer.numRedelivered.toLocaleString()} messages are being redelivered repeatedly.
              Check your consumer for processing errors or ACK timeouts.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthBadge({ health }: { health: ConsumerHealth }) {
  const variants: Record<ConsumerHealth, 'green' | 'yellow' | 'red' | 'default'> = {
    ok:               'green',
    slow:             'yellow',
    lagging:          'yellow',
    redelivery_storm: 'red',
    stuck:            'red',
    dead:             'red',
  }
  return <Badge variant={variants[health] ?? 'default'}>{health.toUpperCase().replace('_', ' ')}</Badge>
}

function SequenceBlock({ label, consumerSeq, streamSeq, dim }: {
  label: string
  consumerSeq: number
  streamSeq: number
  dim?: boolean
}) {
  return (
    <div className={cn('p-3 rounded-md border', dim ? 'bg-transparent border-bg-border' : 'bg-bg-surface border-bg-border-strong')}>
      <p className="text-2xs font-mono text-text-muted uppercase tracking-wide mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between text-xs font-mono">
          <span className="text-text-muted">consumer seq</span>
          <span className="text-text-secondary">{formatNumber(consumerSeq)}</span>
        </div>
        <div className="flex justify-between text-xs font-mono">
          <span className="text-text-muted">stream seq</span>
          <span className="text-text-secondary">{formatNumber(streamSeq)}</span>
        </div>
      </div>
    </div>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </>
  )
}
