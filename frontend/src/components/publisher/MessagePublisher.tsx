/**
 * MessagePublisher — manually send messages to any NATS subject.
 *
 * Supports plain text and JSON payloads, custom headers, and shows
 * whether the message was captured by a JetStream stream (with seq).
 */
import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, Plus, Trash2, CheckCircle2, XCircle, RefreshCw, Code2 } from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { cn, Button, EmptyState } from '@/components/ui'
import type { PublishResult } from '@/types'

interface Header { key: string; value: string }

interface HistoryEntry {
  id: number
  subject: string
  payloadSize: number
  result: PublishResult | null
  error: string | null
  ts: number
}

let historyId = 0

export function MessagePublisher() {
  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId      = activeClusters[0] ?? ''

  const [subject, setSubject]   = useState('')
  const [payload, setPayload]   = useState('')
  const [headers, setHeaders]   = useState<Header[]>([])
  const [loading, setLoading]   = useState(false)
  const [history, setHistory]   = useState<HistoryEntry[]>([])

  // Fetch streams to show subject suggestions from stream subjects
  const { data: streamList } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
    enabled: Boolean(clusterId),
    staleTime: 30_000,
  })

  const allSubjects = (streamList ?? []).flatMap(s => s.config.subjects ?? [])

  const addHeader = () => setHeaders(h => [...h, { key: '', value: '' }])
  const removeHeader = (i: number) => setHeaders(h => h.filter((_, idx) => idx !== i))
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setHeaders(h => h.map((hdr, idx) => idx === i ? { ...hdr, [field]: val } : hdr))

  const formatJSON = () => {
    try {
      const parsed = JSON.parse(payload)
      setPayload(JSON.stringify(parsed, null, 2))
    } catch {
      // not valid JSON — ignore
    }
  }

  const handleSend = useCallback(async () => {
    if (!clusterId || !subject.trim()) return
    setLoading(true)
    const entry: HistoryEntry = { id: ++historyId, subject: subject.trim(), payloadSize: payload.length, result: null, error: null, ts: Date.now() }
    try {
      const hdrs = headers.reduce<Record<string, string>>((acc, h) => {
        if (h.key.trim()) acc[h.key.trim()] = h.value
        return acc
      }, {})
      const result = await api.publish(clusterId, {
        subject: subject.trim(),
        payload,
        headers: Object.keys(hdrs).length ? hdrs : undefined,
      })
      entry.result = result
    } catch (err: any) {
      entry.error = err.message ?? 'publish failed'
    } finally {
      setLoading(false)
      setHistory(prev => [entry, ...prev].slice(0, 50))
    }
  }, [clusterId, subject, payload, headers])

  if (!clusterId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-base">
        <EmptyState icon={<Send className="w-8 h-8" />} title="No cluster connected" description="Connect to a NATS cluster first" />
      </div>
    )
  }

  return (
    <div className="flex h-full bg-bg-base overflow-hidden">
      {/* ── Left: compose panel ─────────────────────────────────────────── */}
      <div className="w-[420px] flex-shrink-0 border-r border-bg-border flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-bg-border bg-bg-elevated flex-shrink-0">
          <h2 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest">Compose Message</h2>
        </div>

        <div className="p-4 space-y-4 flex-1">
          {/* Subject */}
          <div className="space-y-1">
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Subject *</label>
            <input
              type="text"
              list="subject-suggestions"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="orders.created  or  foo.bar.baz"
              className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
              onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSend() }}
            />
            {allSubjects.length > 0 && (
              <datalist id="subject-suggestions">
                {allSubjects.map(s => <option key={s} value={s} />)}
              </datalist>
            )}
          </div>

          {/* Payload */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Payload</label>
              <button
                onClick={formatJSON}
                title="Format as JSON"
                className="flex items-center gap-1 text-2xs font-mono text-text-muted hover:text-accent-cyan transition-colors"
              >
                <Code2 className="w-3 h-3" /> Format JSON
              </button>
            </div>
            <textarea
              value={payload}
              onChange={e => setPayload(e.target.value)}
              placeholder={'{\n  "key": "value"\n}'}
              rows={10}
              className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50 resize-y"
            />
            <p className="text-2xs font-mono text-text-muted">{payload.length} bytes</p>
          </div>

          {/* Headers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Headers</label>
              <button onClick={addHeader} className="flex items-center gap-1 text-2xs font-mono text-accent-cyan hover:text-accent-cyan/80 transition-colors">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {headers.length === 0 && (
              <p className="text-2xs font-mono text-text-muted/60 italic">No headers — click Add to include NATS headers</p>
            )}
            {headers.map((hdr, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={hdr.key}
                  onChange={e => updateHeader(i, 'key', e.target.value)}
                  placeholder="Header-Name"
                  className="flex-1 bg-bg-surface border border-bg-border rounded px-2 py-1 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
                />
                <span className="text-text-muted text-xs">:</span>
                <input
                  type="text"
                  value={hdr.value}
                  onChange={e => updateHeader(i, 'value', e.target.value)}
                  placeholder="value"
                  className="flex-1 bg-bg-surface border border-bg-border rounded px-2 py-1 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
                />
                <button onClick={() => removeHeader(i)} className="text-text-muted hover:text-accent-red transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Send button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!subject.trim() || loading}
            className="w-full"
          >
            {loading
              ? <><RefreshCw className="w-3 h-3 animate-spin" /> Sending…</>
              : <><Send className="w-3 h-3" /> Publish</>}
          </Button>
        </div>
      </div>

      {/* ── Right: history panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border bg-bg-elevated flex-shrink-0 flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest">
            Publish History
          </h2>
          {history.length > 0 && (
            <button
              onClick={() => setHistory([])}
              className="text-2xs font-mono text-text-muted hover:text-accent-red transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<Send className="w-8 h-8" />}
              title="No messages sent yet"
              description="Published messages will appear here"
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {history.map(entry => (
              <HistoryRow key={entry.id} entry={entry} onResend={() => {
                setSubject(entry.subject)
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({ entry, onResend }: { entry: HistoryEntry; onResend: () => void }) {
  const ok = Boolean(entry.result?.accepted)
  const ts = new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className={cn(
      'flex items-start gap-3 px-4 py-3 border-b border-bg-border/50 hover:bg-bg-hover transition-colors',
    )}>
      <div className="mt-0.5 flex-shrink-0">
        {ok
          ? <CheckCircle2 className="w-4 h-4 text-accent-green" />
          : <XCircle className="w-4 h-4 text-accent-red" />}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-accent-cyan truncate flex-1">{entry.subject}</span>
          <span className="text-2xs font-mono text-text-muted flex-shrink-0">{ts}</span>
        </div>
        {ok && entry.result && (
          <p className="text-2xs font-mono text-accent-green">
            ✓ accepted
            {entry.result.stream && <> → stream: <span className="text-text-secondary">{entry.result.stream}</span></>}
            {entry.result.seq   && <> seq: <span className="text-text-secondary">{entry.result.seq}</span></>}
          </p>
        )}
        {entry.error && (
          <p className="text-2xs font-mono text-accent-red truncate">{entry.error}</p>
        )}
        <p className="text-2xs font-mono text-text-muted">{entry.payloadSize} bytes</p>
      </div>
      <button
        onClick={onResend}
        title="Use this subject again"
        className="text-2xs font-mono text-text-muted hover:text-accent-cyan transition-colors flex-shrink-0"
      >
        ↩
      </button>
    </div>
  )
}
