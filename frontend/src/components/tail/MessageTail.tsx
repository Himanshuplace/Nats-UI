import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Play, Square, Trash2, Filter,
  ChevronDown, ChevronRight, Clock, Radio,
} from 'lucide-react'
import { useDataStore, useUIStore } from '@/store'
import { useTail, useTailSubject } from '@/hooks/useWebSocket'
import { api } from '@/lib/api'
import { cn, Button, Badge, EmptyState } from '@/components/ui'
import { PayloadViewer } from './PayloadViewer'
import { formatBytes, formatTimestamp, tryParseJSON } from '@/lib/format'
import type { TailedMessage } from '@/types'

type TailMode = 'stream' | 'subject'

interface MessageTailProps {
  clusterId?: string
  stream?: string
}

export function MessageTail({ clusterId: clusterIdProp = '', stream = '' }: MessageTailProps) {
  const activeClusters = useUIStore(s => s.activeClusters)
  const activeStream   = useUIStore(s => s.activeStream)

  const clusterId = clusterIdProp || activeClusters[0] || ''

  const [mode, setMode]                     = useState<TailMode>('stream')
  const [selectedStream, setSelectedStream] = useState(stream || activeStream || '')
  const [subjectPattern, setSubjectPattern] = useState('')
  const [filterText, setFilterText]         = useState('')
  const [expandedId, setExpandedId]         = useState<string | null>(null)
  const [autoScroll, setAutoScroll]         = useState(true)
  const [paused, setPaused]                 = useState(false)

  // Stream tail key: "{clusterId}:{stream}"
  const streamKey  = `${clusterId}:${selectedStream}`
  // Subject tail key: "subj:{clusterId}:{pattern}"
  const subjectKey = `subj:${clusterId}:${subjectPattern}`
  const activeKey  = mode === 'stream' ? streamKey : subjectKey

  const messages = useDataStore(s => s.tailMessages[activeKey] ?? [])
  const isActive = useDataStore(s => s.tailActive[activeKey] ?? false)

  const { data: streamList } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
    enabled: Boolean(clusterId),
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
  const streams = streamList ?? []

  const streamTail  = useTail(clusterId, selectedStream)
  const subjectTail = useTailSubject(clusterId, subjectPattern)
  const tail        = mode === 'stream' ? streamTail : subjectTail

  const parentRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!filterText.trim()) return messages
    const q = filterText.toLowerCase()
    return messages.filter(m =>
      m.subject.toLowerCase().includes(q) ||
      m.payloadText?.toLowerCase().includes(q) ||
      Object.values(m.headers ?? {}).some(v => v.toLowerCase().includes(q)),
    )
  }, [messages, filterText])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 20,
  })

  useEffect(() => {
    if (autoScroll && !paused && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { behavior: 'auto' })
    }
  }, [filtered.length, autoScroll, paused])

  const handleToggle = useCallback(() => {
    if (isActive) {
      tail.stop()
    } else {
      if (mode === 'stream' && !selectedStream) return
      if (mode === 'subject' && !subjectPattern.trim()) return
      tail.start()
    }
  }, [isActive, mode, selectedStream, subjectPattern, tail])

  const switchMode = (next: TailMode) => {
    if (isActive) tail.stop()
    setMode(next)
    setFilterText('')
  }

  const totalBytes = useMemo(
    () => messages.reduce((s, m) => s + m.payloadSize, 0),
    [messages],
  )

  const canStart = mode === 'stream' ? Boolean(selectedStream) : Boolean(subjectPattern.trim())

  return (
    <div className="flex flex-col h-full bg-bg-base">
      {/* Mode tabs */}
      <div className="flex items-center border-b border-bg-border bg-bg-elevated flex-shrink-0">
        {([['stream', 'Stream Tail'], ['subject', 'Subject Tail']] as const).map(([m, label]) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-medium border-b-2 transition-colors',
              mode === m
                ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/5'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {m === 'subject' && <Radio className="w-3 h-3" />}
            {label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-bg-border bg-bg-elevated flex-shrink-0">
        {mode === 'stream' ? (
          <select
            value={selectedStream}
            onChange={e => { if (isActive) streamTail.stop(); setSelectedStream(e.target.value) }}
            className="bg-bg-surface border border-bg-border text-text-secondary text-xs font-mono rounded px-2 py-1 outline-none focus:border-accent-cyan/50"
          >
            <option value="">— select stream —</option>
            {streams.map(s => (
              <option key={s.config.name} value={s.config.name}>{s.config.name}</option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-1.5 bg-bg-surface border border-bg-border rounded px-2 py-1">
            <Radio className="w-3 h-3 text-text-muted flex-shrink-0" />
            <input
              type="text"
              value={subjectPattern}
              onChange={e => { if (isActive) subjectTail.stop(); setSubjectPattern(e.target.value) }}
              placeholder="orders.*  or  logs.>  or  >"
              className="bg-transparent text-xs font-mono text-text-primary placeholder-text-muted outline-none w-52"
              onKeyDown={e => { if (e.key === 'Enter' && !isActive && canStart) tail.start() }}
            />
          </div>
        )}

        <Button variant={isActive ? 'danger' : 'primary'} size="xs" onClick={handleToggle} disabled={!canStart}>
          {isActive ? <><Square className="w-3 h-3" /> Stop</> : <><Play className="w-3 h-3" /> Tail</>}
        </Button>

        {isActive && (
          <Button variant="ghost" size="xs" onClick={() => setPaused(p => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        )}

        <Button variant="ghost" size="xs" onClick={tail.clear}><Trash2 className="w-3 h-3" /></Button>

        <div className="flex items-center gap-1.5 flex-1 bg-bg-surface border border-bg-border rounded px-2 py-1">
          <Filter className="w-3 h-3 text-text-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Filter by subject, payload, header…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="flex-1 bg-transparent text-xs font-mono text-text-primary placeholder-text-muted outline-none min-w-0"
          />
          {filterText && <button onClick={() => setFilterText('')} className="text-text-muted hover:text-text-primary">×</button>}
        </div>

        <div className="flex items-center gap-3 text-2xs font-mono text-text-muted flex-shrink-0">
          <span>{filtered.length.toLocaleString()} msgs</span>
          <span>{formatBytes(totalBytes)}</span>
        </div>

        <button
          onClick={() => setAutoScroll(a => !a)}
          className={cn(
            'flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded border transition-colors',
            autoScroll ? 'border-accent-cyan/30 text-accent-cyan bg-accent-cyan/5' : 'border-bg-border text-text-muted',
          )}
        >
          <ChevronDown className="w-3 h-3" />
          Auto
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-4 py-1 border-b border-bg-border bg-bg-elevated text-2xs font-mono text-text-muted flex-shrink-0 select-none">
        <span className="w-8" />
        <span className="w-28 flex-shrink-0">TIMESTAMP</span>
        <span className="w-14 flex-shrink-0 text-center">SEQ</span>
        <span className="flex-1">SUBJECT</span>
        <span className="w-20 flex-shrink-0 text-right">SIZE</span>
        <span className="w-16 flex-shrink-0 text-right">STATUS</span>
      </div>

      {/* Message list */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <EmptyState
            icon={<Clock className="w-8 h-8" />}
            title={isActive ? 'Waiting for messages…' : 'No messages yet'}
            description={!isActive ? (
              mode === 'stream'
                ? (selectedStream ? 'Press Tail to start streaming' : 'Select a stream first')
                : (subjectPattern ? 'Press Tail to subscribe' : 'Enter a subject pattern  (e.g.  orders.*  or  >)')
            ) : undefined}
          />
          {isActive && (
            <div className="flex gap-1 mt-4">
              {[0.1, 0.2, 0.3].map(d => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto font-mono text-xs">
          <div style={{ height: virtualizer.getTotalSize() + 'px', width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map(vrow => {
              const msg = filtered[vrow.index]
              const expanded = expandedId === (msg.id ?? null)
              return (
                <div
                  key={vrow.key}
                  data-index={vrow.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vrow.start}px)` }}
                >
                  <MessageRow msg={msg} expanded={expanded} onToggle={() => setExpandedId(expanded ? null : (msg.id ?? null))} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1 border-t border-bg-border bg-bg-elevated text-2xs font-mono text-text-muted flex-shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-accent-green animate-pulse' : 'bg-text-muted')} />
          {isActive ? (paused ? 'PAUSED' : 'LIVE') : 'STOPPED'}
        </span>
        {mode === 'stream' && selectedStream && <span>stream: <span className="text-accent-cyan">{selectedStream}</span></span>}
        {mode === 'subject' && subjectPattern && <span>pattern: <span className="text-accent-cyan">{subjectPattern}</span></span>}
        {filterText && <span className="text-accent-yellow">filter: {filterText}</span>}
        <span className="ml-auto">{messages.length.toLocaleString()} total | {filtered.length.toLocaleString()} visible</span>
      </div>
    </div>
  )
}

// ── Message Row ───────────────────────────────────────────────────────────────

function MessageRow({ msg, expanded, onToggle }: { msg: TailedMessage; expanded: boolean; onToggle: () => void }) {
  const isJSON = Boolean(msg.payloadText && tryParseJSON(msg.payloadText).ok)
  return (
    <div className={cn(
      'border-b border-bg-border/50 cursor-pointer select-text',
      expanded ? 'bg-bg-surface' : 'hover:bg-bg-hover',
      msg.redelivered && 'border-l-2 border-l-accent-yellow',
    )}>
      <div className="flex items-center px-4 py-1.5" onClick={onToggle}>
        <span className="w-8 text-text-muted flex-shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />}
        </span>
        <span className="w-28 text-text-muted flex-shrink-0 truncate">
          {msg.timestamp ? formatTimestamp(msg.timestamp).slice(11, 23) : '—'}
        </span>
        <span className="w-14 text-text-muted flex-shrink-0 text-center tabular-nums">{msg.seq || '—'}</span>
        <span className="flex-1 text-accent-cyan truncate">{msg.subject}</span>
        <span className="w-20 text-text-muted text-right flex-shrink-0">{formatBytes(msg.payloadSize)}</span>
        <span className="w-16 text-right flex-shrink-0">
          {msg.redelivered ? <Badge variant="yellow" size="xs">REDELIV</Badge>
            : isJSON ? <Badge variant="ghost" size="xs">JSON</Badge>
            : null}
        </span>
      </div>
      {expanded && <div className="px-10 pb-3"><PayloadViewer message={msg} /></div>}
    </div>
  )
}
