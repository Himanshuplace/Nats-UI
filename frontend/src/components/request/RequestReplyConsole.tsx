/**
 * RequestReplyConsole — core NATS request/reply tester.
 *
 * Send a request on a subject with a timeout and inspect the reply payload,
 * headers and round-trip time. This is the half of NATS the fire-and-forget
 * Publisher can't do — it's how you poke a running microservice and see what
 * comes back (or that nothing is listening / it timed out).
 */
import { useState } from 'react'
import { ArrowLeftRight, Plus, Trash2, Send, Zap, AlertTriangle, Clock } from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, Stepper, Badge, EmptyState, cn } from '@/components/ui'
import { formatBytes, tryParseJSON } from '@/lib/format'
import type { RequestReplyResult } from '@/types'

interface Header { key: string; value: string }
interface HistoryItem { subject: string; res: RequestReplyResult; at: number }

const inputClass =
  'w-full px-3 py-2 text-xs font-mono bg-bg-surface border border-bg-border rounded-lg ' +
  'text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/60 ' +
  'focus:ring-2 focus:ring-accent-primary/15 transition-all'

function statusBadge(res: RequestReplyResult) {
  if (res.noResponders) return <Badge variant="red" size="sm">NO RESPONDERS</Badge>
  if (res.timedOut)     return <Badge variant="yellow" size="sm">TIMED OUT</Badge>
  return <Badge variant="green" size="sm">REPLIED</Badge>
}

export function RequestReplyConsole() {
  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId = activeClusters[0] ?? ''

  const [subject, setSubject]   = useState('')
  const [payload, setPayload]   = useState('')
  const [headers, setHeaders]   = useState<Header[]>([])
  const [timeoutMs, setTimeout] = useState(2000)
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState('')
  const [result, setResult]     = useState<RequestReplyResult | null>(null)
  const [history, setHistory]   = useState<HistoryItem[]>([])

  const addHeader    = () => setHeaders(h => [...h, { key: '', value: '' }])
  const setHeader    = (i: number, patch: Partial<Header>) => setHeaders(h => h.map((x, j) => j === i ? { ...x, ...patch } : x))
  const removeHeader = (i: number) => setHeaders(h => h.filter((_, j) => j !== i))

  const send = async () => {
    if (!subject.trim()) { setError('Subject is required'); return }
    if (!clusterId)      { setError('No cluster connected'); return }
    setSending(true); setError(''); setResult(null)
    try {
      const hdrs = Object.fromEntries(headers.filter(h => h.key.trim()).map(h => [h.key.trim(), h.value]))
      const res = await api.request(clusterId, {
        subject: subject.trim(),
        payload,
        headers: Object.keys(hdrs).length ? hdrs : undefined,
        timeoutMs,
      })
      setResult(res)
      setHistory(h => [{ subject: subject.trim(), res, at: Date.now() }, ...h].slice(0, 20))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const replyJson = result && !result.noResponders && !result.timedOut ? tryParseJSON(result.payload) : { ok: false as const }

  return (
    <div className="flex h-full">
      {/* ── Left: request ── */}
      <div className="w-[26rem] flex-shrink-0 border-r border-bg-border/50 flex flex-col glass overflow-y-auto">
        <div className="p-4 space-y-4">
          <div>
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Subject <span className="text-accent-red">*</span></label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
              placeholder="svc.users.get  or  $SRV.PING"
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Payload</label>
            <textarea
              value={payload}
              onChange={e => setPayload(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
              spellCheck={false}
              placeholder={'{ "id": 42 }'}
              rows={6}
              className={cn(inputClass, 'resize-none leading-relaxed')}
            />
            <p className="text-2xs font-mono text-text-muted mt-1">{formatBytes(new Blob([payload]).size)} · ⌘/Ctrl+Enter to send</p>
          </div>

          {/* Headers */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Headers</label>
              <button onClick={addHeader} className="flex items-center gap-1 text-2xs font-mono text-accent-primary hover:text-accent-primary/80">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {headers.length === 0 ? (
              <p className="text-2xs font-mono text-text-muted italic">No custom headers</p>
            ) : (
              <div className="space-y-1.5">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input value={h.key} onChange={e => setHeader(i, { key: e.target.value })} placeholder="key" className={cn(inputClass, 'flex-1 py-1')} />
                    <input value={h.value} onChange={e => setHeader(i, { value: e.target.value })} placeholder="value" className={cn(inputClass, 'flex-1 py-1')} />
                    <button onClick={() => removeHeader(i)} className="text-text-muted hover:text-accent-red p-1"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Timeout */}
          <div>
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Timeout</label>
            <Stepper size="md" min={100} max={30000} step={500} value={timeoutMs} onChange={setTimeout} suffix="ms" label="Timeout ms" />
          </div>

          <Button variant="primary" size="md" onClick={send} disabled={sending || !subject.trim()} className="w-full justify-center">
            {sending ? <><Zap className="w-4 h-4 animate-pulse" /> Sending…</> : <><Send className="w-4 h-4" /> Send Request</>}
          </Button>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded-lg text-xs font-mono text-accent-red">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: reply + history ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">
          {!result ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState icon={<ArrowLeftRight className="w-8 h-8" />} title="No reply yet"
                description="Send a request to inspect the reply, headers, and round-trip time" />
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl">
              <div className="flex items-center gap-3">
                {statusBadge(result)}
                <span className="flex items-center gap-1 text-xs font-mono text-text-secondary">
                  <Clock className="w-3.5 h-3.5 text-text-muted" /> {result.rttMs.toFixed(1)} ms
                </span>
                {!result.noResponders && !result.timedOut && (
                  <span className="text-xs font-mono text-text-muted">· {formatBytes(result.size)}</span>
                )}
              </div>

              {result.noResponders && (
                <div className="surface-card p-4 text-sm font-mono text-text-secondary">
                  No service is subscribed to <span className="text-accent-cyan">{subject}</span>. Nothing is listening on that subject.
                </div>
              )}
              {result.timedOut && (
                <div className="surface-card p-4 text-sm font-mono text-text-secondary">
                  No reply arrived within {timeoutMs} ms. A responder may exist but didn't answer in time — try a longer timeout.
                </div>
              )}

              {!result.noResponders && !result.timedOut && (
                <>
                  {result.subject && (
                    <div className="text-2xs font-mono text-text-muted">reply inbox: <span className="text-accent-cyan">{result.subject}</span></div>
                  )}
                  <div>
                    <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-2">
                      Reply Payload {replyJson.ok && <span className="text-accent-primary ml-1">JSON</span>}
                    </label>
                    <pre className="terminal-pre whitespace-pre-wrap break-words text-text-primary">{replyJson.ok ? replyJson.pretty : (result.payload || <span className="text-text-muted italic">empty</span>)}</pre>
                  </div>
                  {result.headers && Object.keys(result.headers).length > 0 && (
                    <div>
                      <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-2">Reply Headers</label>
                      <div className="surface-card divide-y divide-bg-border/50">
                        {Object.entries(result.headers).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-3 px-3 py-1.5 text-xs font-mono">
                            <span className="text-text-muted min-w-[10rem]">{k}</span>
                            <span className="text-text-secondary break-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Recent requests */}
        {history.length > 0 && (
          <div className="border-t border-bg-border/50 flex-shrink-0 max-h-44 overflow-y-auto">
            <div className="px-4 py-1.5 text-2xs font-mono text-text-muted uppercase tracking-widest sticky top-0 glass-sm">Recent</div>
            {history.map((h, i) => (
              <button key={i} onClick={() => { setSubject(h.subject); setResult(h.res) }}
                className="w-full flex items-center gap-3 px-4 py-1.5 border-b border-bg-border/40 hover:bg-bg-hover transition-colors text-left">
                {statusBadge(h.res)}
                <span className="flex-1 text-xs font-mono text-text-secondary truncate">{h.subject}</span>
                <span className="text-2xs font-mono text-text-muted">{h.res.rttMs.toFixed(1)} ms</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
