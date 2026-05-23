import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Layers, ChevronRight, ChevronDown, Database,
  Clock, Hash, HardDrive, Users,
} from 'lucide-react'
import { useUIStore, useDataStore } from '@/store'
import { api } from '@/lib/api'
import {
  Badge, Button, HealthDot, SectionHeader, StatCard,
  EmptyState, Spinner, cn,
} from '@/components/ui'
import {
  formatBytes, formatNumber, formatTimeAgo, formatDuration, healthColor,
} from '@/lib/format'
import type { StreamInfo } from '@/types'

export function StreamExplorer() {
  const [selectedStream, setSelectedStream] = useState<string | null>(null)
  const [expandedSubjects, setExpandedSubjects] = useState(false)
  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId = activeClusters[0] ?? 'default'

  const { data: streams, isLoading, error } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
    refetchInterval: 5000,
    enabled: Boolean(clusterId),
  })

  const selected = streams?.find(s => s.config.name === selectedStream)

  return (
    <div className="flex h-full bg-bg-base">
      {/* Left: stream list */}
      <div className="w-72 flex-shrink-0 border-r border-bg-border flex flex-col">
        <SectionHeader
          label="Streams"
          count={streams?.length}
          action={
            <Button variant="ghost" size="xs">
              + New
            </Button>
          }
        />

        {/* Search */}
        <div className="px-3 pb-2">
          <input
            type="text"
            placeholder="Filter streams..."
            className="w-full bg-bg-surface border border-bg-border rounded px-2 py-1 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 text-2xs font-mono text-accent-red">
              {(error as Error).message}
            </div>
          )}

          {!isLoading && !error && (!streams || streams.length === 0) && (
            <EmptyState
              icon={<Layers className="w-6 h-6" />}
              title="No streams found"
              description="Create a JetStream stream to get started"
            />
          )}

          {streams?.map(stream => (
            <StreamListItem
              key={stream.config.name}
              stream={stream}
              selected={selectedStream === stream.config.name}
              onSelect={() => setSelectedStream(stream.config.name)}
            />
          ))}
        </div>
      </div>

      {/* Right: stream detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <StreamDetail stream={selected} clusterId={clusterId} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={<Database className="w-10 h-10" />}
              title="Select a stream"
              description="Click a stream to inspect its configuration, state, and consumers"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Stream list item ──────────────────────────────────────────────────────────

function StreamListItem({
  stream, selected, onSelect,
}: {
  stream: StreamInfo
  selected: boolean
  onSelect: () => void
}) {
  const health = stream.health ?? 'ok'

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex flex-col gap-0.5 px-3 py-2.5 border-b border-bg-border/50 text-left transition-colors',
        selected
          ? 'bg-accent-cyan/5 border-l-2 border-l-accent-cyan'
          : 'hover:bg-bg-hover',
      )}
    >
      <div className="flex items-center gap-2">
        <HealthDot health={health} size="xs" />
        <span className={cn('flex-1 text-xs font-mono font-medium truncate', selected ? 'text-accent-cyan' : 'text-text-primary')}>
          {stream.config.name}
        </span>
        <Badge
          variant={stream.config.storage === 'memory' ? 'purple' : 'default'}
          size="xs"
        >
          {stream.config.storage === 'memory' ? 'MEM' : 'FILE'}
        </Badge>
      </div>

      <div className="flex items-center gap-3 ml-4 text-2xs font-mono text-text-muted">
        <span>{formatNumber(stream.state.messages)} msgs</span>
        <span>{formatBytes(stream.state.bytes)}</span>
        <span>{stream.config.replicas}R</span>
      </div>
    </button>
  )
}

// ── Stream detail ─────────────────────────────────────────────────────────────

function StreamDetail({ stream, clusterId }: { stream: StreamInfo; clusterId: string }) {
  const { data: consumers } = useQuery({
    queryKey: ['consumers', clusterId, stream.config.name],
    queryFn: () => api.consumers.list(clusterId, stream.config.name),
    refetchInterval: 5000,
  })

  const setView = useUIStore(s => s.setView)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-mono font-bold text-text-primary">
              {stream.config.name}
            </h1>
            <HealthDot health={stream.health ?? 'ok'} size="md" />
            <Badge variant={stream.health === 'ok' ? 'green' : 'yellow'}>
              {(stream.health ?? 'ok').toUpperCase()}
            </Badge>
          </div>
          {stream.config.description && (
            <p className="text-sm font-mono text-text-muted">{stream.config.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setView('tail')}
          >
            Tail Messages
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setView('replay')}>
            Replay
          </Button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Messages"
          value={formatNumber(stream.state.messages)}
          sub={`seq ${stream.state.firstSeq} → ${stream.state.lastSeq}`}
          color="cyan"
        />
        <StatCard
          label="Storage"
          value={formatBytes(stream.state.bytes)}
          sub={stream.config.storage}
          color="purple"
        />
        <StatCard
          label="Subjects"
          value={String(stream.state.numSubjects)}
          sub={stream.config.subjects.slice(0, 2).join(', ')}
        />
        <StatCard
          label="Replicas"
          value={String(stream.config.replicas)}
          sub={`retention: ${stream.config.retention}`}
          color={stream.config.replicas >= 3 ? 'green' : 'yellow'}
        />
      </div>

      {/* Configuration */}
      <Section title="Configuration">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono">
          <ConfigRow label="Retention"  value={stream.config.retention} />
          <ConfigRow label="Storage"    value={stream.config.storage} />
          <ConfigRow label="Replicas"   value={String(stream.config.replicas)} />
          <ConfigRow label="Max Age"    value={stream.config.maxAge ? formatDuration(stream.config.maxAge / 1e6) : '∞'} />
          <ConfigRow label="Max Bytes"  value={stream.config.maxBytes ? formatBytes(stream.config.maxBytes) : '∞'} />
          <ConfigRow label="Max Msgs"   value={stream.config.maxMsgs ? formatNumber(stream.config.maxMsgs) : '∞'} />
          <ConfigRow label="Created"    value={formatTimeAgo(stream.created)} />
          <ConfigRow label="Last Msg"   value={formatTimeAgo(stream.state.lastTime)} />
        </div>
      </Section>

      {/* Subjects */}
      <Section title="Subjects" count={stream.config.subjects.length}>
        <div className="flex flex-wrap gap-2">
          {stream.config.subjects.map(s => (
            <code
              key={s}
              className="px-2 py-0.5 bg-bg-surface border border-bg-border rounded text-xs font-mono text-accent-cyan"
            >
              {s}
            </code>
          ))}
        </div>
      </Section>

      {/* Consumers */}
      <Section title="Consumers" count={consumers?.length}>
        {!consumers || consumers.length === 0 ? (
          <p className="text-xs font-mono text-text-muted italic">No consumers</p>
        ) : (
          <div className="space-y-1">
            {consumers.map(c => (
              <div
                key={c.name}
                className="flex items-center gap-4 px-3 py-2 bg-bg-surface border border-bg-border rounded hover:bg-bg-hover cursor-pointer transition-colors"
              >
                <HealthDot health={c.health} size="xs" />
                <span className="flex-1 text-xs font-mono text-text-primary">{c.name}</span>
                <span className="text-2xs font-mono text-text-muted">lag: {formatNumber(c.lag)}</span>
                <span className="text-2xs font-mono text-text-muted">pending: {c.numAckPending}</span>
                <Badge
                  variant={c.health === 'ok' ? 'green' : c.health === 'lagging' ? 'yellow' : 'red'}
                  size="xs"
                >
                  {c.health}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Retention visualization */}
      <Section title="Storage Usage">
        <RetentionBar stream={stream} />
      </Section>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, count, children }: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest">{title}</h2>
        {count !== undefined && (
          <span className="text-2xs font-mono bg-bg-surface border border-bg-border px-1.5 rounded text-text-muted">
            {count}
          </span>
        )}
      </div>
      {children}
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

function RetentionBar({ stream }: { stream: StreamInfo }) {
  const maxBytes  = stream.config.maxBytes ?? 0
  const usedBytes = stream.state.bytes

  const pct = maxBytes > 0 ? Math.min((usedBytes / maxBytes) * 100, 100) : 0
  const color = pct > 90 ? 'bg-accent-red' : pct > 70 ? 'bg-accent-yellow' : 'bg-accent-green'

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-2xs font-mono text-text-muted">
        <span>{formatBytes(usedBytes)} used</span>
        <span>{maxBytes > 0 ? formatBytes(maxBytes) + ' limit' : 'No limit'}</span>
      </div>
      <div className="h-1.5 bg-bg-surface rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: maxBytes > 0 ? `${pct}%` : '100%' }}
        />
      </div>
      {maxBytes > 0 && (
        <p className="text-2xs font-mono text-text-muted">{pct.toFixed(1)}% capacity used</p>
      )}
    </div>
  )
}
