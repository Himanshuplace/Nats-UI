import type { WSEvent, WSEventType } from '@/types'

type EventCallback<T = unknown> = (event: WSEvent<T>) => void
type AnyCallback = (event: WSEvent<unknown>) => void

interface PendingSubscription {
  type: WSEventType
  callback: AnyCallback
}

class NatsUIWebSocket {
  private ws: WebSocket | null = null
  private url: string
  private listeners = new Map<WSEventType | '*', Set<AnyCallback>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private isManualClose = false
  private messageQueue: string[] = []

  constructor(url: string) {
    this.url = url
  }

  connect(): void {
    this.isManualClose = false
    this.reconnectDelay = 1000
    this._connect()
  }

  private _connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    try {
      this.ws = new WebSocket(this.url)
      this.ws.onopen = this._onOpen.bind(this)
      this.ws.onmessage = this._onMessage.bind(this)
      this.ws.onclose = this._onClose.bind(this)
      this.ws.onerror = this._onError.bind(this)
    } catch (err) {
      console.error('[ws] connect failed', err)
      this._scheduleReconnect()
    }
  }

  private _onOpen(): void {
    console.info('[ws] connected to', this.url)
    this.reconnectDelay = 1000

    // Flush queued messages
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!
      this.ws?.send(msg)
    }
  }

  private _onMessage(event: MessageEvent): void {
    // Server may batch multiple JSON messages separated by newlines
    const lines = (event.data as string).split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const parsed: WSEvent = JSON.parse(line)
        this._dispatch(parsed)
      } catch {
        // ignore malformed
      }
    }
  }

  private _onClose(event: CloseEvent): void {
    console.info('[ws] disconnected', event.code, event.reason)
    this.ws = null
    if (!this.isManualClose) {
      this._scheduleReconnect()
    }
  }

  private _onError(event: Event): void {
    console.warn('[ws] error', event)
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      console.info('[ws] reconnecting...')
      this._connect()
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay)
    }, this.reconnectDelay)
  }

  private _dispatch(event: WSEvent): void {
    const type = event.type as WSEventType

    // Type-specific listeners
    const typeListeners = this.listeners.get(type)
    typeListeners?.forEach(cb => cb(event))

    // Wildcard listeners
    const wildcard = this.listeners.get('*')
    wildcard?.forEach(cb => cb(event))
  }

  on<T = unknown>(type: WSEventType | '*', callback: EventCallback<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    const set = this.listeners.get(type)!
    set.add(callback as AnyCallback)

    // Return unsubscribe function
    return () => {
      set.delete(callback as AnyCallback)
    }
  }

  send(type: string, payload?: unknown): void {
    const msg = JSON.stringify({ type, payload: payload ?? null })
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg)
    } else {
      // Queue for when connection restores
      this.messageQueue.push(msg)
      if (this.messageQueue.length > 100) {
        this.messageQueue.shift() // drop oldest
      }
    }
  }

  subscribe(topic: string): void {
    this.send('subscribe', { topic })
  }

  unsubscribe(topic: string): void {
    this.send('unsubscribe', { topic })
  }

  ping(): void {
    this.send('ping')
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  disconnect(): void {
    this.isManualClose = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close(1000, 'client disconnect')
    this.ws = null
  }
}

const WS_URL = (import.meta.env.VITE_WS_BASE ?? 'ws://localhost:8080') + '/api/v1/ws'
export const ws = new NatsUIWebSocket(WS_URL)
