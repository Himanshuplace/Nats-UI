import { useEffect, useRef, useCallback } from 'react'
import { ws } from '@/lib/ws'
import { useDataStore, useUIStore } from '@/store'
import type { WSEventType, TailedMessage, ThroughputPoint, NATSServer, ClusterInfo } from '@/types'

let idCounter = 0
const nextId = () => `msg-${++idCounter}`

// ── RAF-batched message queue ─────────────────────────────────────────────────
//
// Problem: the backend can deliver messages much faster than the browser can
// render. Calling pushTailMessage (Zustand set) on every single WS message
// causes O(N) array spreads + React re-renders at the WS delivery rate.
// At 200 msgs/sec that means 200 full re-renders/second → browser freezes.
//
// Solution: buffer incoming messages in a plain Map (no React state), then
// flush the entire batch once per animation frame. React re-renders at most
// 60 fps regardless of how fast NATS publishes.
//
// Zustand.getState() is valid outside components, so this works as a
// module-level singleton that any number of React trees can share.

const MAX_BUFFER_PER_KEY = 2_000

const pendingMessages = new Map<string, TailedMessage[]>()
let rafHandle: number | null = null

function enqueueMessage(key: string, msg: TailedMessage): void {
  let q = pendingMessages.get(key)
  if (!q) {
    q = []
    pendingMessages.set(key, q)
  }
  q.push(msg)
  // Cap buffer to prevent unbounded growth when the browser tab is hidden
  // (requestAnimationFrame pauses in background tabs).
  if (q.length > MAX_BUFFER_PER_KEY) {
    q.shift() // drop oldest
  }
  scheduleFlush()
}

function scheduleFlush(): void {
  if (rafHandle !== null) return
  rafHandle = requestAnimationFrame(flushPendingMessages)
}

function flushPendingMessages(): void {
  rafHandle = null
  if (pendingMessages.size === 0) return
  const store = useDataStore.getState()
  for (const [key, msgs] of pendingMessages) {
    if (msgs.length === 0) continue
    // splice(0) drains the queue in-place → one Zustand write per key per frame
    store.batchPushTailMessages(key, msgs.splice(0))
  }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connects the WebSocket singleton to the Zustand store.
 * Call once at the app root.
 */
export function useWebSocketBridge(): void {
  const setWSConnected       = useUIStore(s => s.setWSConnected)
  const setActiveCluster     = useUIStore(s => s.setActiveCluster)
  const setCluster           = useDataStore(s => s.setCluster)
  const setStreams            = useDataStore(s => s.setStreams)
  const pushThroughput       = useDataStore(s => s.pushThroughput)
  const addDiscovered        = useDataStore(s => s.addDiscoveredServer)
  const removeDiscovered     = useDataStore(s => s.removeDiscoveredServer)
  const setReplay            = useDataStore(s => s.setReplayProgress)
  const setTailActive        = useDataStore(s => s.setTailActive)

  useEffect(() => {
    ws.connect()

    const unsubs: Array<() => void> = []

    // ── Connection status ───────────────────────────────────────────────
    // Previously: ws.on('*', () => setWSConnected(true)) fired on EVERY event
    // including every message.received — a pointless Zustand write per message.
    // Now: only update on the dedicated connected event + 5s poll below.
    unsubs.push(ws.on('connected', () => setWSConnected(true)))

    unsubs.push(ws.on<ClusterInfo>('cluster.topology', ({ data }) => {
      setCluster(data)
      if (data.id) setActiveCluster(data.id)
    }))

    unsubs.push(ws.on('stream.list', ({ data }) => {
      const list = data as { clusterId: string; streams: unknown[] }
      setStreams(list.clusterId, list.streams as any)
    }))

    unsubs.push(ws.on<ThroughputPoint>('metrics.throughput', ({ data }) => {
      pushThroughput(data.clusterId, data)
    }))

    // ── Tail messages — routed through the RAF batch queue ──────────────
    // Each message.received is buffered; the RAF flush commits the whole
    // batch to Zustand in one update → at most 60 re-renders/second.
    unsubs.push(ws.on<TailedMessage>('message.received', ({ data }) => {
      const msg: TailedMessage = { ...data, id: nextId() }
      const key = data.subjectFilter
        ? `subj:${data.clusterId ?? ''}:${data.subjectFilter}`
        : `${data.clusterId ?? ''}:${data.stream}`
      enqueueMessage(key, msg)
    }))

    unsubs.push(ws.on<NATSServer>('discovery.found', ({ data }) => {
      addDiscovered(data)
    }))

    unsubs.push(ws.on<{ id: string }>('discovery.lost', ({ data }) => {
      removeDiscovered(data.id)
    }))

    // tail.started / tail.stopped — update isActive immediately (not batched)
    unsubs.push(ws.on('tail.started', ({ data }) => {
      const d = data as { clusterId?: string; stream?: string; subjectFilter?: string }
      const key = d.subjectFilter
        ? `subj:${d.clusterId ?? ''}:${d.subjectFilter}`
        : `${d.clusterId ?? ''}:${d.stream ?? ''}`
      setTailActive(key, true)
    }))

    unsubs.push(ws.on('tail.stopped', ({ data }) => {
      const d = data as { clusterId?: string; stream?: string; subjectFilter?: string }
      const key = d.subjectFilter
        ? `subj:${d.clusterId ?? ''}:${d.subjectFilter}`
        : `${d.clusterId ?? ''}:${d.stream ?? ''}`
      setTailActive(key, false)
    }))

    unsubs.push(ws.on('replay.progress', ({ data }) => {
      const p = data as any
      setReplay(p.id, p)
    }))

    unsubs.push(ws.on('error', ({ data }) => {
      const e = data as { code?: string; message?: string }
      console.error('[ws] server error', e.code, e.message)
    }))

    // Periodic connectivity check (covers reconnects after network blip)
    const checkInterval = setInterval(() => {
      setWSConnected(ws.isConnected)
    }, 5_000)

    return () => {
      unsubs.forEach(fn => fn())
      clearInterval(checkInterval)
      // Cancel pending flush on unmount so we don't call into an unmounted store
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle)
        rafHandle = null
      }
    }
  }, [])
}

export function useWSEvent<T = unknown>(
  type: WSEventType,
  handler: (data: T, ts: number) => void,
  deps: unknown[] = [],
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    return ws.on<T>(type, ({ data, ts }) => {
      handlerRef.current(data, ts)
    })
  }, deps)
}

/**
 * Start/stop message tailing for a JetStream stream.
 */
export function useTail(clusterId: string, stream: string) {
  const clearTail = useDataStore(s => s.clearTail)
  const setActive = useDataStore(s => s.setTailActive)
  const key = `${clusterId}:${stream}`

  const start = useCallback(() => {
    if (!clusterId || !stream) return
    setActive(key, true)
    ws.send('tail.start', { clusterId, stream })
  }, [clusterId, stream, key, setActive])

  const stop = useCallback(() => {
    if (!clusterId || !stream) return
    ws.send('tail.stop', { clusterId, stream })
    setActive(key, false)
  }, [clusterId, stream, key, setActive])

  const clear = useCallback(() => {
    clearTail(key)
    pendingMessages.delete(key) // also drain any buffered-but-unflushed messages
  }, [key, clearTail])

  return { start, stop, clear }
}

/**
 * Start/stop tailing a raw NATS subject pattern (no JetStream stream binding).
 */
export function useTailSubject(clusterId: string, subject: string) {
  const clearTail = useDataStore(s => s.clearTail)
  const setActive = useDataStore(s => s.setTailActive)
  const key = `subj:${clusterId}:${subject}`

  const start = useCallback(() => {
    if (!clusterId || !subject) return
    setActive(key, true)
    ws.send('tail.subject.start', { clusterId, subject })
  }, [clusterId, subject, key, setActive])

  const stop = useCallback(() => {
    if (!clusterId || !subject) return
    ws.send('tail.subject.stop', { clusterId, subject })
    setActive(key, false)
  }, [clusterId, subject, key, setActive])

  const clear = useCallback(() => {
    clearTail(key)
    pendingMessages.delete(key)
  }, [key, clearTail])

  return { start, stop, clear }
}
