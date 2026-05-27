import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, AlertTriangle, TrendingDown, Activity,
  Zap, Plus, Trash2, X, ChevronDown, ChevronRight,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import {
  Badge, Button, HealthDot, SectionHeader,
  StatCard, EmptyState, Spinner, cn,
} from '@/components/ui'
import { formatNumber, formatTimeAgo, formatDuration } from '@/lib/format'
import type { ConsumerInfo, ConsumerHealth, ConsumerConfig } from '@/types'

export function ConsumerInspector() {
  const [selectedStream,   setSelectedStream]   = useState('')
  const [selectedConsumer, setSelectedConsumer] = useState<string | null>(null)
  const [showCreate,       setShowCreate]       = useState(false)

  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId = activeClusters[0] ?? ''

  const queryClient = useQueryClient()

  const { data: streams } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
    refetchInterval: 10_000,
    enabled: activeClusters.length > 0 && Boolean(clusterId),
  })

  const { data: consumers, isLoading } = useQuery({
    queryKey: ['consumers', clusterId, selectedStream],
    queryFn: () => api.consumers.list(clusterId, selectedStream),
    refetchInterval: 3_000,
    enabled: Boolean(selectedStream),
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.consumers.delete(clusterId, selectedStream, name),
    onSuccess: (_, name) => {
      if (selectedConsumer === name) setSelectedConsumer(null)
      queryClient.invalidateQueries({ queryKey: ['consumers', clusterId, selectedStream] })
    },
  })

  const selected = consumers?.find(c => c.name === selectedConsumer)
  const slow   = consumers?.filter(c => c.health === 'slow' || c.health === 'lagging').length ?? 0
  const storms = consumers?.filter(c => c.health === 'redelivery_storm').length ?? 0
  const dead   = consumers?.filter(c => c.health === 'dead').length ?? 0

  return (
    <div className="flex h-full">
      {/* Left: list */}
      <div className="w-80 flex-shrink-0 border-r border-bg-border/50 flex flex-col glass">
        <div className="p-3 border-b border-bg-border">
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Stream</label>
          <select
            value={selectedStream}
            onChange={e => { setSelectedStream(e.target.value); setSelectedConsumer(null); setShowCreate(false) }}
            className="select-base"
          >
            <option value="">— select stream —</option>
            {streams?.map(s => <option key={s.config.name} value={s.config.name}>{s.config.name}</option>)}
          </select>
        </div>

        {consumers && consumers.length > 0 && (slow > 0 || storms > 0 || dead > 0) && (
          <div className="px-3 py-2 border-b border-bg-border flex flex-wrap gap-2">
            {slow   > 0 && <Badge variant="yellow" size="xs"><TrendingDown className="w-2.5 h-2.5 mr-1" />{slow} slow</Badge>}
            {storms > 0 && <Badge variant="red"    size="xs"><AlertTriangle className="w-2.5 h-2.5 mr-1" />{storms} storm</Badge>}
            {dead   > 0 && <Badge variant="red"    size="xs">{dead} dead</Badge>}
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
          <SectionHeader label="Consumers" count={consumers?.length} />
          {selectedStream && (
            <Button variant="ghost" size="xs" onClick={() => { setShowCreate(true); setSelectedConsumer(null) }}>
              <Plus className="w-3 h-3" /> New
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selectedStream && <EmptyState icon={<Users className="w-6 h-6" />} title="Select a stream" description="Choose a stream to inspect its consumers" />}
          {selectedStream && isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
          {consumers?.length === 0 && !isLoading && <EmptyState icon={<Users className="w-6 h-6" />} title="No consumers" description='Click "+ New" to create one' />}
          {consumers?.map(c => (
            <ConsumerListItem
              key={c.name}
              consumer={c}
              selected={selectedConsumer === c.name}
              onSelect={() => { setSelectedConsumer(c.name); setShowCreate(false) }}
              onDelete={() => { if (window.confirm(`Delete consumer "${c.name}"?`)) deleteMutation.mutate(c.name) }}
            />
          ))}
        </div>
      </div>

      {/* Right: detail / create */}
      <div className="flex-1 overflow-y-auto">
        {showCreate ? (
          <CreateConsumerForm
            clusterId={clusterId}
            stream={selectedStream}
            onClose={() => setShowCreate(false)}
            onCreated={name => {
              setShowCreate(false)
              setSelectedConsumer(name)
              queryClient.invalidateQueries({ queryKey: ['consumers', clusterId, selectedStream] })
            }}
          />
        ) : selected ? (
          <ConsumerDetail consumer={selected} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState icon={<Activity className="w-10 h-10" />} title="Select a consumer" description="Inspect ACK state, lag, redeliveries, and full config" />
          </div>
        )}
      </div>
    </div>
  )
}

// ── List item ─────────────────────────────────────────────────────────────────

function ConsumerListItem({ consumer, selected, onSelect, onDelete }: {
  consumer: ConsumerInfo; selected: boolean; onSelect: () => void; onDelete: () => void
}) {
  return (
    <div className={cn(
      'flex items-center border-b border-bg-border/50 transition-colors group',
      selected ? 'bg-accent-cyan/5 border-l-2 border-l-accent-cyan' : 'hover:bg-bg-hover',
    )}>
      <button onClick={onSelect} className="flex-1 flex flex-col gap-0.5 px-3 py-2.5 text-left min-w-0">
        <div className="flex items-center gap-2">
          <HealthDot health={consumer.health} size="xs" />
          <span className={cn('flex-1 text-xs font-mono font-medium truncate', selected ? 'text-accent-cyan' : 'text-text-primary')}>
            {consumer.name}
          </span>
          <LagBadge lag={consumer.lag} />
        </div>
        <div className="flex items-center gap-3 ml-4 text-2xs font-mono text-text-muted">
          <span className="text-text-muted/70">{consumer.config.ackPolicy}</span>
          {consumer.config.filterSubject && <span className="text-accent-cyan/70 truncate max-w-[100px]">{consumer.config.filterSubject}</span>}
          {consumer.numAckPending > 0    && <span className="text-accent-yellow">pending:{consumer.numAckPending}</span>}
          {consumer.numRedelivered > 0   && <span className="text-accent-red">redeliv:{consumer.numRedelivered}</span>}
        </div>
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="p-2 opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function LagBadge({ lag }: { lag: number }) {
  if (lag === 0)       return <Badge variant="green"   size="xs">0</Badge>
  if (lag < 1_000)     return <Badge variant="default" size="xs">{formatNumber(lag)}</Badge>
  if (lag < 100_000)   return <Badge variant="yellow"  size="xs">{formatNumber(lag)}</Badge>
  return                      <Badge variant="red"     size="xs">{formatNumber(lag)}</Badge>
}

// ── Consumer detail ───────────────────────────────────────────────────────────

function ConsumerDetail({ consumer }: { consumer: ConsumerInfo }) {
  const [showAllConfig, setShowAllConfig] = useState(false)
  const lagPct = consumer.numPending > 0
    ? Math.min((consumer.lag / consumer.numPending) * 100, 100) : 0

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
          <p className="text-xs font-mono text-text-muted">
            stream: <span className="text-text-secondary">{consumer.stream}</span>
            {consumer.config.durableName && <> · durable: <span className="text-accent-cyan">{consumer.config.durableName}</span></>}
          </p>
        </div>
        <span className="text-xs font-mono text-text-muted">{formatTimeAgo(consumer.created)}</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Lag"         value={formatNumber(consumer.lag)}            color={consumer.lag > 10000 ? 'red' : consumer.lag > 0 ? 'yellow' : 'green'} />
        <StatCard label="ACK Pending" value={String(consumer.numAckPending)}        color={consumer.numAckPending > 0 ? 'yellow' : 'green'} />
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
            className={cn('h-full rounded-full transition-all', lagPct > 80 ? 'bg-accent-red' : lagPct > 40 ? 'bg-accent-yellow' : 'bg-accent-green')}
            style={{ width: `${lagPct}%` }}
          />
        </div>
      </div>

      {/* Sequences */}
      <div className="grid grid-cols-2 gap-6">
        <SequenceBlock label="Delivered" consumerSeq={consumer.delivered.consumerSeq} streamSeq={consumer.delivered.streamSeq} />
        <SequenceBlock label="ACK Floor" consumerSeq={consumer.ackFloor.consumerSeq}  streamSeq={consumer.ackFloor.streamSeq}  dim />
      </div>

      {/* Config */}
      <div>
        <button
          onClick={() => setShowAllConfig(s => !s)}
          className="flex items-center gap-2 w-full text-xs font-mono font-semibold text-text-muted uppercase tracking-widest mb-3 hover:text-text-secondary transition-colors"
        >
          {showAllConfig ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Configuration {showAllConfig ? '' : '— click to expand'}
        </button>

        <div className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-xs font-mono">
          {/* Always shown */}
          <ConfigRow label="Deliver Policy"  value={consumer.config.deliverPolicy} />
          <ConfigRow label="ACK Policy"      value={consumer.config.ackPolicy} />
          <ConfigRow label="Replay Policy"   value={consumer.config.replayPolicy} />
          <ConfigRow label="Filter Subject"  value={consumer.config.filterSubject || '(all subjects)'} highlight={Boolean(consumer.config.filterSubject)} />
          <ConfigRow label="Max Deliver"     value={consumer.config.maxDeliver === -1 || !consumer.config.maxDeliver ? '∞ unlimited' : String(consumer.config.maxDeliver)} />
          <ConfigRow label="ACK Wait"        value={consumer.config.ackWait ? formatDuration(consumer.config.ackWait / 1e6) : '30s (default)'} />
          <ConfigRow label="Max ACK Pending" value={consumer.config.maxAckPending ? String(consumer.config.maxAckPending) : 'server default'} />

          {/* Expanded */}
          {showAllConfig && <>
            {consumer.config.durableName    && <ConfigRow label="Durable Name"    value={consumer.config.durableName} />}
            {consumer.config.deliverGroup   && <ConfigRow label="Queue Group"     value={consumer.config.deliverGroup} />}
            {consumer.config.deliverSubject && <ConfigRow label="Deliver Subject" value={consumer.config.deliverSubject} />}
            {consumer.config.optStartSeq    && <ConfigRow label="Opt Start Seq"   value={String(consumer.config.optStartSeq)} />}
            {consumer.config.optStartTime   && <ConfigRow label="Opt Start Time"  value={new Date(consumer.config.optStartTime).toISOString()} />}
            {consumer.config.description    && <ConfigRow label="Description"     value={consumer.config.description} />}
            <ConfigRow label="Name (internal)" value={consumer.config.name || consumer.name} />
          </>}
        </div>
      </div>

      {/* Storm warning */}
      {consumer.health === 'redelivery_storm' && (
        <div className="flex items-start gap-3 p-3 bg-accent-red/5 border border-accent-red/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-accent-red flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-mono font-semibold text-accent-red">Redelivery Storm Detected</p>
            <p className="text-xs font-mono text-text-secondary mt-0.5">
              {consumer.numRedelivered.toLocaleString()} messages redelivered repeatedly.
              Check consumer for processing errors or ACK timeouts.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateConsumerForm({ clusterId, stream, onClose, onCreated }: {
  clusterId: string; stream: string; onClose: () => void; onCreated: (name: string) => void
}) {
  const [form, setForm]     = useState<Record<string, any>>({ deliverPolicy: 'all', ackPolicy: 'explicit', replayPolicy: 'instant', maxDeliver: -1 })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const handleCreate = async () => {
    setError('')
    if (!form.durableName && !form.name) { setError('Durable Name is required'); return }
    setLoading(true)
    try {
      const cfg = { ...form }
      // Convert ackWait from seconds (UI) to nanoseconds (NATS)
      if (cfg.ackWait) cfg.ackWait = parseFloat(cfg.ackWait) * 1_000_000_000
      if (cfg.maxDeliver) cfg.maxDeliver = parseInt(cfg.maxDeliver)
      if (cfg.maxAckPending) cfg.maxAckPending = parseInt(cfg.maxAckPending)
      if (cfg.optStartSeq)   cfg.optStartSeq   = parseInt(cfg.optStartSeq)
      const ci = await api.consumers.create(clusterId, stream, cfg)
      onCreated((ci as ConsumerInfo).name)
    } catch (err: any) {
      setError(err.message ?? 'Failed to create consumer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-mono font-bold text-text-primary">New Consumer</h2>
          <p className="text-xs font-mono text-text-muted mt-0.5">
            stream: <span className="text-accent-cyan">{stream}</span>
          </p>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <CField label="Durable Name" hint="Empty = ephemeral">
          <input type="text" value={form.durableName ?? ''} onChange={e => set('durableName', e.target.value)} placeholder="my-consumer" className={iCls} />
        </CField>
        <CField label="Description">
          <input type="text" value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="optional" className={iCls} />
        </CField>

        <CField label="Deliver Policy">
          <select value={form.deliverPolicy} onChange={e => set('deliverPolicy', e.target.value)} className={iCls}>
            <option value="all">All — from first stored message</option>
            <option value="last">Last — most recent only</option>
            <option value="new">New — only future messages</option>
            <option value="by_start_sequence">By Sequence</option>
            <option value="by_start_time">By Time</option>
          </select>
        </CField>

        {form.deliverPolicy === 'by_start_sequence' && (
          <CField label="Start Sequence">
            <input type="number" min={1} value={form.optStartSeq ?? ''} onChange={e => set('optStartSeq', e.target.value)} placeholder="1" className={iCls} />
          </CField>
        )}

        <CField label="ACK Policy">
          <select value={form.ackPolicy} onChange={e => set('ackPolicy', e.target.value)} className={iCls}>
            <option value="explicit">Explicit — each message acknowledged</option>
            <option value="none">None — fire &amp; forget</option>
            <option value="all">All — cumulative ACK</option>
          </select>
        </CField>

        <CField label="Replay Policy">
          <select value={form.replayPolicy} onChange={e => set('replayPolicy', e.target.value)} className={iCls}>
            <option value="instant">Instant — as fast as possible</option>
            <option value="original">Original — at original publish rate</option>
          </select>
        </CField>

        <CField label="ACK Wait (seconds)" hint="How long server waits before redelivering">
          <input type="number" min={1} value={form.ackWait ?? ''} onChange={e => set('ackWait', e.target.value)} placeholder="30" className={iCls} />
        </CField>

        <CField label="Max Deliver" hint="-1 = unlimited redeliveries">
          <input type="number" value={form.maxDeliver ?? -1} onChange={e => set('maxDeliver', e.target.value)} className={iCls} />
        </CField>

        <CField label="Max ACK Pending" hint="0 = server default (1000)">
          <input type="number" min={0} value={form.maxAckPending ?? ''} onChange={e => set('maxAckPending', e.target.value)} placeholder="1000" className={iCls} />
        </CField>

        <CField label="Filter Subject" hint="Leave empty to consume all stream subjects">
          <input type="text" value={form.filterSubject ?? ''} onChange={e => set('filterSubject', e.target.value)} placeholder="orders.>" className={iCls} />
        </CField>

        <CField label="Queue Group" hint="For load-balanced pull consumers">
          <input type="text" value={form.deliverGroup ?? ''} onChange={e => set('deliverGroup', e.target.value)} placeholder="worker-pool" className={iCls} />
        </CField>
      </div>

      {error && <p className="text-xs font-mono text-accent-red bg-accent-red/5 border border-accent-red/20 rounded px-3 py-2">{error}</p>}

      <div className="flex gap-3">
        <Button variant="primary" size="sm" onClick={handleCreate} disabled={loading}>
          {loading ? <><Zap className="w-3 h-3 animate-pulse" /> Creating…</> : <><Plus className="w-3 h-3" /> Create Consumer</>}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}

const iCls = 'input-base'

function CField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block">{label}</label>
      {children}
      {hint && <p className="text-2xs font-mono text-text-muted/60">{hint}</p>}
    </div>
  )
}

function HealthBadge({ health }: { health: ConsumerHealth }) {
  const v: Record<ConsumerHealth, 'green' | 'yellow' | 'red' | 'default'> = { ok: 'green', slow: 'yellow', lagging: 'yellow', redelivery_storm: 'red', stuck: 'red', dead: 'red' }
  return <Badge variant={v[health] ?? 'default'}>{health.toUpperCase().replace('_', ' ')}</Badge>
}

function SequenceBlock({ label, consumerSeq, streamSeq, dim }: { label: string; consumerSeq: number; streamSeq: number; dim?: boolean }) {
  return (
    <div className={cn('p-3 rounded-xl glass', dim ? 'opacity-60' : '')}>
      <p className="text-2xs font-mono text-text-muted uppercase tracking-wide mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between text-xs font-mono"><span className="text-text-muted">consumer seq</span><span className="text-text-secondary">{formatNumber(consumerSeq)}</span></div>
        <div className="flex justify-between text-xs font-mono"><span className="text-text-muted">stream seq</span><span className="text-text-secondary">{formatNumber(streamSeq)}</span></div>
      </div>
    </div>
  )
}

function ConfigRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className={highlight ? 'text-accent-cyan' : 'text-text-secondary'}>{value}</span>
    </>
  )
}
