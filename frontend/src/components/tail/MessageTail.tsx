import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Play, Square, Trash2, Filter, Download,
  ChevronDown, ChevronRight, Clock,
} from 'lucide-react'
import { useDataStore, useUIStore } from '@/store'
import { useTail } from '@/hooks/useWebSocket'
import { cn, Button, Badge, StatCard, EmptyState } from '@/components/ui'
import { PayloadViewer } from './PayloadViewer'
import { formatBytes, formatTimestamp, formatTimeAgo, healthColor, tryParseJSON } from '@/lib/format'
import type { TailedMessage } from '@/types'

interface MessageTailProps {
  clusterId?: string
  stream?: string
}

export function MessageTail({ clusterId = 'default', stream = '' }: MessageTailProps) {
  const [selectedStream, setSelectedStream] = useState(stream)
  const [filterText, setFilterText] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [paused, setPaused] = useState(false)

  const key      = selectedStream
  const messages = useDataStore(s => s.tailMessages[key] ?? [])
  const isActive = useDataStore(s => s.tailActive[key] ?? false)
  const streams  = useDataStore(s => s.streams[clusterId] ?? [])

  const { start, stop, clear } = useTail(clusterId, selectedStream)
  const parentRef = useRef<HTMLDivElement>(null)

  // Filter messages
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (autoScroll && !paused && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { behavior: 'auto' })
    }
  }, [filtered.length, autoScroll, paused])

  const handleToggle = useCallback(() => {
    if (isActive) {
      stop()
    } else {
      if (!selectedStream) return
      start()
    }
  }, [isActive, selectedStream, start, stop])

  const totalBytes = useMemo(
    () => messages.reduce((s, m) => s + m.payloadSize, 0),
    [messages],
  )

  return (
    <div className="flex flex-col h-full bg-bg-base">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-bg-border bg-bg-elevated flex-shrink-0">
        {/* Stream selector */}
        <select
          value={selectedStream}
          onChange={e => setSelectedStream(e.target.value)}
          className="bg-bg-surface border border-bg-border text-text-secondary text-xs font-mono rounded px-2 py-1 outline-none focus:border-accent-cyan/50"
        >
          <option value="">— select stream —</option>
          {streams.map(s => (
            <option key={s.config.name} value={s.config.name}>
              {s.config.name}
            </option>
          ))}
        </select>

        {/* Controls */}
        <Button
          variant={isActive ? 'danger' : 'primary'}
          size="xs"
          onClick={handleToggle}
          disabled={!selectedStream}
        >
          {isActive ? (
            <><Square className="w-3 h-3" /> Stop</>
          ) : (
            <><Play className="w-3 h-3" /> Tail</>
          )}
        </Button>

        {isActive && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setPaused(p => !p)}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
        )}

        <Button variant="ghost" size="xs" onClick={clear}>
          <Trash2 className="w-3 h-3" />
        </Button>

        {/* Filter */}
        <div className="flex items-center gap-1.5 flex-1 bg-bg-surface border border-bg-border rounded px-2 py-1">
          <Filter className="w-3 h-3 text-text-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Filter by subject, payload, header..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="flex-1 bg-transparent text-xs font-mono text-text-primary placeholder-text-muted outline-none min-w-0"
          />
          {filterText && (
            <button onClick={() => setFilterText('')} className="text-text-muted hover:text-text-primary">
              ×
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-2xs font-mono text-text-muted flex-shrink-0">
          <span>{filtered.length.toLocaleString()} msgs</span>
          <span>{formatBytes(totalBytes)}</span>
        </div>

        {/* Auto-scroll */}
        <button
          onClick={() => setAutoScroll(a => !a)}
          className={cn(
            'flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded border transition-colors',
            autoScroll
              ? 'border-accent-cyan/30 text-accent-cyan bg-accent-cyan/5'
              : 'border-bg-border text-text-muted',
          )}
        >
          <ChevronDown className="w-3 h-3" />
          Auto-scroll
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-0 px-4 py-1 border-b border-bg-border bg-bg-elevated text-2xs font-mono text-text-muted flex-shrink-0 select-none">
        <span className="w-8" />
        <span className="w-28 flex-shrink-0">TIMESTAMP</span>
        <span className="w-8 flex-shrink-0 text-center">SEQ</span>
        <span className="flex-1">SUBJECT</span>
        <span className="w-20 flex-shrink-0 text-right">SIZE</span>
        <span className="w-16 flex-shrink-0 text-right">STATUS</span>
      </div>

      {/* Message list */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <EmptyState
            icon={<Clock className="w-8 h-8" />}
            title={isActive ? 'Waiting for messages...' : 'No messages yet'}
            description={!isActive && selectedStream ? 'Press Tail to start streaming messages' : undefined}
          />
          {isActive && (
            <div className="flex gap-1 mt-4">
              {[0.1, 0.2, 0.3].map(delay => (
                <span
                  key={delay}
                  className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse"
                  style={{ animationDelay: `${delay}s` }}
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
              const expanded = expandedId === msg.id

              return (
                <div
                  key={vrow.key}
                  data-index={vrow.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vrow.start}px)` }}
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

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1 border-t border-bg-border bg-bg-elevated text-2xs font-mono text-text-muted flex-shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-accent-green animate-pulse' : 'bg-text-muted')} />
          {isActive ? (paused ? 'PAUSED' : 'STREAMING') : 'STOPPED'}
        </span>
        {selectedStream && <span>stream: {selectedStream}</span>}
        {filterText && <span className="text-accent-yellow">filter: {filterText}</span>}
        <span className="ml-auto">{messages.length.toLocaleString()} total | {filtered.length.toLocaleString()} visible</span>
      </div>
    </div>
  )
}

// ── Message Row ───────────────────────────────────────────────────────────────

function MessageRow({
  msg, expanded, onToggle,
}: {
  msg: TailedMessage
  expanded: boolean
  onToggle: () => void
}) {
  const isJSON = Boolean(msg.payloadText && tryParseJSON(msg.payloadText).ok)

  return (
    <div
      className={cn(
        'border-b border-bg-border/50 cursor-pointer select-text',
        expanded ? 'bg-bg-surface' : 'hover:bg-bg-hover',
        msg.redelivered && 'border-l-2 border-l-accent-yellow',
      )}
    >
      {/* Row summary */}
      <div className="flex items-center gap-0 px-4 py-1.5" onClick={onToggle}>
        <span className="w-8 text-text-muted flex-shrink-0">
          {expanded
            ? <ChevronDown className="w-3 h-3 inline" />
            : <ChevronRight className="w-3 h-3 inline" />
          }
        </span>
        <span className="w-28 text-text-muted flex-shrink-0 truncate">
          {msg.timestamp ? formatTimestamp(msg.timestamp).slice(11, 23) : '—'}
        </span>
        <span className="w-8 text-text-muted flex-shrink-0 text-center">
          {msg.seq}
        </span>
        <span className="flex-1 text-accent-cyan truncate">{msg.subject}</span>
        <span className="w-20 text-text-muted text-right flex-shrink-0">
          {formatBytes(msg.payloadSize)}
        </span>
        <span className="w-16 text-right flex-shrink-0">
          {msg.redelivered && (
            <Badge variant="yellow" size="xs">REDELIV</Badge>
          )}
          {isJSON && !msg.redelivered && (
            <Badge variant="ghost" size="xs">JSON</Badge>
          )}
        </span>
      </div>

      {/* Expanded payload */}
      {expanded && (
        <div className="px-10 pb-3">
          <PayloadViewer message={msg} />
        </div>
      )}
    </div>
  )
}
