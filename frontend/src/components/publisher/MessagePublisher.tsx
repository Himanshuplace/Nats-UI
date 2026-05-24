/**
 * MessagePublisher — send messages to any NATS subject.
 *
 * Shows known subjects (from stream configs + consumer filters) as autocomplete.
 * Supports plain text / JSON payloads, custom headers, publish history.
 */
import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Send, Plus, Trash2, CheckCircle2, XCircle,
  RefreshCw, Code2, ChevronDown, Layers,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { cn, Button, Badge, EmptyState } from '@/components/ui'
import { formatBytes, formatTimestamp } from '@/lib/format'
import type { PublishResult, SubjectInfo } from '@/types'

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

  const [subject, setSubject]           = useState('')
  const [payload, setPayload]           = useState('')
  const [headers, setHeaders]           = useState<Header[]>([])
  const [loading, setLoading]           = useState(false)
  const [history, setHistory]           = useState<HistoryEntry[]>([])
  const [showSuggestions, setShowSugg]  = useState(false)
  const [suggFilter, setSuggFilter]     = useState('')
  const subjectRef = useRef<HTMLInputElement>(null)

  // Known subjects from streams + consumers
  const { data: subjectList = [] } = useQuery({
    queryKey: ['subjects', clusterId],
    queryFn:  () => api.subjects.list(clusterId),
    enabled:  Boolean(clusterId),
    staleTime: 30_000,
  })

  const filteredSugg = subjectList.filter(s =>
    !suggFilter || s.subject.toLowerCase().includes(suggFilter.toLowerCase())
  )

  const addHeader    = () => setHeaders(h => [...h, { key: '', value: '' }])
  const removeHeader = (i: number) => setHeaders(h => h.filter((_, idx) => idx !== i))
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setHeaders(h => h.map((hdr, idx) => idx === i ? { ...hdr, [field]: val } : hdr))

  const formatJSON = () => {
    try {
      setPayload(JSON.stringify(JSON.parse(payload), null, 2))
    } catch { /* not valid JSON */ }
  }

  const pickSubject = (s: SubjectInfo) => {
    setSubject(s.subject)
    setShowSugg(false)
    setSuggFilter('')
    subjectRef.current?.focus()
  }

  const handleSend = useCallback(async () => {
    if (!clusterId || !subject.trim()) return
    setLoading(true)
    const entry: HistoryEntry = {
      id: ++historyId,
      subject: subject.trim(),
      payloadSize: payload.length,
      result: null,
      error: null,
      ts: Date.now(),
    }
    try {
      const hdrs = headers.reduce<Record<string, string>>((acc, h) => {
        if (h.key.trim()) acc[h.key.trim()] = h.value
        return acc
      }, {})
      entry.result = await api.publish(clusterId, {
        subject: subject.trim(),
        payload,
        headers: Object.keys(hdrs).length ? hdrs : undefined,
      })
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

      {/* ── Left: compose panel ───────────────────────────────────────────── */}
      <div className="w-[440px] flex-shrink-0 border-r border-bg-border flex flex-col">

        {/* Header */}
        <div className="px-4 py-3 border-b border-bg-border bg-bg-elevated flex items-center gap-2 flex-shrink-0">
          <Send className="w-4 h-4 text-accent-cyan" />
          <h2 className="text-xs font-mono font-semibold text-text-primary">Compose Message</h2>
          {subjectList.length > 0 && (
            <Badge variant="ghost" size="xs" className="ml-auto">{subjectList.length} known subjects</Badge>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* ── Subject ──────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">
              Subject <span className="text-accent-red">*</span>
            </label>

            <div className="relative">
              <div className="flex items-center gap-1 bg-bg-surface border border-bg-border rounded focus-within:border-accent-cyan/50 transition-colors">
                <input
                  ref={subjectRef}
                  type="text"
                  value={subject}
                  onChange={e => { setSubject(e.target.value); setSuggFilter(e.target.value); setShowSugg(true) }}
                  onFocus={() => setShowSugg(true)}
                  onBlur={() => setTimeout(() => setShowSugg(false), 150)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !loading && subject.trim()) handleSend()
                    if (e.key === 'Escape') setShowSugg(false)
                  }}
                  placeholder="orders.created  or  foo.bar.baz"
                  className="flex-1 bg-transparent px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none"
                />
                {subjectList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setSuggFilter(''); setShowSugg(v => !v) }}
                    className="px-2 py-2 text-text-muted hover:text-text-secondary transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Suggestions dropdown */}
              {showSuggestions && filteredSugg.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-elevated border border-bg-border rounded shadow-xl max-h-52 overflow-y-auto">
                  {filteredSugg.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={() => pickSubject(s)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-hover text-left group"
                    >
                      <span className="flex-1 text-xs font-mono text-text-primary truncate">{s.subject}</span>
                      {s.stream && (
                        <span className="flex items-center gap-1 text-2xs font-mono text-text-muted flex-shrink-0">
                          <Layers className="w-2.5 h-2.5" />
                          {s.stream}
                        </span>
                      )}
                      <Badge
                        variant={s.source === 'stream' ? 'default' : 'ghost'}
                        size="xs"
                        className="flex-shrink-0"
                      >
                        {s.source}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Payload ──────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Payload</label>
              <button
                onClick={formatJSON}
                className="flex items-center gap-1 text-2xs font-mono text-text-muted hover:text-accent-cyan transition-colors"
              >
                <Code2 className="w-3 h-3" /> Format JSON
              </button>
            </div>
            <textarea
              value={payload}
              onChange={e => setPayload(e.target.value)}
              placeholder={'{\n  "key": "value"\n}'}
              rows={8}
              className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50 resize-y transition-colors"
            />
            <p className="text-2xs font-mono text-text-muted">{formatBytes(payload.length)}</p>
          </div>

          {/* ── Headers ──────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">
                Headers {headers.length > 0 && <span className="text-accent-cyan ml-1">({headers.length})</span>}
              </label>
              <button onClick={addHeader} className="flex items-center gap-1 text-2xs font-mono text-accent-cyan hover:text-accent-cyan/80 transition-colors">
                <Plus className="w-3 h-3" /> Add Header
              </button>
            </div>
            {headers.length === 0 ? (
              <p className="text-2xs font-mono text-text-muted/50 italic">No custom headers</p>
            ) : (
              <div className="space-y-2">
                {headers.map((hdr, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={hdr.key}
                      onChange={e => updateHeader(i, 'key', e.target.value)}
                      placeholder="Header-Name"
                      className="flex-1 bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
                    />
                    <span className="text-text-muted text-xs font-mono">:</span>
                    <input
                      type="text"
                      value={hdr.value}
                      onChange={e => updateHeader(i, 'value', e.target.value)}
                      placeholder="value"
                      className="flex-1 bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
                    />
                    <button
                      onClick={() => removeHeader(i)}
                      className="text-text-muted hover:text-accent-red transition-colors p-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Send ─────────────────────────────────────────────────────── */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!subject.trim() || loading}
            className="w-full"
          >
            {loading
              ? <><RefreshCw className="w-3 h-3 animate-spin" /> Sending…</>
              : <><Send className="w-3 h-3" /> Publish to NATS</>}
          </Button>
        </div>
      </div>

      {/* ── Right: publish history ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="px-4 py-3 border-b border-bg-border bg-bg-elevated flex items-center gap-2 flex-shrink-0">
          <h2 className="text-xs font-mono font-semibold text-text-primary flex-1">Publish History</h2>
          {history.length > 0 && (
            <>
              <span className="text-2xs font-mono text-text-muted">
                {history.filter(e => e.result?.accepted).length}/{history.length} accepted
              </span>
              <button
                onClick={() => setHistory([])}
                className="text-2xs font-mono text-text-muted hover:text-accent-red transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<Send className="w-8 h-8" />}
              title="No messages sent yet"
              description="Published messages and their results appear here"
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-bg-border/50">
            {history.map(entry => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onResend={() => setSubject(entry.subject)}
              />
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

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
      <div className="mt-0.5 flex-shrink-0">
        {ok
          ? <CheckCircle2 className="w-4 h-4 text-accent-green" />
          : <XCircle className="w-4 h-4 text-accent-red" />}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-accent-cyan truncate flex-1">{entry.subject}</span>
          <span className="text-2xs font-mono text-text-muted flex-shrink-0">
            {formatTimestamp(new Date(entry.ts).toISOString())}
          </span>
        </div>
        {ok && entry.result && (
          <p className="text-2xs font-mono text-accent-green">
            ✓ accepted
            {entry.result.stream && (
              <> → <span className="text-text-secondary">stream:{entry.result.stream}</span></>
            )}
            {entry.result.seq != null && entry.result.seq > 0 && (
              <> seq:<span className="text-text-secondary">{entry.result.seq}</span></>
            )}
          </p>
        )}
        {entry.error && (
          <p className="text-2xs font-mono text-accent-red">{entry.error}</p>
        )}
        <p className="text-2xs font-mono text-text-muted">{formatBytes(entry.payloadSize)}</p>
      </div>
      <button
        onClick={onResend}
        title="Reuse this subject"
        className="text-2xs font-mono text-text-muted hover:text-accent-cyan transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 px-1"
      >
        ↩
      </button>
    </div>
  )
}
