import { useEffect, useRef, useCallback } from 'react'
import { ws } from '@/lib/ws'
import { useDataStore, useUIStore } from '@/store'
import type { WSEventType, TailedMessage, ThroughputPoint, NATSServer, ClusterInfo } from '@/types'

let idCounter = 0
const nextId = () => `msg-${++idCounter}`

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
  const pushTailMessage      = useDataStore(s => s.pushTailMessage)
  const addDiscovered        = useDataStore(s => s.addDiscoveredServer)
  const removeDiscovered     = useDataStore(s => s.removeDiscoveredServer)
  const setReplay            = useDataStore(s => s.setReplayProgress)
  const setTailActive        = useDataStore(s => s.setTailActive)

  useEffect(() => {
    ws.connect()

    const unsubs: Array<() => void> = []

    unsubs.push(ws.on('connected', () => setWSConnected(true)))
    unsubs.push(ws.on('*', () => setWSConnected(true)))

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

    unsubs.push(ws.on<TailedMessage>('message.received', ({ data }) => {
      const msg = { ...data, id: nextId() }
      if (data.subjectFilter) {
        // Raw NATS subject tail — key is "subj:{clusterId}:{subjectFilter}"
        const key = `subj:${data.clusterId ?? ''}:${data.subjectFilter}`
        pushTailMessage(key, msg)
      } else {
        // Stream-bound tail — key is "{clusterId}:{stream}"
        const key = `${data.clusterId ?? ''}:${data.stream}`
        pushTailMessage(key, msg)
      }
    }))

    unsubs.push(ws.on<NATSServer>('discovery.found', ({ data }) => {
      addDiscovered(data)
    }))

    unsubs.push(ws.on<{ id: string }>('discovery.lost', ({ data }) => {
      removeDiscovered(data.id)
    }))

    // Stream tail events — key "{clusterId}:{stream}"
    unsubs.push(ws.on('tail.started', ({ data }) => {
      const d = data as { clusterId?: string; stream?: string; subjectFilter?: string }
      if (d.subjectFilter) {
        setTailActive(`subj:${d.clusterId ?? ''}:${d.subjectFilter}`, true)
      } else {
        setTailActive(`${d.clusterId ?? ''}:${d.stream ?? ''}`, true)
      }
    }))

    unsubs.push(ws.on('tail.stopped', ({ data }) => {
      const d = data as { clusterId?: string; stream?: string; subjectFilter?: string }
      if (d.subjectFilter) {
        setTailActive(`subj:${d.clusterId ?? ''}:${d.subjectFilter}`, false)
      } else {
        setTailActive(`${d.clusterId ?? ''}:${d.stream ?? ''}`, false)
      }
    }))

    unsubs.push(ws.on('replay.progress', ({ data }) => {
      const p = data as any
      setReplay(p.id, p)
    }))

    unsubs.push(ws.on('error', ({ data }) => {
      const e = data as { code?: string; message?: string }
      console.error('[ws] server error', e.code, e.message)
    }))

    const checkInterval = setInterval(() => {
      setWSConnected(ws.isConnected)
    }, 5000)

    return () => {
      unsubs.forEach(fn => fn())
      clearInterval(checkInterval)
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

  const clear = useCallback(() => clearTail(key), [key, clearTail])

  return { start, stop, clear }
}

/**
 * Start/stop tailing a raw NATS subject pattern (no JetStream stream binding).
 * Supports wildcards: * (single token) and > (rest of subject).
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

  const clear = useCallback(() => clearTail(key), [key, clearTail])

  return { start, stop, clear }
}
