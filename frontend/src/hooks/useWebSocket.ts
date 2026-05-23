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
  const setWSConnected  = useUIStore(s => s.setWSConnected)
  const setCluster      = useDataStore(s => s.setCluster)
  const setStreams       = useDataStore(s => s.setStreams)
  const setConsumers    = useDataStore(s => s.setConsumers)
  const pushThroughput  = useDataStore(s => s.pushThroughput)
  const pushTailMessage = useDataStore(s => s.pushTailMessage)
  const addDiscovered   = useDataStore(s => s.addDiscoveredServer)
  const setReplay       = useDataStore(s => s.setReplayProgress)

  useEffect(() => {
    ws.connect()

    const unsubs: Array<() => void> = []

    unsubs.push(ws.on('connected', () => setWSConnected(true)))
    unsubs.push(ws.on('*', (e) => {
      // Track connection via any successful event
      setWSConnected(true)
    }))

    unsubs.push(ws.on<ClusterInfo>('cluster.topology', ({ data }) => {
      setCluster(data)
    }))

    unsubs.push(ws.on('stream.list', ({ data }) => {
      const list = data as { clusterId: string; streams: unknown[] }
      setStreams(list.clusterId, list.streams as any)
    }))

    unsubs.push(ws.on<ThroughputPoint>('metrics.throughput', ({ data }) => {
      pushThroughput(data.clusterId, data)
    }))

    unsubs.push(ws.on<TailedMessage>('message.received', ({ data }) => {
      const key = `${data.stream}`
      pushTailMessage(key, { ...data, id: nextId() })
    }))

    unsubs.push(ws.on<NATSServer>('discovery.found', ({ data }) => {
      addDiscovered(data)
    }))

    unsubs.push(ws.on('replay.progress', ({ data }) => {
      const p = data as any
      setReplay(p.id, p)
    }))

    // Detect disconnection via WebSocket close — poll state
    const checkInterval = setInterval(() => {
      setWSConnected(ws.isConnected)
    }, 5000)

    return () => {
      unsubs.forEach(fn => fn())
      clearInterval(checkInterval)
    }
  }, [])
}

/**
 * Subscribe to a specific WebSocket event type and call the handler.
 */
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
 * Start/stop message tailing for a stream.
 */
export function useTail(clusterId: string, stream: string) {
  const clearTail   = useDataStore(s => s.clearTail)
  const setActive   = useDataStore(s => s.setTailActive)
  const key = `${stream}`

  const start = useCallback(() => {
    setActive(key, true)
    ws.send('tail.start', { clusterId, stream })
    ws.subscribe(`tail:${clusterId}:${stream}`)
  }, [clusterId, stream, key])

  const stop = useCallback(() => {
    ws.send('tail.stop', { clusterId, stream })
    ws.unsubscribe(`tail:${clusterId}:${stream}`)
    setActive(key, false)
  }, [clusterId, stream, key])

  const clear = useCallback(() => clearTail(key), [key])

  return { start, stop, clear }
}
