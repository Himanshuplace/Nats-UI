import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Play, Square, Clock, Hash, Filter, Zap } from 'lucide-react'
import { useUIStore, useDataStore } from '@/store'
import { ws } from '@/lib/ws'
import { api } from '@/lib/api'
import {
  Button, Badge, StatCard, EmptyState, Spinner, cn,
} from '@/components/ui'
import { formatNumber, formatHHMMSS } from '@/lib/format'
import type { ReplayConfig, ReplayProgress } from '@/types'

let replayCounter = 0
function newReplayId(): string {
  return `replay-${++replayCounter}-${Date.now()}`
}

type StartMode = 'seq' | 'time' | 'beginning'

export function ReplayStudio() {
  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId = activeClusters[0] ?? 'default'
  const replays = useDataStore(s => s.replay)

  const [stream,       setStream]       = useState('')
  const [mode,         setMode]         = useState<StartMode>('beginning')
  const [startSeq,     setStartSeq]     = useState('')
  const [startTime,    setStartTime]    = useState('')
  const [endSeq,       setEndSeq]       = useState('')
  const [throttleMs,   setThrottleMs]   = useState('0')
  const [filterSubj,   setFilterSubj]   = useState('')
  const [shadowSubj,   setShadowSubj]   = useState('')

  const { data: streams } = useQuery({
    queryKey: ['streams', clusterId],
    queryFn: () => api.streams.list(clusterId),
  })

  const handleStart = useCallback(() => {
    if (!stream) return

    const id = newReplayId()
    const config: ReplayConfig = {
      id,
      clusterId,
      stream,
      consumerName: `natsui-replay-${id}`,
      throttleMs:   parseInt(throttleMs) || 0,
      filterSubject: filterSubj || undefined,
      shadowSubject: shadowSubj || undefined,
    }

    if (mode === 'seq' && startSeq) config.startSeq = parseInt(startSeq)
    if (mode === 'time' && startTime) config.startTime = new Date(startTime).toISOString()
    if (endSeq) config.endSeq = parseInt(endSeq)

    ws.send('replay.start', config)
  }, [stream, mode, startSeq, startTime, endSeq, throttleMs, filterSubj, shadowSubj, clusterId])

  const handleStop = useCallback((id: string) => {
    ws.send('replay.stop', { id })
  }, [])

  const activeReplays = Object.values(replays).filter(r => !r.done && !r.error)
  const doneReplays   = Object.values(replays).filter(r => r.done || r.error)

  return (
    <div className="flex h-full bg-bg-base">
      {/* Config panel */}
      <div className="w-96 flex-shrink-0 border-r border-bg-border overflow-y-auto">
        <div className="p-5 space-y-5">
          <div>
            <h2 className="text-sm font-mono font-bold text-text-primary mb-0.5">Replay Studio</h2>
            <p className="text-2xs font-mono text-text-muted">
              Replay historical messages with precise control over timing and routing
            </p>
          </div>

          {/* Stream */}
          <Field label="Stream">
            <select
              value={stream}
              onChange={e => setStream(e.target.value)}
              className="input-base"
            >
              <option value="">— select stream —</option>
              {streams?.map(s => (
                <option key={s.config.name} value={s.config.name}>{s.config.name}</option>
              ))}
            </select>
          </Field>

          {/* Start mode */}
          <Field label="Start from">
            <div className="flex gap-1">
              {(['beginning', 'seq', 'time'] as StartMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex-1 px-2 py-1 text-2xs font-mono rounded border transition-colors',
                    mode === m
                      ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
                      : 'bg-bg-surface border-bg-border text-text-muted hover:text-text-secondary',
                  )}
                >
                  {m === 'beginning' ? 'Beginning' : m === 'seq' ? 'Sequence' : 'Timestamp'}
                </button>
              ))}
            </div>

            {mode === 'seq' && (
              <input
                type="number"
                placeholder="Start sequence number"
                value={startSeq}
                onChange={e => setStartSeq(e.target.value)}
                className="input-base mt-2"
              />
            )}
            {mode === 'time' && (
              <input
                type="datetime-local"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="input-base mt-2"
              />
            )}
          </Field>

          {/* End sequence */}
          <Field label="End at sequence (optional)">
            <input
              type="number"
              placeholder="End sequence (leave blank for all)"
              value={endSeq}
              onChange={e => setEndSeq(e.target.value)}
              className="input-base"
            />
          </Field>

          {/* Throttle */}
          <Field label={`Throttle — ${throttleMs}ms between messages`}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="5000"
                step="10"
                value={throttleMs}
                onChange={e => setThrottleMs(e.target.value)}
                className="flex-1 accent-accent-cyan"
              />
              <span className="text-xs font-mono text-text-muted w-16 text-right">
                {parseInt(throttleMs) === 0 ? 'Instant' : `${throttleMs}ms`}
              </span>
            </div>
          </Field>

          {/* Filter */}
          <Field label="Filter subject (optional)">
            <input
              type="text"
              placeholder="e.g. orders.created.*"
              value={filterSubj}
              onChange={e => setFilterSubj(e.target.value)}
              className="input-base"
            />
          </Field>

          {/* Shadow */}
          <Field label="Shadow subject (optional)">
            <input
              type="text"
              placeholder="e.g. shadow.orders.*"
              value={shadowSubj}
              onChange={e => setShadowSubj(e.target.value)}
              className="input-base"
            />
            <p className="text-2xs font-mono text-text-muted mt-1">
              Replay into a shadow consumer subject for safe testing
            </p>
          </Field>

          {/* Start button */}
          <Button
            variant="primary"
            size="md"
            onClick={handleStart}
            disabled={!stream}
            className="w-full justify-center"
          >
            <Play className="w-4 h-4" />
            Start Replay
          </Button>
        </div>
      </div>

      {/* Right: active + history */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Active replays */}
        {activeReplays.length > 0 && (
          <section>
            <h3 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest mb-3">
              Active Replays
            </h3>
            <div className="space-y-3">
              {activeReplays.map(r => (
                <ReplayCard key={r.id} replay={r} onStop={() => handleStop(r.id)} />
              ))}
            </div>
          </section>
        )}

        {/* Done replays */}
        {doneReplays.length > 0 && (
          <section>
            <h3 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest mb-3">
              History
            </h3>
            <div className="space-y-3">
              {doneReplays.map(r => (
                <ReplayCard key={r.id} replay={r} done />
              ))}
            </div>
          </section>
        )}

        {activeReplays.length === 0 && doneReplays.length === 0 && (
          <EmptyState
            icon={<RotateCcw className="w-10 h-10" />}
            title="No active replays"
            description="Configure a replay on the left and click Start"
          />
        )}
      </div>
    </div>
  )
}

// ── Replay card ───────────────────────────────────────────────────────────────

function ReplayCard({
  replay, onStop, done,
}: {
  replay: ReplayProgress
  onStop?: () => void
  done?: boolean
}) {
  const pct = replay.totalMsgs > 0
    ? Math.min((replay.processed / replay.totalMsgs) * 100, 100)
    : 0

  return (
    <div className={cn(
      'border rounded-lg p-4 space-y-3',
      done ? 'bg-bg-elevated border-bg-border' : 'bg-bg-surface border-accent-cyan/20',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!done && <span className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />}
          {done && replay.error && <span className="w-2 h-2 rounded-full bg-accent-red" />}
          {done && !replay.error && <span className="w-2 h-2 rounded-full bg-accent-green" />}
          <span className="text-xs font-mono text-text-primary">{replay.id}</span>
        </div>
        <div className="flex items-center gap-2">
          {!done && (
            <Button variant="ghost" size="xs" onClick={onStop}>
              <Square className="w-3 h-3" />
              Stop
            </Button>
          )}
          <Badge
            variant={done && !replay.error ? 'green' : done && replay.error ? 'red' : 'cyan'}
            size="xs"
          >
            {done && !replay.error ? 'DONE' : done && replay.error ? 'ERROR' : 'RUNNING'}
          </Badge>
        </div>
      </div>

      {/* Progress bar */}
      {!done && (
        <div>
          <div className="flex justify-between text-2xs font-mono text-text-muted mb-1">
            <span>{formatNumber(replay.processed)} / {formatNumber(replay.totalMsgs)} msgs</span>
            <span>{formatNumber(replay.rate)} msg/s</span>
          </div>
          <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-cyan rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {done && !replay.error && (
        <div className="flex items-center gap-4 text-2xs font-mono text-text-muted">
          <span>{formatNumber(replay.processed)} messages replayed</span>
          <span>took {formatHHMMSS(replay.elapsedMs)}</span>
          <span>avg {formatNumber(replay.rate)} msg/s</span>
        </div>
      )}

      {replay.error && (
        <p className="text-xs font-mono text-accent-red">{replay.error}</p>
      )}
    </div>
  )
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block">
        {label}
      </label>
      {children}
    </div>
  )
}
