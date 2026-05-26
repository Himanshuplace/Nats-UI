import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Play, Square, Trash2, Filter,
  ChevronDown, ChevronRight, Clock, Radio, Layers,
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

  const streamKey  = `${clusterId}:${selectedStream}`
  const subjectKey = `subj:${clusterId}:${subjectPattern}`
  const activeKey  = mode === 'stream' ? streamKey : subjectKey

  const messages = useDataStore(s => s.tailMessages[activeKey] ?? [])
  const isActive = useDataStore(s => s.tailActive[activeKey] ?? false)

  const { data: streamList } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn:  () => api.streams.list(clusterId),
    enabled:  Boolean(clusterId),
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
  const streams = streamList ?? []

  const streamTail  = useTail(clusterId, selectedStream)
  const subjectTail = useTailSubject(clusterId, subjectPattern)
  const tail        = mode === 'stream' ? streamTail : subjectTail

  const parentRef = useRef<HTMLDivElement>(null)
  // Track previous scroll position to avoid calling scrollToIndex when the
  // list hasn't actually grown (saves layout work on every re-render).
  const lastScrolledLengthRef = useRef(0)

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

  // Auto-scroll: only call scrollToIndex when the list has actually grown
  // and auto-scroll is on. Using a ref to track last-scrolled length avoids
  // running this effect when only autoScroll/paused state changes.
  useEffect(() => {
    if (!autoScroll || paused) return
    const len = filtered.length
    if (len === 0 || len === lastScrolledLengthRef.current) return
    lastScrolledLengthRef.current = len
    virtualizer.scrollToIndex(len - 1, { behavior: 'auto' })
  }, [filtered.length, autoScroll, paused])

  const handleToggle = useCallback(() => {
    if (isActive) {
      tail.stop()
      setPaused(false)
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
    setPaused(false)
    lastScrolledLengthRef.current = 0
  }

  // Accumulate totalBytes incrementally: instead of O(N) reduce on every render,
  // track the running sum. When messages array is replaced (clear), reset to 0.
  const totalBytesRef = useRef(0)
  const prevMsgLenRef = useRef(0)
  if (messages.length < prevMsgLenRef.current) {
    // Array was cleared or replaced — recalculate from scratch
    totalBytesRef.current = messages.reduce((s, m) => s + m.payloadSize, 0)
  } else if (messages.length > prevMsgLenRef.current) {
    // Messages were appended — only sum the new slice
    for (let i = prevMsgLenRef.current; i < messages.length; i++) {
      totalBytesRef.current += messages[i].payloadSize
    }
  }
  prevMsgLenRef.current = messages.length
  const totalBytes = totalBytesRef.current

  const canStart = mode === 'stream' ? Boolean(selectedStream) : Boolean(subjectPattern.trim())

  return (
    <div className="flex flex-col h-full bg-bg-base">

      {/* ── Mode tabs ──────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-bg-border bg-bg-elevated flex-shrink-0">
        {([['stream', 'Stream Tail', Layers], ['subject', 'Subject Tail', Radio]] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors',
              mode === m
                ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/5'
                : 'border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-hover',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Controls toolbar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bg-border bg-bg-elevated flex-shrink-0 flex-wrap">

        {/* Stream / Subject selector */}
        {mode === 'stream' ? (
          <select
            value={selectedStream}
            onChange={e => { if (isActive) streamTail.stop(); setSelectedStream(e.target.value) }}
            className="bg-bg-surface border border-bg-border text-text-secondary text-xs font-mono rounded px-2 py-1.5 outline-none focus:border-accent-cyan/50 min-w-[160px]"
          >
            <option value="">— select stream —</option>
            {streams.map(s => (
              <option key={s.config.name} value={s.config.name}>{s.config.name}</option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-1.5 bg-bg-surface border border-bg-border rounded px-2 py-1.5 focus-within:border-accent-cyan/50 transition-colors">
            <Radio className="w-3 h-3 text-text-muted flex-shrink-0" />
            <input
              type="text"
              value={subjectPattern}
              onChange={e => { if (isActive) subjectTail.stop(); setSubjectPattern(e.target.value) }}
              placeholder="orders.*  or  logs.>  or  >"
              className="bg-transparent text-xs font-mono text-text-primary placeholder-text-muted outline-none w-44"
              onKeyDown={e => { if (e.key === 'Enter' && !isActive && canStart) tail.start() }}
            />
          </div>
        )}

        {/* Start / Stop */}
        <Button
          variant={isActive ? 'danger' : 'primary'}
          size="xs"
          onClick={handleToggle}
          disabled={!canStart && !isActive}
        >
          {isActive
            ? <><Square className="w-3 h-3" /> Stop</>
            : <><Play className="w-3 h-3" /> Tail</>}
        </Button>

        {/* Pause (only when active) */}
        {isActive && (
          <Button variant="ghost" size="xs" onClick={() => setPaused(p => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        )}

        {/* Clear */}
        <Button variant="ghost" size="xs" onClick={() => { tail.clear(); setExpandedId(null) }}>
          <Trash2 className="w-3 h-3" />
        </Button>

        {/* Separator */}
        <div className="h-4 w-px bg-bg-border mx-1" />

        {/* Filter */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px] bg-bg-surface border border-bg-border rounded px-2 py-1.5 focus-within:border-accent-cyan/50 transition-colors">
          <Filter className="w-3 h-3 text-text-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Filter by subject, payload, header…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="flex-1 bg-transparent text-xs font-mono text-text-primary placeholder-text-muted outline-none min-w-0"
          />
          {filterText && (
            <button onClick={() => setFilterText('')} className="text-text-muted hover:text-text-primary text-xs">×</button>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-2xs font-mono text-text-muted flex-shrink-0">
          <span className="tabular-nums">{filtered.length.toLocaleString()} msgs</span>
          <span>{formatBytes(totalBytes)}</span>
        </div>

        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll(a => !a)}
          title="Auto-scroll to latest message"
          className={cn(
            'flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded border transition-colors',
            autoScroll
              ? 'border-accent-cyan/40 text-accent-cyan bg-accent-cyan/5'
              : 'border-bg-border text-text-muted hover:border-bg-border/80',
          )}
        >
          <ChevronDown className="w-3 h-3" />
          Auto
        </button>
      </div>

      {/* ── Column headers ─────────────────────────────────────────────────── */}
      <div className="flex items-center px-4 py-1 border-b border-bg-border bg-bg-elevated text-2xs font-mono text-text-muted uppercase tracking-wider flex-shrink-0 select-none">
        <span className="w-8" />
        <span className="w-32 flex-shrink-0">Timestamp</span>
        <span className="w-14 flex-shrink-0 text-center">Seq</span>
        <span className="flex-1">Subject</span>
        <span className="w-20 flex-shrink-0 text-right">Size</span>
        <span className="w-20 flex-shrink-0 text-right">Status</span>
      </div>

      {/* ── Message list ───────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <EmptyState
            icon={<Clock className="w-8 h-8" />}
            title={isActive ? 'Waiting for messages…' : 'No messages yet'}
            description={!isActive
              ? (mode === 'stream'
                ? (selectedStream ? 'Click Tail to start streaming live messages' : 'Select a stream first')
                : (subjectPattern ? 'Click Tail to subscribe to this subject pattern' : 'Enter a subject pattern  (e.g. orders.*  or  >)'))
              : undefined}
          />
          {isActive && !paused && (
            <div className="flex gap-1.5">
              {[0, 0.15, 0.3].map(d => (
                <span
                  key={d}
                  className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse"
                  style={{ animationDelay: `${d}s` }}
                />
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
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vrow.start}px)`,
                  }}
                >
                  <MessageRow
                    msg={msg}
                    expanded={expanded}
                    onToggle={() => setExpandedId(expanded ? null : (msg.id ?? null))}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-bg-border bg-bg-elevated text-2xs font-mono text-text-muted flex-shrink-0">
        {/* Live indicator */}
        <span className="flex items-center gap-1.5">
          <span className={cn(
            'w-1.5 h-1.5 rounded-full transition-colors',
            isActive && !paused ? 'bg-accent-green animate-pulse' : isActive ? 'bg-accent-yellow' : 'bg-text-muted',
          )} />
          <span className={cn(
            isActive && !paused ? 'text-accent-green' : isActive ? 'text-accent-yellow' : '',
          )}>
            {isActive ? (paused ? 'PAUSED' : 'LIVE') : 'STOPPED'}
          </span>
        </span>

        {mode === 'stream' && selectedStream && (
          <span>stream: <span className="text-accent-cyan">{selectedStream}</span></span>
        )}
        {mode === 'subject' && subjectPattern && (
          <span>pattern: <span className="text-accent-cyan">{subjectPattern}</span></span>
        )}
        {filterText && (
          <span>filter: <span className="text-accent-yellow">{filterText}</span></span>
        )}

        <span className="ml-auto tabular-nums">
          {messages.length.toLocaleString()} total
          {filterText && <> · {filtered.length.toLocaleString()} visible</>}
        </span>
      </div>
    </div>
  )
}

// ── Message Row ───────────────────────────────────────────────────────────────

function MessageRow({ msg, expanded, onToggle }: {
  msg: TailedMessage
  expanded: boolean
  onToggle: () => void
}) {
  const isJSON = Boolean(msg.payloadText && tryParseJSON(msg.payloadText).ok)

  return (
    <div className={cn(
      'border-b border-bg-border/50 cursor-pointer select-text',
      expanded ? 'bg-bg-surface' : 'hover:bg-bg-hover',
      msg.redelivered && 'border-l-2 border-l-accent-yellow',
    )}>
      <div className="flex items-center px-4 py-1.5" onClick={onToggle}>
        <span className="w-8 text-text-muted flex-shrink-0">
          {expanded
            ? <ChevronDown className="w-3 h-3 inline" />
            : <ChevronRight className="w-3 h-3 inline" />}
        </span>
        <span className="w-32 text-text-muted flex-shrink-0 truncate tabular-nums">
          {msg.timestamp ? formatTimestamp(msg.timestamp).slice(11, 23) : '—'}
        </span>
        <span className="w-14 text-text-muted flex-shrink-0 text-center tabular-nums">
          {msg.seq || '—'}
        </span>
        <span className="flex-1 text-accent-cyan truncate">{msg.subject}</span>
        <span className="w-20 text-text-muted text-right flex-shrink-0">{formatBytes(msg.payloadSize)}</span>
        <span className="w-20 text-right flex-shrink-0">
          {msg.redelivered
            ? <Badge variant="yellow" size="xs">REDELIV</Badge>
            : isJSON
            ? <Badge variant="ghost" size="xs">JSON</Badge>
            : null}
        </span>
      </div>
      {expanded && (
        <div className="px-10 pb-3">
          <PayloadViewer message={msg} />
        </div>
      )}
    </div>
  )
}
