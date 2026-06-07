/**
 * ObjectStore — JetStream Object Store browser.
 *
 * Buckets → objects → metadata + content, with view / download / delete, file
 * upload, quick text objects, and create/delete bucket. Completes the
 * Stream / KV / Object-Store trifecta. Object bytes move as base64 (size-capped
 * at 16 MiB for view/download). Backed by /clusters/{id}/obj/*.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, X, Save, Package, Upload, Download, Database, AlertTriangle, FileText,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, EmptyState, Stepper, cn } from '@/components/ui'
import { formatBytes, formatTimeAgo, formatNumber } from '@/lib/format'
import type { ObjectBucketConfig } from '@/types'

// ── base64 <-> bytes ────────────────────────────────────────────────────────────
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  return btoa(bin)
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function decodeText(b64: string): { text: string; binary: boolean } {
  try {
    const bytes = b64ToBytes(b64)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    let ctrl = 0
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) ctrl++   // control chars / replacement char
    }
    return { text, binary: ctrl > text.length * 0.05 + 1 }
  } catch { return { text: '', binary: true } }
}

const inputClass =
  'w-full px-3 py-2 text-xs font-mono bg-bg-surface border border-bg-border rounded-lg ' +
  'text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/60 ' +
  'focus:ring-2 focus:ring-accent-primary/15 transition-all'

export function ObjectStore() {
  const clusterId = useUIStore(s => s.activeClusters[0] ?? '')
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [bucket, setBucket]           = useState('')
  const [selected, setSelected]       = useState<string | null>(null)
  const [creatingText, setCreatingText] = useState(false)
  const [newName, setNewName]         = useState('')
  const [textBody, setTextBody]       = useState('')
  const [filter, setFilter]           = useState('')
  const [showNewBucket, setShowNewBucket] = useState(false)
  const [err, setErr]                 = useState('')
  const [busy, setBusy]               = useState(false)

  const { data: buckets } = useQuery({
    queryKey: ['obj-buckets', clusterId],
    queryFn: () => api.obj.buckets(clusterId),
    enabled: Boolean(clusterId),
    refetchInterval: 10_000,
  })
  useEffect(() => { if (!bucket && buckets && buckets.length > 0) setBucket(buckets[0].bucket) }, [buckets, bucket])

  const { data: objects, isLoading } = useQuery({
    queryKey: ['obj-list', clusterId, bucket],
    queryFn: () => api.obj.objects(clusterId, bucket),
    enabled: Boolean(clusterId && bucket),
    refetchInterval: 8_000,
  })

  const { data: objData, isFetching: loadingObj } = useQuery({
    queryKey: ['obj-data', clusterId, bucket, selected],
    queryFn: () => api.obj.get(clusterId, bucket, selected!),
    enabled: Boolean(clusterId && bucket && selected && !creatingText),
  })

  const meta = buckets?.find(b => b.bucket === bucket)
  const selectedEntry = objects?.find(o => o.name === selected) ?? null

  const refreshList = () => qc.invalidateQueries({ queryKey: ['obj-list', clusterId, bucket] })

  const onUpload = async (file: File) => {
    setBusy(true); setErr('')
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      await api.obj.put(clusterId, bucket, file.name, { base64: bytesToB64(buf) })
      refreshList(); setSelected(file.name); setCreatingText(false)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const saveText = async () => {
    const name = newName.trim()
    if (!name) { setErr('Object name is required'); return }
    setBusy(true); setErr('')
    try {
      await api.obj.put(clusterId, bucket, name, { text: textBody })
      refreshList(); setCreatingText(false); setSelected(name)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const delObj = async (name: string) => {
    setBusy(true); setErr('')
    try { await api.obj.delete(clusterId, bucket, name); refreshList(); if (selected === name) setSelected(null) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const delBucket = async () => {
    if (!window.confirm(`Delete object bucket "${bucket}" and ALL its objects? This cannot be undone.`)) return
    try { await api.obj.deleteBucket(clusterId, bucket); qc.invalidateQueries({ queryKey: ['obj-buckets', clusterId] }); setBucket(''); setSelected(null) }
    catch (e) { setErr((e as Error).message) }
  }

  const download = () => {
    if (!objData || !selected) return
    const blob = new Blob([b64ToBytes(objData.base64) as BlobPart])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = selected; a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = useMemo(() => {
    if (!objects) return []
    const f = filter.trim().toLowerCase()
    return f ? objects.filter(o => o.name.toLowerCase().includes(f)) : objects
  }, [objects, filter])

  const startText = () => { setCreatingText(true); setSelected(null); setNewName(''); setTextBody(''); setErr('') }

  if (!clusterId) {
    return <div className="flex-1 flex items-center justify-center"><EmptyState icon={<Database className="w-7 h-7" />} title="No cluster connected" description="Connect to a NATS server first" /></div>
  }

  const decoded = objData && !objData.tooLarge ? decodeText(objData.base64) : null

  return (
    <div className="flex h-full">
      <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f) }} />

      {/* ── Left: bucket + objects ── */}
      <div className="w-80 flex-shrink-0 border-r border-bg-border/50 flex flex-col glass">
        <div className="p-3 border-b border-bg-border space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest">Bucket</label>
            <button onClick={() => setShowNewBucket(true)} className="text-2xs font-mono text-accent-primary hover:text-accent-primary/80 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New
            </button>
          </div>
          <select value={bucket} onChange={e => { setBucket(e.target.value); setSelected(null); setCreatingText(false) }} className="select-base">
            <option value="">— select bucket —</option>
            {buckets?.map(b => <option key={b.bucket} value={b.bucket}>{b.bucket} ({formatBytes(b.size)})</option>)}
          </select>
          {meta && (
            <div className="flex items-center justify-between text-2xs font-mono text-text-muted pt-0.5">
              <span>{formatBytes(meta.size)} · {objects?.length ?? 0} objects</span>
              <button onClick={delBucket} className="text-text-muted hover:text-accent-red transition-colors" title="Delete bucket"><Trash2 className="w-3 h-3" /></button>
            </div>
          )}
        </div>

        {bucket && (
          <div className="p-2 border-b border-bg-border flex items-center gap-1.5">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…"
              className="flex-1 px-2 py-1 text-xs font-mono bg-bg-surface border border-bg-border rounded-lg text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/60" />
            <Button variant="ghost" size="xs" onClick={startText} title="New text object"><FileText className="w-3 h-3" /></Button>
            <Button variant="primary" size="xs" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="w-3 h-3" /></Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!bucket ? <EmptyState icon={<Package className="w-6 h-6" />} title="Select a bucket" />
            : isLoading ? <div className="p-4 text-center text-2xs font-mono text-text-muted">Loading…</div>
            : filtered.length === 0 ? <EmptyState icon={<Package className="w-6 h-6" />} title={filter ? 'No matches' : 'No objects'} description={filter ? undefined : 'Upload a file or add a text object'} />
            : filtered.map(o => {
              const sel = o.name === selected && !creatingText
              return (
                <button key={o.name} onClick={() => { setCreatingText(false); setSelected(o.name) }}
                  className={cn('w-full text-left px-3 py-2 border-b border-bg-border/50 transition-colors', sel ? 'bg-accent-primary/5 border-l-2 border-l-accent-primary' : 'hover:bg-bg-hover')}>
                  <div className={cn('text-xs font-mono font-medium truncate', sel ? 'text-accent-primary' : 'text-text-primary')}>{o.name}</div>
                  <div className="flex items-center gap-2 mt-0.5 text-2xs font-mono text-text-muted">
                    <span>{formatBytes(o.size)}</span><span>·</span><span>{o.chunks} chunk{o.chunks === 1 ? '' : 's'}</span>
                    <span className="ml-auto">{formatTimeAgo(o.modTime)}</span>
                  </div>
                </button>
              )
            })}
        </div>
      </div>

      {/* ── Right: object detail / new text ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {creatingText ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-bg-border/50 glass-sm">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="object.name.txt" className="flex-1 px-2 py-1 text-sm font-mono bg-bg-surface border border-bg-border rounded-lg text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/60" />
              <Button variant="primary" size="sm" onClick={saveText} disabled={busy}><Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Create'}</Button>
              <button onClick={() => setCreatingText(false)} className="text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
            </div>
            <textarea value={textBody} onChange={e => setTextBody(e.target.value)} spellCheck={false} placeholder="object content (text)…"
              className="flex-1 m-5 p-3 text-xs font-mono leading-relaxed bg-bg-base border border-bg-border rounded-lg text-text-primary placeholder-text-muted outline-none resize-none focus:border-accent-primary/60" />
          </div>
        ) : !selected ? (
          <div className="flex-1 flex items-center justify-center"><EmptyState icon={<Package className="w-8 h-8" />} title="Select an object" description="View its metadata and content, download, or delete it" /></div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-bg-border/50 glass-sm flex-shrink-0">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-mono font-semibold text-text-primary truncate">{selected}</h2>
                {selectedEntry && (
                  <p className="text-2xs font-mono text-text-muted">
                    {formatBytes(selectedEntry.size)} · {selectedEntry.chunks} chunk{selectedEntry.chunks === 1 ? '' : 's'} · {formatTimeAgo(selectedEntry.modTime)}
                    {selectedEntry.digest && <span className="ml-2 opacity-70">{selectedEntry.digest.slice(0, 18)}…</span>}
                  </p>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={download} disabled={!objData || objData.tooLarge}><Download className="w-3.5 h-3.5" /> Download</Button>
              <Button variant="danger" size="sm" onClick={() => delObj(selected)} disabled={busy}><Trash2 className="w-3.5 h-3.5" /> Delete</Button>
            </div>

            {err && <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded-lg text-xs font-mono text-accent-red"><AlertTriangle className="w-3.5 h-3.5" /> {err}</div>}

            <div className="flex-1 overflow-auto p-5">
              {loadingObj ? <div className="text-2xs font-mono text-text-muted">Loading…</div>
                : objData?.tooLarge ? <div className="surface-card p-5 text-sm font-mono text-text-secondary">Object is {formatNumber(objData.size)} bytes — too large to preview in the browser (16 MB limit). Use the NATS CLI to fetch it.</div>
                : decoded?.binary ? <div className="surface-card p-5 text-sm font-mono text-text-secondary">Binary object ({formatBytes(objData?.size ?? 0)}) — no text preview. Use <span className="text-accent-primary">Download</span> to save it.</div>
                : <pre className="font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap break-words bg-bg-base border border-bg-border rounded-lg p-4">{decoded?.text || <span className="italic text-text-muted">empty</span>}</pre>}
            </div>
          </div>
        )}
      </div>

      {showNewBucket && <NewObjectBucket onClose={() => setShowNewBucket(false)} onCreate={async (cfg) => { await api.obj.createBucket(clusterId, cfg); qc.invalidateQueries({ queryKey: ['obj-buckets', clusterId] }); setBucket(cfg.bucket); setShowNewBucket(false) }} />}
    </div>
  )
}

function NewObjectBucket({ onClose, onCreate }: { onClose: () => void; onCreate: (cfg: ObjectBucketConfig) => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDesc] = useState('')
  const [ttl, setTtl] = useState(0)
  const [replicas, setReplicas] = useState(1)
  const [storage, setStorage] = useState<'file' | 'memory'>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) { setError('Bucket name may only contain letters, numbers, - and _'); return }
    setBusy(true); setError('')
    try { await onCreate({ bucket: name.trim(), description: description.trim(), ttl, storage, replicas }) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="surface-card w-[28rem] p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-mono font-bold text-text-primary">New Object Bucket</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Bucket Name</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="assets" className={inputClass} />
          </div>
          <div>
            <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Description <span className="opacity-60 normal-case">(optional)</span></label>
            <input value={description} onChange={e => setDesc(e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">Replicas</label>
              <Stepper size="md" min={1} max={5} value={replicas} onChange={setReplicas} label="Replicas" />
            </div>
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">TTL (s, 0=∞)</label>
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
        {error && <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded-lg text-xs font-mono text-accent-red"><AlertTriangle className="w-3.5 h-3.5" /> {error}</div>}
        <div className="flex gap-3 pt-1">
          <Button variant="primary" size="sm" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create Bucket'}</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
