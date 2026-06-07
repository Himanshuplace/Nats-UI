/**
 * KVManager — JetStream Key-Value store browser & editor.
 *
 * Buckets → keys → value, with revision history and put / edit / delete / purge.
 * Backed by /clusters/{id}/kv/* (nats.go KeyValue API). KV is one of the most
 * heavily used JetStream features (config, feature flags, service state, locks)
 * so this gives developers first-class read/write access without the CLI.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, X, Save, Database, History as HistoryIcon, AlertTriangle, KeyRound,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, EmptyState, Badge, Stepper, cn } from '@/components/ui'
import { formatBytes, formatTimeAgo, formatNumber, tryParseJSON } from '@/lib/format'
import type { KVEntry, KVBucketConfig } from '@/types'

const inputClass =
  'w-full px-3 py-2 text-xs font-mono bg-bg-surface border border-bg-border rounded-lg ' +
  'text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/60 ' +
  'focus:ring-2 focus:ring-accent-primary/15 transition-all'

function opBadge(op: KVEntry['operation']) {
  if (op === 'DELETE') return <Badge variant="yellow" size="xs">DEL</Badge>
  if (op === 'PURGE')  return <Badge variant="red" size="xs">PURGE</Badge>
  return <Badge variant="violet" size="xs">PUT</Badge>
}

export function KVManager() {
  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId = activeClusters[0] ?? ''
  const qc = useQueryClient()

  const [bucket, setBucket]           = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [creatingKey, setCreatingKey] = useState(false)
  const [newKeyName, setNewKeyName]   = useState('')
  const [editor, setEditor]           = useState('')
  const [filter, setFilter]           = useState('')
  const [showNewBucket, setShowNewBucket] = useState(false)
  const [err, setErr]                 = useState('')

  const { data: buckets } = useQuery({
    queryKey: ['kv-buckets', clusterId],
    queryFn: () => api.kv.buckets(clusterId),
    enabled: Boolean(clusterId),
    refetchInterval: 10_000,
  })

  // Auto-select the first bucket once buckets load.
  useEffect(() => {
    if (!bucket && buckets && buckets.length > 0) setBucket(buckets[0].bucket)
  }, [buckets, bucket])

  const { data: keys, isLoading: keysLoading } = useQuery({
    queryKey: ['kv-keys', clusterId, bucket],
    queryFn: () => api.kv.keys(clusterId, bucket),
    enabled: Boolean(clusterId && bucket),
    refetchInterval: 5_000,
  })

  const selectedEntry = useMemo(
    () => keys?.find(k => k.key === selectedKey) ?? null,
    [keys, selectedKey],
  )

  // Load the selected key's value into the editor (but not while composing a new key).
  useEffect(() => {
    if (creatingKey) return
    setEditor(selectedEntry?.value ?? '')
    setErr('')
  }, [selectedEntry, creatingKey])

  const { data: history } = useQuery({
    queryKey: ['kv-history', clusterId, bucket, selectedKey],
    queryFn: () => api.kv.history(clusterId, bucket, selectedKey!),
    enabled: Boolean(clusterId && bucket && selectedKey && !creatingKey),
  })

  const putMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.kv.put(clusterId, bucket, key, value),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['kv-keys', clusterId, bucket] })
      qc.invalidateQueries({ queryKey: ['kv-history', clusterId, bucket, vars.key] })
      setCreatingKey(false)
      setSelectedKey(vars.key)
      setErr('')
    },
    onError: (e) => setErr((e as Error).message),
  })

  const delMut = useMutation({
    mutationFn: ({ key, purge }: { key: string; purge: boolean }) => api.kv.delete(clusterId, bucket, key, purge),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['kv-keys', clusterId, bucket] })
      if (selectedKey === vars.key) { setSelectedKey(null); setEditor('') }
    },
    onError: (e) => setErr((e as Error).message),
  })

  const delBucketMut = useMutation({
    mutationFn: (b: string) => api.kv.deleteBucket(clusterId, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kv-buckets', clusterId] })
      setBucket(''); setSelectedKey(null)
    },
  })

  const startNewKey = () => {
    setCreatingKey(true); setSelectedKey(null); setNewKeyName(''); setEditor(''); setErr('')
  }
  const save = () => {
    const key = (creatingKey ? newKeyName : selectedKey)?.trim()
    if (!key) { setErr('Key name is required'); return }
    putMut.mutate({ key, value: editor })
  }

  const filteredKeys = useMemo(() => {
    if (!keys) return []
    const f = filter.trim().toLowerCase()
    return f ? keys.filter(k => k.key.toLowerCase().includes(f)) : keys
  }, [keys, filter])

  const meta = buckets?.find(b => b.bucket === bucket)
  const jsonCheck = tryParseJSON(editor)
  const dirty = creatingKey || (selectedEntry != null && editor !== selectedEntry.value)

  if (!clusterId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState icon={<Database className="w-7 h-7" />} title="No cluster connected" description="Connect to a NATS server first" />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* ── Left: bucket selector + key list ── */}
      <div className="w-80 flex-shrink-0 border-r border-bg-border/50 flex flex-col glass">
        <div className="p-3 border-b border-bg-border space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Bucket</label>
            <button onClick={() => setShowNewBucket(true)}
              className="text-2xs font-mono text-accent-primary hover:text-accent-primary/80 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New
            </button>
          </div>
          <select value={bucket} onChange={e => { setBucket(e.target.value); setSelectedKey(null); setCreatingKey(false) }} className="select-base">
            <option value="">— select bucket —</option>
            {buckets?.map(b => <option key={b.bucket} value={b.bucket}>{b.bucket} ({formatNumber(b.values)} keys)</option>)}
          </select>
          {meta && (
            <div className="flex items-center justify-between text-2xs font-mono text-text-muted pt-0.5">
              <span>{formatNumber(meta.values)} keys · {formatBytes(meta.bytes)} · hist {meta.history}</span>
              <button
                onClick={() => { if (window.confirm(`Delete bucket "${bucket}" and ALL its data? This cannot be undone.`)) delBucketMut.mutate(bucket) }}
                className="text-text-muted hover:text-accent-red transition-colors" title="Delete bucket">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {bucket && (
          <div className="p-2 border-b border-bg-border flex items-center gap-2">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter keys…"
              className="flex-1 px-2 py-1 text-xs font-mono bg-bg-surface border border-bg-border rounded-lg text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/60" />
            <Button variant="primary" size="xs" onClick={startNewKey}><Plus className="w-3 h-3" /> Key</Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!bucket ? (
            <EmptyState icon={<KeyRound className="w-6 h-6" />} title="Select a bucket" />
          ) : keysLoading ? (
            <div className="p-4 text-center text-2xs font-mono text-text-muted">Loading keys…</div>
          ) : filteredKeys.length === 0 ? (
            <EmptyState icon={<KeyRound className="w-6 h-6" />} title={filter ? 'No matching keys' : 'No keys yet'} description={filter ? undefined : 'Click “Key” to add one'} />
          ) : (
            filteredKeys.map(k => {
              const sel = k.key === selectedKey && !creatingKey
              return (
                <button key={k.key} onClick={() => { setCreatingKey(false); setSelectedKey(k.key) }}
                  className={cn(
                    'w-full text-left px-3 py-2 border-b border-bg-border/50 transition-colors',
                    sel ? 'bg-accent-primary/5 border-l-2 border-l-accent-primary' : 'hover:bg-bg-hover',
                  )}>
                  <div className="flex items-center gap-2">
                    <span className={cn('flex-1 text-xs font-mono font-medium truncate', sel ? 'text-accent-primary' : 'text-text-primary')}>{k.key}</span>
                    <span className="text-2xs font-mono text-text-muted tabular-nums">r{k.revision}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="flex-1 text-2xs font-mono text-text-muted truncate">{k.value || <span className="italic opacity-60">empty</span>}</span>
                    <span className="text-2xs font-mono text-text-muted">{formatTimeAgo(k.created)}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: value editor + history ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!creatingKey && !selectedKey ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={<KeyRound className="w-8 h-8" />} title="Select a key"
              description="Inspect and edit its value, or browse revision history" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-bg-border/50 glass-sm flex-shrink-0">
              {creatingKey ? (
                <input autoFocus value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="new.key.name"
                  className="flex-1 px-2 py-1 text-sm font-mono bg-bg-surface border border-bg-border rounded-lg text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/60" />
              ) : (
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-mono font-semibold text-text-primary truncate">{selectedKey}</h2>
                  {selectedEntry && (
                    <p className="text-2xs font-mono text-text-muted">
                      rev {selectedEntry.revision} · {formatBytes(selectedEntry.size)} · {formatTimeAgo(selectedEntry.created)}
                      {jsonCheck.ok && <span className="text-accent-primary ml-2">JSON</span>}
                    </p>
                  )}
                </div>
              )}
              <Button variant="primary" size="sm" onClick={save} disabled={putMut.isPending || (!dirty && !creatingKey)}>
                <Save className="w-3.5 h-3.5" /> {putMut.isPending ? 'Saving…' : creatingKey ? 'Create' : 'Save'}
              </Button>
              {!creatingKey && selectedKey && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => delMut.mutate({ key: selectedKey, purge: false })} title="Delete (keeps history)">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </Button>
                  <Button variant="danger" size="sm"
                    onClick={() => { if (window.confirm(`Purge "${selectedKey}" and all its history?`)) delMut.mutate({ key: selectedKey, purge: true }) }}
                    title="Purge (removes all history)">
                    Purge
                  </Button>
                </>
              )}
              <button onClick={() => { setCreatingKey(false); setSelectedKey(null) }} className="text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
            </div>

            {err && (
              <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded-lg text-xs font-mono text-accent-red">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {err}
              </div>
            )}

            {/* Value editor + history */}
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col p-5 min-w-0">
                <label className="text-2xs font-mono text-text-muted uppercase tracking-widest mb-2 flex items-center justify-between">
                  <span>Value</span>
                  {!jsonCheck.ok && editor.trim().startsWith('{') && <span className="text-accent-yellow normal-case tracking-normal">⚠ invalid JSON</span>}
                </label>
                <textarea value={editor} onChange={e => setEditor(e.target.value)} spellCheck={false}
                  placeholder="value (text or JSON)…"
                  className="flex-1 w-full p-3 text-xs font-mono leading-relaxed bg-bg-base border border-bg-border rounded-lg text-text-primary placeholder-text-muted outline-none resize-none focus:border-accent-primary/60 focus:ring-2 focus:ring-accent-primary/15" />
                {jsonCheck.ok && (
                  <button onClick={() => setEditor(jsonCheck.pretty)} className="self-start mt-2 text-2xs font-mono text-accent-primary hover:text-accent-primary/80">
                    Format JSON
                  </button>
                )}
              </div>

              {/* History */}
              {!creatingKey && (
                <div className="w-72 flex-shrink-0 border-l border-bg-border/50 flex flex-col">
                  <div className="px-3 py-2 border-b border-bg-border flex items-center gap-2 text-2xs font-mono text-text-muted uppercase tracking-widest">
                    <HistoryIcon className="w-3.5 h-3.5" /> History
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {!history || history.length === 0 ? (
                      <div className="p-3 text-2xs font-mono text-text-muted">No revisions</div>
                    ) : (
                      [...history].reverse().map(h => (
                        <button key={h.revision} onClick={() => setEditor(h.value)}
                          className="w-full text-left px-3 py-2 border-b border-bg-border/40 hover:bg-bg-hover transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-2xs font-mono text-text-secondary tabular-nums">rev {h.revision}</span>
                            {opBadge(h.operation)}
                            <span className="ml-auto text-2xs font-mono text-text-muted">{formatTimeAgo(h.created)}</span>
                          </div>
                          <p className="text-2xs font-mono text-text-muted truncate mt-0.5">{h.value || <span className="italic opacity-60">—</span>}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showNewBucket && (
        <NewBucketModal
          onClose={() => setShowNewBucket(false)}
          onCreate={async (cfg) => {
            await api.kv.createBucket(clusterId, cfg)
            qc.invalidateQueries({ queryKey: ['kv-buckets', clusterId] })
            setBucket(cfg.bucket)
            setShowNewBucket(false)
          }}
        />
      )}
    </div>
  )
}

// ── New bucket modal ────────────────────────────────────────────────────────────

function NewBucketModal({ onClose, onCreate }: { onClose: () => void; onCreate: (cfg: KVBucketConfig) => Promise<void> }) {
  const [name, setName]       = useState('')
  const [description, setDesc] = useState('')
  const [history, setHistory] = useState(1)
  const [ttl, setTtl]         = useState(0)
  const [replicas, setReplicas] = useState(1)
  const [storage, setStorage] = useState<'file' | 'memory'>('file')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  const create = async () => {
    if (!name.trim()) { setError('Bucket name is required'); return }
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) { setError('Bucket name may only contain letters, numbers, - and _'); return }
    setBusy(true); setError('')
    try {
      await onCreate({ bucket: name.trim(), description: description.trim(), history, ttl, storage, replicas, maxValueSize: 0 })
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="surface-card w-[28rem] p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-mono font-bold text-text-primary">New KV Bucket</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Bucket Name</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="app-config" className={inputClass} />
          </div>
          <div>
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Description <span className="opacity-60 normal-case">(optional)</span></label>
            <input value={description} onChange={e => setDesc(e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">History (revisions/key)</label>
              <Stepper size="md" min={1} max={64} value={history} onChange={setHistory} label="History" />
            </div>
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Replicas</label>
              <Stepper size="md" min={1} max={5} value={replicas} onChange={setReplicas} label="Replicas" />
            </div>
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">TTL (seconds, 0 = ∞)</label>
              <Stepper size="md" min={0} step={60} value={ttl} onChange={setTtl} suffix="s" label="TTL seconds" />
            </div>
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Storage</label>
              <select value={storage} onChange={e => setStorage(e.target.value as 'file' | 'memory')} className="select-base">
                <option value="file">File</option>
                <option value="memory">Memory</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded-lg text-xs font-mono text-accent-red">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="primary" size="sm" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create Bucket'}</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
