/**
 * DeadLetterQueue — poison-message analyzer.
 *
 * NATS has no literal dead-letter queue. Instead JetStream emits advisories when
 * it gives up on a message: MAX_DELIVERIES (a message hit the consumer's
 * MaxDeliver cap) and MSG_TERMINATED (a consumer +TERM'd it). The backend keeps a
 * live subscription to those advisories per cluster and buffers the events, so
 * this view loads instantly and just polls the buffer. Expand a row to fetch the
 * underlying message and Redeliver it (re-publish to its subject) for a retry.
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Skull, AlertTriangle, Ban, RotateCcw, Trash2, RefreshCw,
  ChevronRight, ChevronDown, Inbox,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Badge, Button, EmptyState, Spinner, cn } from '@/components/ui'
import { formatBytes, formatTimeAgo, tryParseJSON } from '@/lib/format'
import type { DeadLetter } from '@/types'

type TypeFilter = 'all' | 'max_deliver' | 'terminated'

export function DeadLetterQueue() {
  const clusterId = useUIStore(s => s.activeClusters[0] ?? '')
  const qc = useQueryClient()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [streamFilter, setStreamFilter] = useState('')
  const [clearing, setClearing] = useState(false)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dlq', clusterId],
    queryFn: () => api.dlq.list(clusterId),
    enabled: Boolean(clusterId),
    refetchInterval: 4000, // server buffers continuously; this just refreshes the view
  })

  const events = useMemo(() => {
    const all = data?.events ?? []
    return all.filter(e =>
      (typeFilter === 'all' || e.type === typeFilter) &&
      (streamFilter === '' || e.stream.toLowerCase().includes(streamFilter.toLowerCase())),
    )
  }, [data, typeFilter, streamFilter])

  const clearAll = async () => {
    setClearing(true)
    try {
      await api.dlq.clear(clusterId)
      await qc.invalidateQueries({ queryKey: ['dlq', clusterId] })
    } finally {
      setClearing(false)
    }
  }

  if (!clusterId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState icon={<Skull className="w-7 h-7" />} title="No cluster connected" description="Connect to a NATS server first" />
      </div>
    )
  }

  const total = data?.events.length ?? 0
  const maxDeliverCount = data?.events.filter(e => e.type === 'max_deliver').length ?? 0
  const terminatedCount = data?.events.filter(e => e.type === 'terminated').length ?? 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bg-border/50 glass-sm flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5 mr-1">
          <Skull className="w-4 h-4 text-accent-red" />
          <span className="text-xs font-sans font-semibold text-text-primary">Dead Letters</span>
        </div>

        <FilterChip label="All" count={total} active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
        <FilterChip label="Max deliveries" count={maxDeliverCount} active={typeFilter === 'max_deliver'} onClick={() => setTypeFilter('max_deliver')} tone="red" />
        <FilterChip label="Terminated" count={terminatedCount} active={typeFilter === 'terminated'} onClick={() => setTypeFilter('terminated')} tone="yellow" />

        <input
          value={streamFilter}
          onChange={e => setStreamFilter(e.target.value)}
          placeholder="filter by stream…"
          className="input-base h-7 w-40 text-xs"
        />

        <div className="ml-auto flex items-center gap-2">
          {isFetching && <Spinner size="xs" />}
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={clearAll} disabled={clearing || total === 0}>
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </Button>
        </div>
      </div>

      {/* Watching-since note */}
      {data && (
        <div className="px-4 py-1.5 border-b border-bg-border/30 text-2xs font-mono text-text-muted flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
          watching <span className="text-text-secondary">MAX_DELIVERIES</span> + <span className="text-text-secondary">MSG_TERMINATED</span> advisories
          {' '}since {formatTimeAgo(data.watchingSince)} · buffer holds the latest 500 events
        </div>
      )}

      {isError && (
        <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded-lg text-xs font-mono text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {(error as Error)?.message ?? 'Failed to load dead letters'}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><Spinner size="md" /></div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-10 h-10" />}
            title={total === 0 ? 'No poison messages' : 'No events match the filter'}
            description={
              total === 0
                ? 'Watching live. A dead letter appears when a consumer exhausts its MaxDeliver attempts or +TERMs a message. Set a consumer’s MaxDeliver low and let a message fail to see one here.'
                : 'Adjust the type or stream filter above.'
            }
          />
        ) : (
          <div className="space-y-2 max-w-4xl">
            <div className="text-2xs font-mono text-text-muted mb-1">
              {events.length} event{events.length === 1 ? '' : 's'}{total !== events.length && ` of ${total}`} · newest first
            </div>
            {events.map((e, i) => (
              <DeadLetterCard key={`${e.type}-${e.stream}-${e.consumer}-${e.streamSeq}-${i}`} clusterId={clusterId} dl={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChip({ label, count, active, onClick, tone }: {
  label: string; count: number; active: boolean; onClick: () => void; tone?: 'red' | 'yellow'
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md text-2xs font-mono border transition-colors',
        active
          ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary'
          : 'border-bg-border/60 text-text-muted hover:text-text-secondary',
      )}
    >
      <span>{label}</span>
      <span className={cn(
        'tabular-nums px-1 rounded',
        tone === 'red' ? 'text-accent-red' : tone === 'yellow' ? 'text-accent-yellow' : '',
      )}>{count}</span>
    </button>
  )
}

function DeadLetterCard({ clusterId, dl }: { clusterId: string; dl: DeadLetter }) {
  const [open, setOpen] = useState(false)
  const [redelivering, setRedelivering] = useState(false)
  const [redelivered, setRedelivered] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const isMaxDeliver = dl.type === 'max_deliver'

  const { data: msg, isLoading: msgLoading } = useQuery({
    queryKey: ['dlq-msg', clusterId, dl.stream, dl.streamSeq],
    queryFn: () => api.dlq.message(clusterId, dl.stream, dl.streamSeq),
    enabled: open,
    staleTime: 30_000,
  })

  const redeliver = async () => {
    setRedelivering(true); setActionError(''); setRedelivered(null)
    try {
      const res = await api.dlq.redeliver(clusterId, dl.stream, dl.streamSeq)
      setRedelivered(res.stream ? `re-published to ${res.subject} (stream ${res.stream}, seq ${res.seq})` : `re-published to ${res.subject}`)
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setRedelivering(false)
    }
  }

  const json = msg?.found ? tryParseJSON(msg.payload) : null

  return (
    <div className={cn('surface-card overflow-hidden', isMaxDeliver ? 'border-accent-red/40' : 'border-accent-yellow/40')}>
      {/* Header row — click to expand */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-surface/40 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
        {isMaxDeliver
          ? <Badge variant="red" size="xs"><AlertTriangle className="w-3 h-3" /> MAX DELIVERIES</Badge>
          : <Badge variant="yellow" size="xs"><Ban className="w-3 h-3" /> TERMINATED</Badge>}
        <span className="text-xs font-mono text-text-primary truncate">
          <span className="text-accent-cyan">{dl.stream}</span>
          <span className="text-text-muted"> → </span>
          <span className="text-text-secondary">{dl.consumer}</span>
        </span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          <span className="text-2xs font-mono text-text-muted tabular-nums">seq {dl.streamSeq}</span>
          <Badge variant={isMaxDeliver ? 'red' : 'default'} size="xs">{dl.deliveries} attempt{dl.deliveries === 1 ? '' : 's'}</Badge>
          {dl.timestamp && <span className="text-2xs font-mono text-text-muted">{formatTimeAgo(dl.timestamp)}</span>}
        </span>
      </button>

      {dl.reason && (
        <div className="px-3 pb-1.5 -mt-0.5 text-2xs font-mono text-text-muted">
          reason: <span className="text-accent-yellow">{dl.reason}</span>
        </div>
      )}

      {/* Expanded body — lazy-fetched underlying message */}
      {open && (
        <div className="border-t border-bg-border/50">
          {msgLoading ? (
            <div className="flex items-center justify-center py-6"><Spinner size="sm" /></div>
          ) : !msg || !msg.found ? (
            <div className="px-3 py-3 text-2xs font-mono text-text-muted flex items-center gap-2">
              <Inbox className="w-3.5 h-3.5" />
              message no longer in the stream — it was acked, purged, or aged out (the advisory outlives it)
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 text-2xs font-mono text-text-muted border-b border-bg-border/30">
                <span className="text-accent-cyan truncate">{msg.subject}</span>
                <span className="ml-auto">{formatBytes(msg.payloadSize)}</span>
              </div>
              <pre className="font-mono text-xs leading-relaxed text-text-secondary p-3 max-h-56 overflow-auto whitespace-pre-wrap break-words bg-bg-base">
                {json?.ok ? json.pretty : (msg.payload || <span className="italic text-text-muted">empty payload</span>)}
              </pre>
              {msg.headers && Object.keys(msg.headers).length > 0 && (
                <div className="px-3 py-1.5 border-t border-bg-border/40 text-2xs font-mono text-text-muted">
                  {Object.entries(msg.headers).map(([k, v]) => <span key={k} className="mr-3">{k}=<span className="text-text-secondary">{v}</span></span>)}
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-bg-border/50">
            <Button
              variant="secondary" size="xs" disabled={redelivering || !msg?.found}
              onClick={redeliver}
              className="!text-accent-green !border-accent-green/30 hover:!bg-accent-green/10"
            >
              <RotateCcw className={cn('w-3 h-3', redelivering && 'animate-spin')} /> {redelivering ? 'Redelivering…' : 'Redeliver'}
            </Button>
            {redelivered && <span className="text-2xs font-mono text-accent-green">{redelivered}</span>}
            {actionError && <span className="text-2xs font-mono text-accent-red">{actionError}</span>}
            <span className="ml-auto text-2xs font-mono text-text-muted">redeliver = re-publish to its subject for a retry</span>
          </div>
        </div>
      )}
    </div>
  )
}
