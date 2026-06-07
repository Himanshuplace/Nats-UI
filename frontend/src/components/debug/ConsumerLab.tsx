/**
 * ConsumerLab — pull-consumer debugger.
 *
 * Fetch a batch of pending messages from a live PULL consumer and ACK / NAK /
 * TERM each one individually. This is how you clear poison messages from a
 * stuck consumer or inspect what it's choking on — the live Tail is read-only,
 * this one acts. Messages you fetch stay held (unacked) until you decide; ACK
 * removes them, NAK redelivers, TERM stops redelivery for that message.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FlaskConical, Download, Check, RotateCcw, Ban, AlertTriangle, Inbox, Zap } from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, Stepper, Badge, EmptyState, cn } from '@/components/ui'
import { formatBytes, formatTimeAgo, tryParseJSON } from '@/lib/format'
import type { DebugMessage } from '@/types'

export function ConsumerLab() {
  const clusterId = useUIStore(s => s.activeClusters[0] ?? '')
  const [stream, setStream]     = useState('')
  const [consumer, setConsumer] = useState('')
  const [batch, setBatch]       = useState(10)
  const [fetching, setFetching] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState<DebugMessage[]>([])
  const [acting, setActing]     = useState<string | null>(null)
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')

  const { data: streams } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
    enabled: Boolean(clusterId),
  })
  const { data: consumers } = useQuery({
    queryKey: ['consumers', clusterId, stream],
    queryFn: () => api.consumers.list(clusterId, stream),
    enabled: Boolean(clusterId && stream),
  })

  const doFetch = async () => {
    if (!stream || !consumer) { setError('Select a stream and consumer'); return }
    setFetching(true); setError(''); setInfo('')
    try {
      const res = await api.debug.fetch(clusterId, stream, consumer, batch)
      setSessionId(res.sessionId)
      setMessages(res.messages)
      if (res.messages.length === 0) setInfo('Nothing pending to fetch — the consumer has no available messages right now.')
    } catch (e) { setError((e as Error).message) }
    finally { setFetching(false) }
  }

  const act = async (m: DebugMessage, action: 'ack' | 'nak' | 'term') => {
    setActing(m.id); setError('')
    try {
      await api.debug.ack(clusterId, sessionId, m.id, action)
      setMessages(ms => ms.filter(x => x.id !== m.id))
    } catch (e) { setError((e as Error).message) }
    finally { setActing(null) }
  }

  if (!clusterId) {
    return <div className="flex-1 flex items-center justify-center"><EmptyState icon={<FlaskConical className="w-7 h-7" />} title="No cluster connected" description="Connect to a NATS server first" /></div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bg-border/50 glass-sm flex-wrap flex-shrink-0">
        <select value={stream} onChange={e => { setStream(e.target.value); setConsumer(''); setMessages([]) }} className="select-base min-w-[150px]">
          <option value="">— stream —</option>
          {streams?.map(s => <option key={s.config.name} value={s.config.name}>{s.config.name}</option>)}
        </select>
        <select value={consumer} onChange={e => { setConsumer(e.target.value); setMessages([]) }} className="select-base min-w-[150px]" disabled={!stream}>
          <option value="">— consumer —</option>
          {consumers?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-mono text-text-muted uppercase tracking-wider">batch</span>
          <Stepper size="sm" min={1} max={50} value={batch} onChange={setBatch} />
        </div>
        <Button variant="primary" size="sm" onClick={doFetch} disabled={fetching || !stream || !consumer}>
          {fetching ? <><Zap className="w-3.5 h-3.5 animate-pulse" /> Fetching…</> : <><Download className="w-3.5 h-3.5" /> Fetch</>}
        </Button>
        <span className="ml-auto text-2xs font-mono text-text-muted hidden lg:block">
          acts on the live consumer · ACK removes · NAK redelivers · TERM stops redelivery
        </span>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded-lg text-xs font-mono text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-10 h-10" />}
            title={info || 'No messages fetched'}
            description={info ? undefined : 'Pick a pull consumer and click Fetch to pull a batch you can ACK / NAK / TERM individually.'}
          />
        ) : (
          <div className="space-y-2 max-w-4xl">
            <div className="text-2xs font-mono text-text-muted mb-1">
              {messages.length} message{messages.length === 1 ? '' : 's'} held · acting on <span className="text-accent-cyan">{consumer}</span>
            </div>
            {messages.map(m => <MessageCard key={m.id} m={m} busy={acting === m.id} onAct={(a) => act(m, a)} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageCard({ m, busy, onAct }: { m: DebugMessage; busy: boolean; onAct: (a: 'ack' | 'nak' | 'term') => void }) {
  const json = tryParseJSON(m.payload)
  const poison = m.numDelivered > 1

  return (
    <div className={cn('surface-card overflow-hidden', poison && 'border-accent-red/40')}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bg-border/50">
        <span className="text-xs font-mono text-accent-cyan truncate flex-1">{m.subject}</span>
        <span className="text-2xs font-mono text-text-muted tabular-nums">seq {m.streamSeq}</span>
        <Badge variant={poison ? 'red' : 'default'} size="xs">delivered {m.numDelivered}×</Badge>
        <span className="text-2xs font-mono text-text-muted">{formatBytes(m.size)}</span>
        {m.timestamp && <span className="text-2xs font-mono text-text-muted">{formatTimeAgo(m.timestamp)}</span>}
      </div>

      <pre className="font-mono text-xs leading-relaxed text-text-secondary p-3 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-bg-base">
        {json.ok ? json.pretty : (m.payload || <span className="italic text-text-muted">empty</span>)}
      </pre>

      {m.headers && Object.keys(m.headers).length > 0 && (
        <div className="px-3 py-1.5 border-t border-bg-border/40 text-2xs font-mono text-text-muted">
          {Object.entries(m.headers).map(([k, v]) => <span key={k} className="mr-3">{k}=<span className="text-text-secondary">{v}</span></span>)}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 border-t border-bg-border/50">
        <Button variant="secondary" size="xs" disabled={busy} onClick={() => onAct('ack')} className="!text-accent-green !border-accent-green/30 hover:!bg-accent-green/10">
          <Check className="w-3 h-3" /> Ack
        </Button>
        <Button variant="secondary" size="xs" disabled={busy} onClick={() => onAct('nak')} className="!text-accent-yellow !border-accent-yellow/30 hover:!bg-accent-yellow/10">
          <RotateCcw className="w-3 h-3" /> Nak
        </Button>
        <Button variant="danger" size="xs" disabled={busy} onClick={() => onAct('term')}>
          <Ban className="w-3 h-3" /> Term
        </Button>
        <span className="ml-auto text-2xs font-mono text-text-muted">ack=remove · nak=redeliver · term=stop</span>
      </div>
    </div>
  )
}
