/**
 * MessageBrowser — on-demand browse of stored JetStream messages.
 *
 * NOT live/streaming. User picks stream + optional subject filter + start seq,
 * clicks Fetch, sees paginated results. Each row is expandable for full payload.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, ChevronDown, ChevronRight, ChevronLeft,
  DatabaseZap, RefreshCw,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { cn, Button, Badge, EmptyState, Spinner } from '@/components/ui'
import { formatBytes, formatTimestamp, tryParseJSON } from '@/lib/format'
import type { StoredMessage } from '@/types'

const PAGE_SIZE = 50

export function MessageBrowser() {
  const activeClusters = useUIStore(s => s.activeClusters)
  const activeStream   = useUIStore(s => s.activeStream)   // pre-select from StreamExplorer
  const clusterId      = activeClusters[0] ?? ''

  // Seed selectedStream from the global activeStream when first rendered
  const [selectedStream, setSelectedStream] = useState(activeStream ?? '')
  const [subjectFilter, setSubjectFilter]   = useState('')
  const [startSeq, setStartSeq]             = useState('')
  const [fetchKey, setFetchKey]             = useState(0)   // bump to re-fetch
  const [nextSeq, setNextSeq]               = useState<number | null>(null)  // for next-page
  const [history, setHistory]               = useState<number[]>([])         // startSeq stack for prev-page
  const [expandedSeq, setExpandedSeq]       = useState<number | null>(null)

  // Fetch streams list for the selector
  const { data: streamList } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn:  () => api.streams.list(clusterId),
    enabled:  Boolean(clusterId),
    staleTime: 15_000,
  })
  const streams = streamList ?? []

  // Resolve effective startSeq for the current page
  const effectiveStartSeq = nextSeq ?? (startSeq ? parseInt(startSeq, 10) : undefined)

  const {
    data: messages,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['messages', clusterId, selectedStream, subjectFilter, effectiveStartSeq, fetchKey],
    queryFn: () => api.streams.messages(clusterId, selectedStream, {
      startSeq:  effectiveStartSeq,
      limit:     PAGE_SIZE,
      subject:   subjectFilter || undefined,
    }),
    enabled:   Boolean(clusterId) && Boolean(selectedStream) && fetchKey > 0,
    staleTime: 0,
    retry:     false,
  })

  const handleFetch = () => {
    setHistory([])
    setNextSeq(null)
    setFetchKey(k => k + 1)
    setExpandedSeq(null)
  }

  const handleNextPage = () => {
    if (!messages || messages.length < PAGE_SIZE) return
    const last = messages[messages.length - 1]
    setHistory(h => [...h, effectiveStartSeq ?? 0])
    setNextSeq(last.seq + 1)
    setExpandedSeq(null)
    setFetchKey(k => k + 1)
  }

  const handlePrevPage = () => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setNextSeq(prev === 0 ? null : prev)
    setExpandedSeq(null)
    setFetchKey(k => k + 1)
  }

  const hasNextPage = (messages?.length ?? 0) >= PAGE_SIZE
  const hasPrevPage = history.length > 0
  const pageNum     = history.length + 1

  if (!clusterId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-base">
        <EmptyState icon={<DatabaseZap className="w-8 h-8" />} title="No cluster connected" description="Connect to a NATS cluster first" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-base">
      {/* Query bar */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-bg-border bg-bg-elevated flex-shrink-0">
        {/* Stream */}
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Stream</label>
          <select
            value={selectedStream}
            onChange={e => { setSelectedStream(e.target.value); setHistory([]); setNextSeq(null); setFetchKey(0) }}
            className="bg-bg-surface border border-bg-border text-text-secondary text-xs font-mono rounded px-2 py-1.5 outline-none focus:border-accent-cyan/50 min-w-[160px]"
          >
            <option value="">— select —</option>
            {streams.map(s => <option key={s.config.name} value={s.config.name}>{s.config.name}</option>)}
          </select>
        </div>

        {/* Subject filter */}
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Subject Filter</label>
          <div className="flex items-center gap-1 bg-bg-surface border border-bg-border rounded px-2 py-1.5">
            <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
            <input
              type="text"
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
              placeholder="orders.*  or  exact.subject"
              className="bg-transparent text-xs font-mono text-text-primary placeholder-text-muted outline-none w-44"
              onKeyDown={e => { if (e.key === 'Enter' && selectedStream) handleFetch() }}
            />
            {subjectFilter && <button onClick={() => setSubjectFilter('')} className="text-text-muted hover:text-text-primary text-xs">×</button>}
          </div>
        </div>

        {/* Start seq */}
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Start Seq</label>
          <input
            type="number"
            min={1}
            value={startSeq}
            onChange={e => setStartSeq(e.target.value)}
            placeholder="1  (default: first)"
            className="bg-bg-surface border border-bg-border text-text-secondary text-xs font-mono rounded px-2 py-1.5 outline-none focus:border-accent-cyan/50 w-36"
            onKeyDown={e => { if (e.key === 'Enter' && selectedStream) handleFetch() }}
          />
        </div>

        <Button variant="primary" size="xs" onClick={handleFetch} disabled={!selectedStream || isFetching} className="mb-0.5">
          {isFetching ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          Fetch
        </Button>

        {fetchKey > 0 && messages && (
          <span className="text-2xs font-mono text-text-muted mb-0.5">
            {messages.length} messages — page {pageNum}
          </span>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {fetchKey === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<DatabaseZap className="w-8 h-8" />}
              title="Browse stored messages"
              description="Select a stream, optionally filter by subject, then click Fetch"
            />
          </div>
        )}

        {fetchKey > 0 && isFetching && (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size="md" />
          </div>
        )}

        {fetchKey > 0 && isError && (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<DatabaseZap className="w-8 h-8" />}
              title="Fetch failed"
              description={(error as Error)?.message}
            />
          </div>
        )}

        {fetchKey > 0 && !isFetching && !isError && messages && (
          <>
            {/* Column headers */}
            <div className="flex items-center px-4 py-1 border-b border-bg-border bg-bg-elevated text-2xs font-mono text-text-muted flex-shrink-0 select-none">
              <span className="w-8" />
              <span className="w-20 flex-shrink-0 text-center">SEQ</span>
              <span className="w-44 flex-shrink-0">TIMESTAMP</span>
              <span className="flex-1">SUBJECT</span>
              <span className="w-20 flex-shrink-0 text-right">SIZE</span>
              <span className="w-16 flex-shrink-0 text-right">FORMAT</span>
            </div>

            {messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState icon={<DatabaseZap className="w-8 h-8" />} title="No messages found" description="Try a different start seq or subject filter" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto font-mono text-xs">
                {messages.map(msg => (
                  <StoredMessageRow
                    key={msg.seq}
                    msg={msg}
                    expanded={expandedSeq === msg.seq}
                    onToggle={() => setExpandedSeq(expandedSeq === msg.seq ? null : msg.seq)}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {(hasPrevPage || hasNextPage) && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-bg-border bg-bg-elevated flex-shrink-0">
                <Button variant="ghost" size="xs" onClick={handlePrevPage} disabled={!hasPrevPage}>
                  <ChevronLeft className="w-3 h-3" /> Prev
                </Button>
                <span className="text-2xs font-mono text-text-muted">Page {pageNum}</span>
                <Button variant="ghost" size="xs" onClick={handleNextPage} disabled={!hasNextPage}>
                  Next <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Stored message row ────────────────────────────────────────────────────────

function StoredMessageRow({ msg, expanded, onToggle }: {
  msg: StoredMessage
  expanded: boolean
  onToggle: () => void
}) {
  const isJSON = Boolean(msg.payloadText && tryParseJSON(msg.payloadText).ok)
  const hasHeaders = msg.headers && Object.keys(msg.headers).length > 0

  return (
    <div className={cn(
      'border-b border-bg-border/50 cursor-pointer select-text',
      expanded ? 'bg-bg-surface' : 'hover:bg-bg-hover',
    )}>
      <div className="flex items-center px-4 py-1.5" onClick={onToggle}>
        <span className="w-8 text-text-muted flex-shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />}
        </span>
        <span className="w-20 flex-shrink-0 text-center tabular-nums text-accent-purple">{msg.seq}</span>
        <span className="w-44 text-text-muted flex-shrink-0 truncate">
          {msg.timestamp ? formatTimestamp(msg.timestamp) : '—'}
        </span>
        <span className="flex-1 text-accent-cyan truncate">{msg.subject}</span>
        <span className="w-20 text-text-muted text-right flex-shrink-0">{formatBytes(msg.payloadSize)}</span>
        <span className="w-16 text-right flex-shrink-0 space-x-1">
          {isJSON && <Badge variant="ghost" size="xs">JSON</Badge>}
          {hasHeaders && <Badge variant="default" size="xs">HDR</Badge>}
        </span>
      </div>

      {expanded && (
        <div className="px-10 pb-4 space-y-3">
          {/* Headers */}
          {hasHeaders && (
            <div>
              <p className="text-2xs font-mono text-text-muted uppercase tracking-widest mb-1">Headers</p>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                {Object.entries(msg.headers!).map(([k, v]) => (
                  <>
                    <span key={`k-${k}`} className="text-2xs font-mono text-accent-yellow">{k}</span>
                    <span key={`v-${k}`} className="text-2xs font-mono text-text-secondary break-all">{v}</span>
                  </>
                ))}
              </div>
            </div>
          )}

          {/* Payload */}
          <div>
            <p className="text-2xs font-mono text-text-muted uppercase tracking-widest mb-1">Payload</p>
            {isJSON ? (
              <pre className="text-xs font-mono text-text-secondary bg-bg-base rounded p-3 overflow-x-auto border border-bg-border whitespace-pre-wrap break-words">
                {JSON.stringify(JSON.parse(msg.payloadText), null, 2)}
              </pre>
            ) : (
              <pre className="text-xs font-mono text-text-secondary bg-bg-base rounded p-3 overflow-x-auto border border-bg-border whitespace-pre-wrap break-words">
                {msg.payloadText || <span className="text-text-muted italic">(empty)</span>}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
