/**
 * StreamBackupRestore — logical backup & restore for JetStream streams.
 *
 * Backup captures a stream's config + stored messages into a portable JSON
 * archive (downloaded client-side). Restore uploads such an archive and
 * republishes every message into a target stream, optionally recreating the
 * stream from the captured config first. This is a *logical* copy — payloads,
 * subjects and headers are preserved exactly; sequence numbers and timestamps
 * are reassigned by the server on republish. Great for cloning a stream to a
 * new name, seeding test environments, or snapshotting before a risky change.
 */
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Archive, Download, Upload, Database, RotateCcw, CheckCircle2, AlertTriangle, FileJson, X,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import { Button, Badge, EmptyState, Spinner, cn } from '@/components/ui'
import { formatBytes, formatNumber } from '@/lib/format'
import type { StreamBackup, RestoreResult } from '@/types'

export function StreamBackupRestore() {
  const clusterId = useUIStore(s => s.activeClusters[0] ?? '')

  if (!clusterId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState icon={<Archive className="w-7 h-7" />} title="No cluster connected" description="Connect to a NATS server first" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid gap-4 max-w-5xl mx-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
        <BackupPanel clusterId={clusterId} />
        <RestorePanel clusterId={clusterId} />
      </div>
    </div>
  )
}

// ── Backup ────────────────────────────────────────────────────────────────────

function BackupPanel({ clusterId }: { clusterId: string }) {
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ stream: string; count: number; bytes: number; truncated: boolean } | null>(null)

  const { data: streams, isLoading } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
    enabled: Boolean(clusterId),
  })

  const list = streams ?? []
  const active = list.find(s => s.config.name === selected)

  const runBackup = async () => {
    if (!selected) return
    setBusy(true); setError(''); setDone(null)
    try {
      const backup = await api.streams.backup(clusterId, selected)
      // Trigger a client-side download of the archive.
      const json = JSON.stringify(backup, null, 2)
      const bytes = new Blob([json]).size
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selected}-backup-${ts}.natsui.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setDone({ stream: selected, count: backup.messageCount, bytes, truncated: Boolean(backup.truncated) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'backup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="surface-card p-5 flex flex-col">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20">
          <Download className="w-4 h-4 text-accent-primary" />
        </div>
        <div>
          <h2 className="text-sm font-sans font-semibold text-text-primary tracking-tight">Backup a stream</h2>
          <p className="text-2xs font-mono text-text-muted">config + messages → downloadable archive</p>
        </div>
      </div>

      <label className="block mt-4 text-2xs font-sans text-text-muted mb-1.5">Stream</label>
      {isLoading ? (
        <div className="py-4"><Spinner size="sm" /></div>
      ) : list.length === 0 ? (
        <div className="text-xs font-mono text-text-muted py-3">No streams on this cluster.</div>
      ) : (
        <select
          value={selected}
          onChange={e => { setSelected(e.target.value); setDone(null); setError('') }}
          className="w-full bg-bg-secondary border border-bg-border rounded-lg px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
        >
          <option value="">Select a stream…</option>
          {list.map(s => (
            <option key={s.config.name} value={s.config.name}>{s.config.name}</option>
          ))}
        </select>
      )}

      {active && (
        <div className="mt-3 flex items-center gap-4 text-2xs font-mono text-text-muted">
          <span><span className="text-text-secondary tabular-nums">{formatNumber(active.state.messages)}</span> msgs</span>
          <span><span className="text-text-secondary tabular-nums">{formatBytes(active.state.bytes)}</span></span>
          <span><span className="text-text-secondary">{active.config.subjects.join(', ')}</span></span>
        </div>
      )}

      <Button variant="primary" size="sm" className="mt-4 self-start" onClick={runBackup} disabled={!selected || busy}>
        {busy ? <><Spinner size="xs" /> Backing up…</> : <><Download className="w-3.5 h-3.5" /> Create backup</>}
      </Button>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent-red/10 border border-accent-red/20 px-3 py-2 text-2xs font-mono text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {error}
        </div>
      )}
      {done && (
        <div className="mt-3 rounded-lg bg-accent-green/10 border border-accent-green/20 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-mono text-accent-green">
            <CheckCircle2 className="w-4 h-4" /> Downloaded <span className="font-semibold">{done.stream}</span>
          </div>
          <div className="mt-1 text-2xs font-mono text-text-muted">
            {formatNumber(done.count)} messages · {formatBytes(done.bytes)} archive
          </div>
          {done.truncated && (
            <div className="mt-1.5 flex items-center gap-1.5 text-2xs font-mono text-accent-yellow">
              <AlertTriangle className="w-3 h-3" /> capped — backup truncated (large stream)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Restore ─────────────────────────────────────────────────────────────────

function RestorePanel({ clusterId }: { clusterId: string }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [backup, setBackup] = useState<StreamBackup | null>(null)
  const [fileName, setFileName] = useState('')
  const [target, setTarget] = useState('')
  const [createStream, setCreateStream] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RestoreResult | null>(null)

  const pick = () => fileRef.current?.click()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(''); setResult(null); setBackup(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as StreamBackup
      if (!parsed || typeof parsed.stream !== 'string' || !Array.isArray(parsed.messages)) {
        throw new Error('not a NatsUI stream backup archive')
      }
      setBackup(parsed)
      setFileName(file.name)
      setTarget(parsed.stream)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read file')
    }
  }

  const clear = () => {
    setBackup(null); setFileName(''); setTarget(''); setResult(null); setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const runRestore = async () => {
    if (!backup) return
    setBusy(true); setError(''); setResult(null)
    try {
      const res = await api.streams.restore(clusterId, { targetStream: target.trim() || undefined, createStream, backup })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'restore failed')
    } finally {
      setBusy(false)
    }
  }

  const cfgSummary = useMemo(() => {
    if (!backup) return ''
    const c = backup.config
    return `${c.subjects?.join(', ') || '—'} · ${c.storage} · ${c.retention} · R${c.replicas || 1}`
  }, [backup])

  return (
    <div className="surface-card p-5 flex flex-col">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20">
          <Upload className="w-4 h-4 text-accent-cyan" />
        </div>
        <div>
          <h2 className="text-sm font-sans font-semibold text-text-primary tracking-tight">Restore from archive</h2>
          <p className="text-2xs font-mono text-text-muted">upload a .natsui.json → republish messages</p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={e => onFile(e.target.files?.[0])}
      />

      {!backup ? (
        <button
          onClick={pick}
          className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-bg-border hover:border-accent-cyan/50 hover:bg-bg-hover/30 transition-colors py-8 text-text-muted"
        >
          <FileJson className="w-7 h-7" />
          <span className="text-xs font-mono">Click to choose a backup archive</span>
        </button>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-bg-secondary/50 border border-bg-border/50 px-3 py-2">
            <FileJson className="w-4 h-4 text-accent-cyan flex-shrink-0" />
            <span className="text-2xs font-mono text-text-secondary truncate flex-1">{fileName}</span>
            <button onClick={clear} className="text-text-muted hover:text-text-primary"><X className="w-3.5 h-3.5" /></button>
          </div>

          {/* Archive preview */}
          <div className="mt-3 rounded-lg border border-bg-border/50 p-3">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-accent-primary" />
              <span className="text-sm font-mono font-semibold text-text-primary">{backup.stream}</span>
              <Badge variant="violet" size="xs">{formatNumber(backup.messageCount)} msgs</Badge>
              {backup.truncated && <Badge variant="yellow" size="xs">truncated</Badge>}
            </div>
            <div className="mt-1.5 text-2xs font-mono text-text-muted truncate" title={cfgSummary}>{cfgSummary}</div>
            <div className="mt-0.5 text-2xs font-mono text-text-muted">captured {new Date(backup.capturedAt).toLocaleString()}</div>
          </div>

          {/* Target */}
          <label className="block mt-4 text-2xs font-sans text-text-muted mb-1.5">Target stream</label>
          <input
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder={backup.stream}
            className="w-full bg-bg-secondary border border-bg-border rounded-lg px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
          />
          {target.trim() && target.trim() !== backup.stream && (
            <p className="mt-1 text-2xs font-mono text-accent-cyan">cloning into a different stream name</p>
          )}

          <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={createStream} onChange={e => setCreateStream(e.target.checked)} className="accent-[var(--accent-primary)] w-3.5 h-3.5" />
            <span className="text-2xs font-mono text-text-secondary">Create the stream from the backup config if it doesn't exist</span>
          </label>

          <Button variant="primary" size="sm" className="mt-4 self-start" onClick={runRestore} disabled={busy}>
            {busy ? <><Spinner size="xs" /> Restoring…</> : <><RotateCcw className="w-3.5 h-3.5" /> Restore {formatNumber(backup.messageCount)} messages</>}
          </Button>
        </>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent-red/10 border border-accent-red/20 px-3 py-2 text-2xs font-mono text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {error}
        </div>
      )}
      {result && (
        <div className="mt-3 rounded-lg bg-accent-green/10 border border-accent-green/20 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-mono text-accent-green">
            <CheckCircle2 className="w-4 h-4" /> Restored into <span className="font-semibold">{result.targetStream}</span>
            {result.streamCreated && <Badge variant="green" size="xs">stream created</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-2xs font-mono text-text-muted">
            <span><span className="text-accent-green tabular-nums">{formatNumber(result.restored)}</span> restored</span>
            {result.failed > 0 && <span><span className="text-accent-red tabular-nums">{formatNumber(result.failed)}</span> failed</span>}
            <span><span className="text-text-secondary tabular-nums">{formatNumber(result.total)}</span> total</span>
          </div>
          {result.error && <div className="mt-1 text-2xs font-mono text-accent-yellow">{result.error}</div>}
        </div>
      )}
    </div>
  )
}
