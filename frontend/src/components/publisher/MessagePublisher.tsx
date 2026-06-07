/**
 * MessagePublisher — multi-tab NATS message composer.
 *
 * Each tab has its own subject, payload, and headers — navigate between tabs
 * to compose messages to different subjects simultaneously. Tabs persist
 * across route changes via Zustand viewStates.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Send, Plus, Trash2, CheckCircle2, XCircle,
  RefreshCw, Code2, ChevronDown, Layers, X,
  Save, Bookmark, Square, Braces, Clock,
} from 'lucide-react'
import { useUIStore } from '@/store'
import type { PublisherTab } from '@/store'
import { api } from '@/lib/api'
import { cn, Badge, EmptyState } from '@/components/ui'
import { formatBytes, formatTimestamp } from '@/lib/format'
import type { PublishResult, SubjectInfo } from '@/types'

interface Header { key: string; value: string }

interface HistoryEntry {
  id: number
  tabId: string
  subject: string
  payloadSize: number
  result: PublishResult | null
  error: string | null
  ts: number
  burst?: { ok: number; fail: number; elapsedMs: number }
}

// ── Saved templates (localStorage) ──────────────────────────────────────────────

interface Template { id: string; name: string; subject: string; payload: string; headers: Header[] }

const TPL_KEY = 'natsui-publisher-templates'

function loadTemplates(): Template[] {
  try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]') } catch { return [] }
}
function persistTemplates(t: Template[]): void {
  try { localStorage.setItem(TPL_KEY, JSON.stringify(t)) } catch { /* quota */ }
}

// ── Placeholders ────────────────────────────────────────────────────────────────
// {{seq}} {{uuid}} {{timestamp}} {{time}} {{rand}} {{rand:a:b}} are built-in and
// resolve per message; any other {{name}} is a custom variable the user fills in.

const BUILTIN_VARS = new Set(['seq', 'i', 'index', 'uuid', 'timestamp', 'ts', 'time', 'now', 'rand', 'random'])

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function isBuiltinVar(t: string): boolean {
  return BUILTIN_VARS.has(t.toLowerCase()) || /^rand:-?\d+:-?\d+$/i.test(t)
}

function substitute(text: string, vars: Record<string, string>, seq: number): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, raw) => {
    const t = String(raw).trim()
    const low = t.toLowerCase()
    if (low === 'seq' || low === 'i' || low === 'index') return String(seq)
    if (low === 'uuid') return (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2))
    if (low === 'timestamp' || low === 'ts') return new Date().toISOString()
    if (low === 'time' || low === 'now') return String(Date.now())
    if (low === 'rand' || low === 'random') return String(Math.floor(Math.random() * 1e6))
    const rm = low.match(/^rand:(-?\d+):(-?\d+)$/)
    if (rm) { const a = +rm[1], b = +rm[2]; return String(a + Math.floor(Math.random() * (b - a + 1))) }
    return Object.prototype.hasOwnProperty.call(vars, t) ? vars[t] : `{{${t}}}`
  })
}

function detectPlaceholders(text: string): string[] {
  const out = new Set<string>()
  const re = /\{\{\s*([^}]+?)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.add(m[1].trim())
  return [...out]
}

let historyId = 0
let tabCounter = 1

function makeTab(): PublisherTab {
  tabCounter++
  return {
    id:      `tab-${Date.now()}-${tabCounter}`,
    label:   `Tab ${tabCounter}`,
    subject: '',
    payload: '',
    headers: [],
  }
}

export function MessagePublisher() {
  const activeClusters   = useUIStore(s => s.activeClusters)
  const publisherState   = useUIStore(s => s.viewStates.publisher)
  const setPublisherState = useUIStore(s => s.setPublisherState)
  const clusterId        = activeClusters[0] ?? ''

  // ── Tab state — seed from persisted store ─────────────────────────────────
  const [tabs, setTabsLocal]           = useState<PublisherTab[]>(() =>
    publisherState.tabs.length > 0 ? publisherState.tabs : [makeTab()],
  )
  const [activeTabId, setActiveTabIdLocal] = useState<string>(() =>
    publisherState.activeTabId || tabs[0]?.id || '',
  )

  // Keep store in sync whenever tabs change
  useEffect(() => {
    setPublisherState({ tabs, activeTabId })
  }, [tabs, activeTabId, setPublisherState])

  // ── Send state per tab — NOT persisted (ephemeral) ────────────────────────
  const [loading, setLoading]   = useState(false)
  const [sendOk, setSendOk]     = useState(false)   // brief "Sent!" flash
  const sendTimerRef            = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [history, setHistory]   = useState<HistoryEntry[]>([])

  // ── Burst + placeholders + templates ──────────────────────────────────────
  const [count, setCount]           = useState(1)
  const [durationSec, setDuration]  = useState(0)        // spread N over this many seconds (0 = fast)
  const [vars, setVars]             = useState<Record<string, string>>({})
  const [bursting, setBursting]     = useState(false)
  const [burstSent, setBurstSent]   = useState(0)
  const burstStop                   = useRef(false)
  const [templates, setTemplates]   = useState<Template[]>(loadTemplates)
  const [showSaved, setShowSaved]   = useState(false)
  const [showSaveBox, setShowSaveBox] = useState(false)
  const [saveName, setSaveName]     = useState('')

  // ── Subject autocomplete ──────────────────────────────────────────────────
  const [showSugg, setShowSugg]     = useState(false)
  const [suggFilter, setSuggFilter] = useState('')
  const subjectRef = useRef<HTMLInputElement>(null)

  const { data: subjectList = [] } = useQuery({
    queryKey: ['subjects', clusterId],
    queryFn:  () => api.subjects.list(clusterId),
    enabled:  Boolean(clusterId),
    staleTime: 30_000,
  })

  const filteredSugg = subjectList.filter(s =>
    !suggFilter || s.subject.toLowerCase().includes(suggFilter.toLowerCase()),
  )

  // ── Tab helpers ───────────────────────────────────────────────────────────
  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]

  const setTabs = useCallback((updater: (prev: PublisherTab[]) => PublisherTab[]) => {
    setTabsLocal(prev => {
      const next = updater(prev)
      return next
    })
  }, [])

  const updateActiveTab = useCallback((patch: Partial<PublisherTab>) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...patch } : t))
  }, [activeTabId, setTabs])

  const addTab = useCallback(() => {
    const tab = makeTab()
    setTabs(prev => [...prev, tab])
    setActiveTabIdLocal(tab.id)
  }, [setTabs])

  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTabs(prev => {
      if (prev.length === 1) return prev   // keep at least one tab
      const idx  = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      if (id === activeTabId) {
        const newActive = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? ''
        setActiveTabIdLocal(newActive)
      }
      return next
    })
  }, [activeTabId, setTabs])

  const renameTab = useCallback((id: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, label } : t))
  }, [setTabs])

  // ── Field helpers for active tab ──────────────────────────────────────────
  const setSubject = (v: string) => updateActiveTab({ subject: v })
  const setPayload = (v: string) => updateActiveTab({ payload: v })

  const addHeader    = () => updateActiveTab({ headers: [...(activeTab?.headers ?? []), { key: '', value: '' }] })
  const removeHeader = (i: number) => updateActiveTab({ headers: (activeTab?.headers ?? []).filter((_, idx) => idx !== i) })
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    updateActiveTab({ headers: (activeTab?.headers ?? []).map((h, idx) => idx === i ? { ...h, [field]: val } : h) })

  const formatJSON = () => {
    if (!activeTab) return
    try { updateActiveTab({ payload: JSON.stringify(JSON.parse(activeTab.payload), null, 2) }) }
    catch { /* not JSON */ }
  }

  const pickSubject = (s: SubjectInfo) => {
    setSubject(s.subject)
    setShowSugg(false)
    setSuggFilter('')
    subjectRef.current?.focus()
  }

  // ── Placeholders detected in subject + payload ────────────────────────────
  const placeholders = useMemo(() => {
    const all = [...new Set([
      ...detectPlaceholders(activeTab?.subject ?? ''),
      ...detectPlaceholders(activeTab?.payload ?? ''),
    ])]
    return { builtin: all.filter(isBuiltinVar), custom: all.filter(t => !isBuiltinVar(t)) }
  }, [activeTab?.subject, activeTab?.payload])

  const setVar = (k: string, v: string) => setVars(prev => ({ ...prev, [k]: v }))

  // ── Templates ─────────────────────────────────────────────────────────────
  const saveTemplate = () => {
    if (!activeTab) return
    const name = (saveName.trim() || activeTab.subject.trim() || 'Untitled').slice(0, 40)
    const tpl: Template = { id: `tpl-${Date.now()}`, name, subject: activeTab.subject, payload: activeTab.payload, headers: activeTab.headers }
    const next = [tpl, ...templates.filter(t => t.name !== name)].slice(0, 50)
    setTemplates(next); persistTemplates(next)
    setShowSaveBox(false); setSaveName('')
  }
  const loadTemplate = (t: Template) => {
    updateActiveTab({ subject: t.subject, payload: t.payload, headers: t.headers })
    setShowSaved(false)
  }
  const deleteTemplate = (id: string) => {
    const next = templates.filter(t => t.id !== id)
    setTemplates(next); persistTemplates(next)
  }

  const stopBurst = () => { burstStop.current = true }

  // ── Send — a single message, or a burst of N over a duration ───────────────
  const handleSend = useCallback(async () => {
    if (!clusterId || !activeTab?.subject.trim() || loading || bursting) return
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)

    const total = Math.max(1, Math.min(Math.floor(count) || 1, 10000))
    const baseSubject = activeTab.subject.trim()
    const hdrs = (activeTab.headers ?? []).reduce<Record<string, string>>((acc, h) => {
      if (h.key.trim()) acc[h.key.trim()] = h.value
      return acc
    }, {})
    const headersArg = Object.keys(hdrs).length ? hdrs : undefined

    // Single send
    if (total === 1) {
      setSendOk(false); setLoading(true)
      const entry: HistoryEntry = {
        id: ++historyId, tabId: activeTab.id, subject: baseSubject,
        payloadSize: activeTab.payload.length, result: null, error: null, ts: Date.now(),
      }
      try {
        entry.result = await api.publish(clusterId, {
          subject: substitute(baseSubject, vars, 1),
          payload: substitute(activeTab.payload, vars, 1),
          headers: headersArg,
        })
        setSendOk(true)
        sendTimerRef.current = setTimeout(() => setSendOk(false), 1500)
      } catch (err: any) {
        entry.error = err.message ?? 'publish failed'
      } finally {
        setLoading(false)
        setHistory(prev => [entry, ...prev].slice(0, 100))
      }
      return
    }

    // Burst: publish `total` messages, spread across durationSec
    burstStop.current = false
    setBursting(true); setBurstSent(0)
    const delay = durationSec > 0 ? (durationSec * 1000) / total : 0
    const start = Date.now()
    let ok = 0, fail = 0, lastErr = ''
    for (let i = 1; i <= total; i++) {
      if (burstStop.current) break
      try {
        await api.publish(clusterId, {
          subject: substitute(baseSubject, vars, i),
          payload: substitute(activeTab.payload, vars, i),
          headers: headersArg,
        })
        ok++
      } catch (err: any) { fail++; lastErr = err?.message ?? 'publish failed' }
      setBurstSent(i)
      if (delay > 0 && i < total) await sleep(delay)
    }
    setBursting(false)
    setHistory(prev => [{
      id: ++historyId, tabId: activeTab.id, subject: baseSubject,
      payloadSize: activeTab.payload.length,
      result: fail === 0 ? { subject: baseSubject, accepted: true } : null,
      error: fail > 0 ? `${fail} failed${lastErr ? ` — ${lastErr}` : ''}` : null,
      ts: Date.now(),
      burst: { ok, fail, elapsedMs: Date.now() - start },
    }, ...prev].slice(0, 100))
  }, [clusterId, activeTab, loading, bursting, count, durationSec, vars])

  // Cleanup flash timer on unmount
  useEffect(() => () => { if (sendTimerRef.current) clearTimeout(sendTimerRef.current) }, [])

  if (!clusterId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="surface-card p-8 text-center space-y-2 max-w-sm">
          <Send className="w-7 h-7 text-text-muted mx-auto mb-3" />
          <p className="text-sm font-sans font-medium text-text-secondary">No cluster connected</p>
          <p className="text-xs font-sans text-text-muted">Connect to a NATS cluster via Settings first</p>
        </div>
      </div>
    )
  }

  const subject = activeTab?.subject ?? ''
  const payload = activeTab?.payload ?? ''
  const headers = activeTab?.headers ?? []

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: multi-tab compose panel ─────────────────────────────────── */}
      <div className="w-[460px] flex-shrink-0 border-r border-bg-border flex flex-col bg-bg-base">

        {/* ── Tab strip ───────────────────────────────────────────────────── */}
        <div className="flex items-end gap-0 px-2 pt-2 border-b border-bg-border bg-bg-surface flex-shrink-0">
          <div className="flex items-end gap-0.5 flex-1 min-w-0 overflow-x-auto scrollbar-none">
            {tabs.map(tab => (
              <TabChip
                key={tab.id}
                tab={tab}
                active={tab.id === activeTabId}
                canClose={tabs.length > 1}
                onClick={() => setActiveTabIdLocal(tab.id)}
                onClose={(e) => closeTab(tab.id, e)}
                onRename={(label) => renameTab(tab.id, label)}
              />
            ))}
          </div>
          {/* Add tab button */}
          <button
            onClick={addTab}
            title="New compose tab"
            className="mb-0.5 ml-1 flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Compose form ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Saved templates */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <button
                onClick={() => setShowSaved(v => !v)}
                onBlur={() => setTimeout(() => setShowSaved(false), 150)}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md border border-bg-border bg-bg-surface text-2xs font-sans text-text-secondary hover:border-bg-border-strong transition-colors"
              >
                <Bookmark className="w-3 h-3 text-accent-primary flex-shrink-0" />
                <span className="flex-1 text-left">{templates.length ? `Saved templates (${templates.length})` : 'No saved templates'}</span>
                <ChevronDown className="w-3 h-3 flex-shrink-0" />
              </button>
              {showSaved && templates.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-elevated border border-bg-border rounded-lg shadow-popover max-h-60 overflow-y-auto">
                  {templates.map(t => (
                    <div key={t.id} className="flex items-center gap-2 px-3 py-2 hover:bg-bg-hover group">
                      <button onMouseDown={() => loadTemplate(t)} className="flex-1 min-w-0 text-left">
                        <div className="text-xs font-sans text-text-primary truncate">{t.name}</div>
                        <div className="text-2xs font-mono text-text-muted truncate">{t.subject || '—'}</div>
                      </button>
                      <button onMouseDown={(e) => { e.preventDefault(); deleteTemplate(t.id) }} title="Delete"
                        className="text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {showSaveBox ? (
              <div className="flex items-center gap-1">
                <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTemplate(); if (e.key === 'Escape') setShowSaveBox(false) }}
                  placeholder="name" className="w-24 px-2 py-1.5 text-2xs font-sans bg-bg-surface border border-bg-border rounded-md outline-none focus:border-accent-primary/50 text-text-primary" />
                <button onClick={saveTemplate} className="px-2 py-1.5 rounded-md bg-accent-primary text-white text-2xs font-sans hover:bg-accent-primary-dim transition-colors">Save</button>
              </div>
            ) : (
              <button onClick={() => { setShowSaveBox(true); setSaveName('') }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-bg-border text-2xs font-sans text-text-secondary hover:border-accent-primary/40 hover:text-accent-primary transition-colors flex-shrink-0">
                <Save className="w-3 h-3" /> Save
              </button>
            )}
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <label className="text-2xs font-sans font-medium text-text-muted uppercase tracking-wide">
              Subject <span className="text-accent-red">*</span>
            </label>
            <div className="relative">
              <div className={cn(
                'flex items-center rounded-md border transition-colors',
                'bg-bg-surface border-bg-border',
                'focus-within:border-accent-primary/50',
              )}>
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

              {/* Autocomplete dropdown */}
              {showSugg && filteredSugg.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-elevated border border-bg-border rounded-lg shadow-popover max-h-52 overflow-y-auto">
                  {filteredSugg.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={() => pickSubject(s)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-hover text-left"
                    >
                      <span className="flex-1 text-xs font-mono text-text-primary truncate">{s.subject}</span>
                      {s.stream && (
                        <span className="flex items-center gap-1 text-2xs font-mono text-text-muted flex-shrink-0">
                          <Layers className="w-2.5 h-2.5" />
                          {s.stream}
                        </span>
                      )}
                      <Badge variant={s.source === 'stream' ? 'default' : 'ghost'} size="xs">
                        {s.source}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Payload */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-2xs font-sans font-medium text-text-muted uppercase tracking-wide">Payload</label>
              <button
                onClick={formatJSON}
                className="flex items-center gap-1 text-2xs font-sans text-text-muted hover:text-accent-primary transition-colors"
              >
                <Code2 className="w-3 h-3" /> Format JSON
              </button>
            </div>
            <textarea
              value={payload}
              onChange={e => setPayload(e.target.value)}
              placeholder={'{\n  "key": "value"\n}'}
              rows={9}
              className="w-full bg-bg-surface border border-bg-border rounded-md px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/50 resize-y transition-colors"
            />
            <p className="text-2xs font-mono text-text-muted">{formatBytes(payload.length)}</p>
          </div>

          {/* Headers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-2xs font-sans font-medium text-text-muted uppercase tracking-wide">
                Headers{headers.length > 0 && <span className="text-accent-primary ml-1 normal-case">({headers.length})</span>}
              </label>
              <button
                onClick={addHeader}
                className="flex items-center gap-1 text-2xs font-sans text-accent-primary hover:text-accent-primary/80 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {headers.length === 0 ? (
              <p className="text-2xs font-sans text-text-muted/50 italic">No custom headers</p>
            ) : (
              <div className="space-y-1.5">
                {headers.map((hdr, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={hdr.key}
                      onChange={e => updateHeader(i, 'key', e.target.value)}
                      placeholder="Header-Name"
                      className="input-base flex-1"
                    />
                    <span className="text-text-muted text-xs font-mono flex-shrink-0">:</span>
                    <input
                      type="text"
                      value={hdr.value}
                      onChange={e => updateHeader(i, 'value', e.target.value)}
                      placeholder="value"
                      className="input-base flex-1"
                    />
                    <button
                      onClick={() => removeHeader(i)}
                      className="text-text-muted hover:text-accent-red transition-colors p-0.5 flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Variables (detected {{placeholders}}) */}
          {(placeholders.custom.length > 0 || placeholders.builtin.length > 0) && (
            <div className="space-y-2">
              <label className="text-2xs font-sans font-medium text-text-muted uppercase tracking-wide flex items-center gap-1">
                <Braces className="w-3 h-3" /> Variables
              </label>
              {placeholders.builtin.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.builtin.map(t => (
                    <span key={t} title="auto-filled per message"
                      className="px-1.5 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-2xs font-mono text-accent-primary">
                      {`{{${t}}}`} <span className="text-text-muted">auto</span>
                    </span>
                  ))}
                </div>
              )}
              {placeholders.custom.map(t => (
                <div key={t} className="flex items-center gap-2">
                  <span className="w-28 flex-shrink-0 text-2xs font-mono text-text-secondary truncate">{`{{${t}}}`}</span>
                  <input value={vars[t] ?? ''} onChange={e => setVar(t, e.target.value)} placeholder="value" className="input-base flex-1" />
                </div>
              ))}
              <p className="text-2xs font-mono text-text-muted/70">
                built-ins: {'{{seq}} {{uuid}} {{timestamp}} {{rand}} {{rand:1:100}}'}
              </p>
            </div>
          )}

          {/* Count & rate */}
          <div className="space-y-2">
            <label className="text-2xs font-sans font-medium text-text-muted uppercase tracking-wide flex items-center gap-1">
              <Clock className="w-3 h-3" /> Count &amp; rate
            </label>
            <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
              <input type="number" min={1} max={10000} value={count}
                onChange={e => setCount(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
                className="w-20 px-2 py-1.5 bg-bg-surface border border-bg-border rounded-md text-text-primary outline-none focus:border-accent-primary/50 tabular-nums" />
              <span className="text-text-muted">msg{count === 1 ? '' : 's'}</span>
              <span className="text-text-muted">over</span>
              <input type="number" min={0} max={3600} value={durationSec}
                onChange={e => setDuration(Math.max(0, Math.min(3600, parseInt(e.target.value) || 0)))}
                className="w-16 px-2 py-1.5 bg-bg-surface border border-bg-border rounded-md text-text-primary outline-none focus:border-accent-primary/50 tabular-nums" />
              <span className="text-text-muted">sec</span>
              {count > 1 && (
                <span className="ml-auto text-2xs text-text-muted">
                  {durationSec > 0 ? `~${Math.max(1, Math.round(count / durationSec))}/s` : 'as fast as possible'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {[1, 10, 100, 1000].map(n => (
                <button key={n} onClick={() => setCount(n)}
                  className={cn('px-2 py-0.5 rounded text-2xs font-mono border transition-colors',
                    count === n ? 'border-accent-primary/40 text-accent-primary bg-accent-primary/5' : 'border-bg-border text-text-muted hover:text-text-secondary')}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Send / Burst */}
          {bursting ? (
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-bg-surface overflow-hidden border border-bg-border">
                <div className="h-full bg-accent-primary transition-all" style={{ width: `${(burstSent / Math.max(1, count)) * 100}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-2xs font-mono text-text-secondary tabular-nums">Publishing {burstSent} / {count}…</span>
                <button onClick={stopBurst}
                  className="flex items-center gap-1 px-3 h-8 rounded-md border border-accent-red/30 text-accent-red text-xs font-sans hover:bg-accent-red/10 transition-colors">
                  <Square className="w-3 h-3" /> Stop
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!subject.trim() || loading}
              className={cn(
                'w-full h-9 flex items-center justify-center gap-2 rounded-md text-xs font-sans font-medium transition-all duration-150',
                sendOk
                  ? 'bg-accent-green/15 border border-accent-green/30 text-accent-green'
                  : loading
                  ? 'bg-accent-primary/10 border border-accent-primary/20 text-accent-primary cursor-not-allowed'
                  : !subject.trim()
                  ? 'bg-bg-surface border border-bg-border text-text-muted cursor-not-allowed'
                  : 'bg-accent-primary text-white hover:bg-accent-primary-dim border border-transparent cursor-pointer',
              )}
            >
              {loading ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sending…</>
              ) : sendOk ? (
                <><CheckCircle2 className="w-3.5 h-3.5" /> Sent!</>
              ) : count > 1 ? (
                <><Send className="w-3.5 h-3.5" /> Publish {count}{durationSec > 0 ? ` over ${durationSec}s` : ''}</>
              ) : (
                <><Send className="w-3.5 h-3.5" /> Publish to NATS</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Right: publish history ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="px-4 h-11 border-b border-bg-border flex items-center gap-2 flex-shrink-0 bg-bg-base">
          <h2 className="text-xs font-sans font-semibold text-text-primary flex-1">Publish History</h2>
          {history.length > 0 && (
            <>
              <span className="text-2xs font-mono text-text-muted tabular-nums">
                {history.filter(e => e.result?.accepted).length}/{history.length} accepted
              </span>
              <button
                onClick={() => setHistory([])}
                className="text-2xs font-sans text-text-muted hover:text-accent-red transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<Send className="w-7 h-7" />}
              title="No messages sent yet"
              description="Published messages and their results appear here"
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-bg-border">
            {history.map(entry => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                tabLabel={tabs.find(t => t.id === entry.tabId)?.label}
                onResend={() => {
                  // Switch to the tab that sent this (or active tab) and fill subject
                  const targetTab = tabs.find(t => t.id === entry.tabId)
                  if (targetTab) setActiveTabIdLocal(targetTab.id)
                  setTabs(prev => prev.map(t =>
                    t.id === (targetTab?.id ?? activeTabId)
                      ? { ...t, subject: entry.subject }
                      : t,
                  ))
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab chip ──────────────────────────────────────────────────────────────────

function TabChip({ tab, active, canClose, onClick, onClose, onRename }: {
  tab: PublisherTab
  active: boolean
  canClose: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
  onRename: (label: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(tab.label)
  const inputRef = useRef<HTMLInputElement>(null)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== tab.label) onRename(trimmed)
    else setDraft(tab.label)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  return (
    <div
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
      title={active ? 'Double-click to rename' : tab.label}
      className={cn(
        'group flex items-center gap-1 px-3 py-1.5 rounded-t-md border-t border-l border-r cursor-pointer select-none transition-colors min-w-0 max-w-[160px] flex-shrink-0',
        active
          ? 'bg-bg-base border-bg-border border-b-bg-base -mb-px text-text-primary z-10 relative'
          : 'bg-bg-surface border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-hover',
      )}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setEditing(false); setDraft(tab.label) }
          }}
          onClick={e => e.stopPropagation()}
          className="w-20 bg-transparent text-xs font-sans outline-none border-b border-accent-primary/50"
        />
      ) : (
        <span className="text-xs font-sans truncate">
          {tab.subject
            ? <span className="font-mono text-2xs">{tab.subject}</span>
            : tab.label}
        </span>
      )}
      {canClose && (
        <button
          onClick={onClose}
          className={cn(
            'flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded transition-colors',
            'opacity-0 group-hover:opacity-100',
            active ? 'hover:bg-bg-hover text-text-muted hover:text-text-primary' : 'hover:bg-bg-active text-text-muted',
          )}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  )
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({ entry, tabLabel, onResend }: {
  entry: HistoryEntry
  tabLabel?: string
  onResend: () => void
}) {
  const ok = Boolean(entry.result?.accepted)

  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors group">
      <div className="mt-0.5 flex-shrink-0">
        {ok
          ? <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
          : <XCircle className="w-3.5 h-3.5 text-accent-red" />}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text-primary truncate flex-1">{entry.subject}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {tabLabel && (
              <span className="text-2xs font-sans text-text-muted/60">{tabLabel}</span>
            )}
            <span className="text-2xs font-mono text-text-muted tabular-nums">
              {formatTimestamp(new Date(entry.ts).toISOString())}
            </span>
          </div>
        </div>
        {entry.burst && (
          <p className="text-2xs font-mono text-text-secondary">
            burst · <span className="text-accent-green">{entry.burst.ok} sent</span>
            {entry.burst.fail > 0 && <> · <span className="text-accent-red">{entry.burst.fail} failed</span></>}
            {' · '}<span className="text-text-muted tabular-nums">{entry.burst.elapsedMs} ms</span>
          </p>
        )}
        {ok && entry.result && !entry.burst && (
          <p className="text-2xs font-mono text-accent-green">
            ✓ accepted
            {entry.result.stream && (
              <> → <span className="text-text-secondary">stream:{entry.result.stream}</span></>
            )}
            {entry.result.seq != null && entry.result.seq > 0 && (
              <> seq:<span className="text-text-secondary tabular-nums">{entry.result.seq}</span></>
            )}
          </p>
        )}
        {entry.error && <p className="text-2xs font-mono text-accent-red">{entry.error}</p>}
        <p className="text-2xs font-mono text-text-muted tabular-nums">{formatBytes(entry.payloadSize)}</p>
      </div>
      <button
        onClick={onResend}
        title="Load into compose tab"
        className="text-2xs font-sans text-text-muted hover:text-accent-primary transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
      >
        ↩
      </button>
    </div>
  )
}
