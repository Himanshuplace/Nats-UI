import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layers, Database, Clock, Hash, HardDrive,
  Trash2, Pencil, Plus, X, ChevronRight, AlertTriangle,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import {
  Badge, Button, HealthDot, SectionHeader, StatCard,
  EmptyState, Spinner, Stepper, cn,
} from '@/components/ui'
import {
  formatBytes, formatNumber, formatTimeAgo, formatDuration, healthColor,
} from '@/lib/format'
import type { StreamInfo } from '@/types'

// ── Stream Explorer root ──────────────────────────────────────────────────────

export function StreamExplorer() {
  const [selectedStream, setSelectedStream] = useState<string | null>(null)
  const [filter, setFilter]             = useState('')
  const [showCreate, setShowCreate]     = useState(false)
  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId      = activeClusters[0] ?? ''
  const queryClient    = useQueryClient()

  const { data: streams, isLoading, error } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn:  () => api.streams.list(clusterId),
    refetchInterval: 5_000,
    enabled: activeClusters.length > 0 && Boolean(clusterId),
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.streams.delete(clusterId, name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['streams', clusterId] })
      if (selectedStream === name) setSelectedStream(null)
    },
  })

  const filteredStreams = filter.trim()
    ? streams?.filter(s => s.config.name.toLowerCase().includes(filter.toLowerCase()))
    : streams

  const selected = streams?.find(s => s.config.name === selectedStream)

  if (activeClusters.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="glass rounded-xl p-8 shadow-glass text-center space-y-2">
          <Database className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm font-mono text-text-secondary">No cluster connected</p>
          <p className="text-xs font-mono text-text-muted">Go to Settings to connect to a NATS server first</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left: stream list */}
      <div className="w-72 flex-shrink-0 border-r border-bg-border/50 flex flex-col glass">
        <SectionHeader
          label="Streams"
          count={streams?.length}
          action={
            <Button variant="ghost" size="xs" onClick={() => setShowCreate(true)}>
              <Plus className="w-3 h-3" />
              New
            </Button>
          }
        />

        {/* Search */}
        <div className="px-3 pb-2">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter streams..."
            className="input-base"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex justify-center py-8"><Spinner /></div>
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
          {filteredStreams?.map(stream => (
            <StreamListItem
              key={stream.config.name}
              stream={stream}
              selected={selectedStream === stream.config.name}
              onSelect={() => setSelectedStream(stream.config.name)}
              onDelete={() => {
                if (confirm(`Delete stream "${stream.config.name}"? This is irreversible.`)) {
                  deleteMutation.mutate(stream.config.name)
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* Right: stream detail / create form */}
      <div className="flex-1 overflow-y-auto">
        {showCreate ? (
          <CreateStreamForm
            clusterId={clusterId}
            onClose={() => setShowCreate(false)}
            onCreate={(name) => {
              setShowCreate(false)
              setSelectedStream(name)
            }}
          />
        ) : selected ? (
          <StreamDetail
            stream={selected}
            clusterId={clusterId}
            onDeleted={() => setSelectedStream(null)}
          />
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
  stream, selected, onSelect, onDelete,
}: {
  stream: StreamInfo
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const health = stream.health ?? 'ok'
  return (
    <div
      className={cn(
        'group relative w-full flex flex-col gap-0.5 px-3 py-2.5 border-b border-bg-border/50 text-left transition-colors cursor-pointer',
        selected ? 'bg-accent-primary/5 border-l-2 border-l-accent-primary' : 'hover:bg-bg-hover',
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <HealthDot health={health} size="xs" />
        <span className={cn(
          'flex-1 text-xs font-mono font-medium truncate',
          selected ? 'text-accent-primary' : 'text-text-primary',
        )}>
          {stream.config.name}
        </span>
        <Badge
          variant={(stream.config.storage ?? '') === 'memory' ? 'purple' : 'default'}
          size="xs"
        >
          {(stream.config.storage ?? '') === 'memory' ? 'MEM' : 'FILE'}
        </Badge>
        {/* Delete button — appears on hover */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-muted hover:text-accent-red transition-opacity"
          title="Delete stream"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-3 ml-4 text-2xs font-mono text-text-muted">
        <span>{formatNumber(stream.state.messages)} msgs</span>
        <span>{formatBytes(stream.state.bytes)}</span>
        <span>{stream.config.replicas}R</span>
      </div>
    </div>
  )
}

// ── Stream detail ─────────────────────────────────────────────────────────────

function StreamDetail({
  stream, clusterId, onDeleted,
}: {
  stream: StreamInfo
  clusterId: string
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()

  const { data: consumers } = useQuery({
    queryKey: ['consumers', clusterId, stream.config.name],
    queryFn:  () => api.consumers.list(clusterId, stream.config.name),
    refetchInterval: 5_000,
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.streams.delete(clusterId, stream.config.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', clusterId] })
      onDeleted()
    },
  })

  const setView        = useUIStore(s => s.setView)
  const setActiveStream = useUIStore(s => s.setActiveStream)

  if (editing) {
    return (
      <EditStreamForm
        clusterId={clusterId}
        stream={stream}
        onClose={() => setEditing(false)}
      />
    )
  }

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
            onClick={() => { setActiveStream(stream.config.name); setView('tail') }}
          >
            Tail Messages
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { setActiveStream(stream.config.name); setView('browser') }}>
            Browse
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setView('replay')}>
            Replay
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} title="Edit stream">
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(`Delete stream "${stream.config.name}"? This is irreversible.`)) {
                deleteMutation.mutate()
              }
            }}
            disabled={deleteMutation.isPending}
            className="text-accent-red hover:bg-accent-red/10"
            title="Delete stream"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {deleteMutation.isError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-xs font-mono text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {(deleteMutation.error as Error)?.message}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Messages" value={formatNumber(stream.state.messages)} sub={`seq ${stream.state.firstSeq} → ${stream.state.lastSeq}`} color="cyan" />
        <StatCard label="Storage"  value={formatBytes(stream.state.bytes)} sub={stream.config.storage ?? 'file'} color="purple" />
        <StatCard label="Subjects" value={String(stream.state.numSubjects)} sub={stream.config.subjects.slice(0, 2).join(', ')} />
        <StatCard label="Replicas" value={String(stream.config.replicas)} sub={`retention: ${stream.config.retention ?? 'limits'}`} color={stream.config.replicas >= 3 ? 'green' : 'yellow'} />
      </div>

      {/* Configuration */}
      <Section title="Configuration">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono">
          <ConfigRow label="Retention"  value={stream.config.retention ?? 'limits'} />
          <ConfigRow label="Storage"    value={stream.config.storage ?? 'file'} />
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
            <code key={s} className="px-2 py-0.5 bg-bg-surface border border-bg-border rounded text-xs font-mono text-accent-cyan">
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
                className="flex items-center gap-4 px-3 py-2 bg-bg-surface border border-bg-border rounded hover:bg-bg-hover transition-colors"
              >
                <HealthDot health={c.health} size="xs" />
                <span className="flex-1 text-xs font-mono text-text-primary">{c.name}</span>
                <span className="text-2xs font-mono text-text-muted">lag: {formatNumber(c.lag)}</span>
                <span className="text-2xs font-mono text-text-muted">pending: {c.numAckPending}</span>
                <Badge variant={c.health === 'ok' ? 'green' : c.health === 'lagging' ? 'yellow' : 'red'} size="xs">
                  {c.health}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Storage usage bar */}
      <Section title="Storage Usage">
        <RetentionBar stream={stream} />
      </Section>
    </div>
  )
}

// ── Create Stream Form ────────────────────────────────────────────────────────

function CreateStreamForm({
  clusterId, onClose, onCreate,
}: {
  clusterId: string
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: '', description: '', subjects: '',
    storage: 'file', retention: 'limits', replicas: '1',
    maxAge: '', maxBytes: '', maxMsgs: '',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.streams.create(clusterId, {
      name:        form.name.trim(),
      description: form.description.trim() || undefined,
      subjects:    form.subjects.split(',').map(s => s.trim()).filter(Boolean),
      storage:     form.storage as 'file' | 'memory',
      retention:   form.retention as 'limits' | 'interest' | 'workqueue',
      replicas:    parseInt(form.replicas, 10) || 1,
      maxAge:      form.maxAge ? Number(form.maxAge) * 1e9 : undefined,      // seconds → ns
      maxBytes:    form.maxBytes ? Number(form.maxBytes) * 1024 * 1024 : undefined,  // MB → bytes
      maxMsgs:     form.maxMsgs ? Number(form.maxMsgs) : undefined,
    } as any),
    onSuccess: (si) => {
      queryClient.invalidateQueries({ queryKey: ['streams', clusterId] })
      onCreate(si.config.name)
    },
    onError: (err) => setError((err as Error).message),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-mono font-bold text-text-primary">Create Stream</h1>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-xs font-mono text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Name + Description */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FormLabel required>Stream Name</FormLabel>
            <input
              value={form.name}
              onChange={set('name')}
              placeholder="ORDERS"
              className={inputClass}
            />
          </div>
          <div>
            <FormLabel>Description</FormLabel>
            <input
              value={form.description}
              onChange={set('description')}
              placeholder="Optional description"
              className={inputClass}
            />
          </div>
        </div>

        {/* Subjects */}
        <div>
          <FormLabel>Subjects (comma-separated)</FormLabel>
          <input
            value={form.subjects}
            onChange={set('subjects')}
            placeholder="orders.*, orders.created, orders.>"
            className={inputClass}
          />
          <p className="text-2xs font-mono text-text-muted mt-1">Wildcards: <code>*</code> = one token, <code>{'>'}</code> = rest</p>
        </div>

        {/* Storage / Retention / Replicas */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <FormLabel>Storage</FormLabel>
            <select value={form.storage} onChange={set('storage')} className={selectClass}>
              <option value="file">File</option>
              <option value="memory">Memory</option>
            </select>
          </div>
          <div>
            <FormLabel>Retention</FormLabel>
            <select value={form.retention} onChange={set('retention')} className={selectClass}>
              <option value="limits">Limits</option>
              <option value="interest">Interest</option>
              <option value="workqueue">Work Queue</option>
            </select>
          </div>
          <div>
            <FormLabel>Replicas</FormLabel>
            <Stepper
              size="md"
              min={1}
              max={5}
              value={parseInt(form.replicas, 10) || 1}
              onChange={(n) => setForm(f => ({ ...f, replicas: String(n) }))}
              label="Replicas"
            />
          </div>
        </div>

        {/* Limits */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <FormLabel>Max Age (seconds)</FormLabel>
            <input
              type="number"
              min={0}
              value={form.maxAge}
              onChange={set('maxAge')}
              placeholder="∞"
              className={inputClass}
            />
          </div>
          <div>
            <FormLabel>Max Size (MB)</FormLabel>
            <input
              type="number"
              min={0}
              value={form.maxBytes}
              onChange={set('maxBytes')}
              placeholder="∞"
              className={inputClass}
            />
          </div>
          <div>
            <FormLabel>Max Messages</FormLabel>
            <input
              type="number"
              min={0}
              value={form.maxMsgs}
              onChange={set('maxMsgs')}
              placeholder="∞"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!form.name.trim() || mutation.isPending}
        >
          {mutation.isPending ? 'Creating…' : 'Create Stream'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Edit Stream Form ──────────────────────────────────────────────────────────

function EditStreamForm({
  clusterId, stream, onClose,
}: {
  clusterId: string
  stream: StreamInfo
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    description: stream.config.description ?? '',
    subjects:    stream.config.subjects.join(', '),
    replicas:    String(stream.config.replicas),
    maxAge:      stream.config.maxAge ? String(Math.round(stream.config.maxAge / 1e9)) : '',
    maxBytes:    stream.config.maxBytes ? String(Math.round(stream.config.maxBytes / 1024 / 1024)) : '',
    maxMsgs:     stream.config.maxMsgs ? String(stream.config.maxMsgs) : '',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.streams.update(clusterId, stream.config.name, {
      ...stream.config,
      description: form.description.trim() || undefined,
      subjects:    form.subjects.split(',').map(s => s.trim()).filter(Boolean),
      replicas:    parseInt(form.replicas, 10) || 1,
      maxAge:      form.maxAge ? Number(form.maxAge) * 1e9 : undefined,
      maxBytes:    form.maxBytes ? Number(form.maxBytes) * 1024 * 1024 : undefined,
      maxMsgs:     form.maxMsgs ? Number(form.maxMsgs) : undefined,
    } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', clusterId] })
      onClose()
    },
    onError: (err) => setError((err as Error).message),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-mono font-bold text-text-primary">Edit Stream</h1>
          <p className="text-sm font-mono text-text-muted">{stream.config.name}</p>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-xs font-mono text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <FormLabel>Description</FormLabel>
          <input value={form.description} onChange={set('description')} className={inputClass} />
        </div>
        <div>
          <FormLabel>Subjects (comma-separated)</FormLabel>
          <input value={form.subjects} onChange={set('subjects')} className={inputClass} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <FormLabel>Replicas</FormLabel>
            <Stepper
              size="md"
              min={1}
              max={5}
              value={parseInt(form.replicas, 10) || 1}
              onChange={(n) => setForm(f => ({ ...f, replicas: String(n) }))}
              label="Replicas"
            />
          </div>
          <div>
            <FormLabel>Max Age (seconds)</FormLabel>
            <input type="number" min={0} value={form.maxAge} onChange={set('maxAge')} placeholder="∞" className={inputClass} />
          </div>
          <div>
            <FormLabel>Max Size (MB)</FormLabel>
            <input type="number" min={0} value={form.maxBytes} onChange={set('maxBytes')} placeholder="∞" className={inputClass} />
          </div>
        </div>
        <div>
          <FormLabel>Max Messages</FormLabel>
          <input type="number" min={0} value={form.maxMsgs} onChange={set('maxMsgs')} placeholder="∞" className={inputClass} />
        </div>
      </div>

      <p className="text-2xs font-mono text-text-muted">
        Note: Retention and storage type cannot be changed after creation.
      </p>

      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
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
          <span className="text-2xs font-mono bg-bg-surface border border-bg-border px-1.5 rounded text-text-muted">{count}</span>
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
  const pct       = maxBytes > 0 ? Math.min((usedBytes / maxBytes) * 100, 100) : 0
  const color     = pct > 90 ? 'bg-accent-red' : pct > 70 ? 'bg-accent-yellow' : 'bg-accent-green'
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

function FormLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1">
      {children}{required && <span className="text-accent-red ml-1">*</span>}
    </label>
  )
}

const inputClass  = 'input-base'
const selectClass = 'select-base'
