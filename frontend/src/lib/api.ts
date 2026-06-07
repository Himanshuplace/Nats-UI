import type {
  ClusterInfo, StreamInfo, ConsumerInfo,
  ConnectionProfile, NATSServer, NATSAccount, NATSUser,
  StoredMessage, PublishRequest, PublishResult, SubjectInfo,
  KVBucketInfo, KVEntry, KVBucketConfig,
  ObjectBucketInfo, ObjectEntry, ObjectData, ObjectBucketConfig,
  RequestReplyRequest, RequestReplyResult,
  ServiceInfo, ServicePingResult,
  DebugFetchResult,
} from '@/types'
import { getToken, clearToken } from './auth'

const API_ROOT = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080'
const BASE = API_ROOT + '/api/v1'

// Callback invoked when any protected request returns 401.
// Set by App.tsx so the store's clearAuth is called without a circular import.
let _onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void): void {
  _onUnauthorized = fn
}

async function req<T>(method: string, path: string, body?: unknown, skipAuth = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (!skipAuth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    if (res.status === 401 && !skipAuth) {
      clearToken()
      _onUnauthorized?.()
      throw new Error('Session expired — please log in again')
    }
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

const get  = <T>(path: string) => req<T>('GET', path)
const post = <T>(path: string, body: unknown) => req<T>('POST', path, body)
const put  = <T>(path: string, body?: unknown) => req<T>('PUT', path, body)
const del  = <T>(path: string) => req<T>('DELETE', path)

export const api = {
  auth: {
    login: (username: string, password: string) =>
      req<{ token: string; username: string }>('POST', '/auth/login', { username, password }, true),
    me: () => get<{ username: string; status: string }>('/auth/me'),
  },

  discovery: {
    scan:  () => get<NATSServer[]>('/discovery/scan'),
    known: () => get<NATSServer[]>('/discovery/known'),
  },

  connections: {
    list: () => get<Array<{ id: string; name: string; url: string; jetstream: boolean; status: string }>>('/connections'),
    connect: (profile: Omit<ConnectionProfile, 'id'> & { id?: string }) =>
      post<{ id: string; connected: boolean; jetstream: boolean }>('/connections', profile),
    remove: (id: string) => del<void>(`/connections/${id}`),
  },

  cluster: {
    topology: (id: string) => get<ClusterInfo>(`/clusters/${id}/topology`),
    health:   (id: string) => get<{ health: string; nodes: number }>(`/clusters/${id}/health`),
    accounts: (id: string) => get<NATSAccount[]>(`/clusters/${id}/accounts`),
    connz:    (id: string) => get<NATSUser[]>(`/clusters/${id}/connz`),
  },

  streams: {
    list:   (clusterId: string) => get<StreamInfo[]>(`/clusters/${clusterId}/streams`),
    get:    (clusterId: string, name: string) => get<StreamInfo>(`/clusters/${clusterId}/streams/${name}`),
    create: (clusterId: string, cfg: Partial<StreamInfo['config']>) =>
      post<StreamInfo>(`/clusters/${clusterId}/streams`, cfg),
    update: (clusterId: string, name: string, cfg: Partial<StreamInfo['config']>) =>
      req<StreamInfo>('PUT', `/clusters/${clusterId}/streams/${name}`, cfg),
    delete: (clusterId: string, name: string) => del<void>(`/clusters/${clusterId}/streams/${name}`),
    messages: (clusterId: string, stream: string, opts?: {
      startSeq?: number
      limit?: number
      subject?: string
    }) => {
      const p = new URLSearchParams()
      if (opts?.startSeq) p.set('startSeq', String(opts.startSeq))
      if (opts?.limit)    p.set('limit',    String(opts.limit))
      if (opts?.subject)  p.set('subject',  opts.subject)
      const qs = p.toString() ? `?${p}` : ''
      return get<StoredMessage[]>(`/clusters/${clusterId}/streams/${stream}/messages${qs}`)
    },
  },

  consumers: {
    list:   (clusterId: string, stream: string) =>
      get<ConsumerInfo[]>(`/clusters/${clusterId}/streams/${stream}/consumers`),
    get:    (clusterId: string, stream: string, name: string) =>
      get<ConsumerInfo>(`/clusters/${clusterId}/streams/${stream}/consumers/${name}`),
    create: (clusterId: string, stream: string, cfg: unknown) =>
      post<ConsumerInfo>(`/clusters/${clusterId}/streams/${stream}/consumers`, cfg),
    delete: (clusterId: string, stream: string, name: string) =>
      del<void>(`/clusters/${clusterId}/streams/${stream}/consumers/${name}`),
  },

  subjects: {
    list: (clusterId: string) => get<SubjectInfo[]>(`/clusters/${clusterId}/subjects`),
  },

  kv: {
    buckets:      (clusterId: string) => get<KVBucketInfo[]>(`/clusters/${clusterId}/kv`),
    createBucket: (clusterId: string, cfg: KVBucketConfig) =>
      post<KVBucketInfo>(`/clusters/${clusterId}/kv`, cfg),
    deleteBucket: (clusterId: string, bucket: string) =>
      del<void>(`/clusters/${clusterId}/kv/${encodeURIComponent(bucket)}`),
    keys:    (clusterId: string, bucket: string) =>
      get<KVEntry[]>(`/clusters/${clusterId}/kv/${encodeURIComponent(bucket)}/keys`),
    history: (clusterId: string, bucket: string, key: string) =>
      get<KVEntry[]>(`/clusters/${clusterId}/kv/${encodeURIComponent(bucket)}/history?key=${encodeURIComponent(key)}`),
    put:     (clusterId: string, bucket: string, key: string, value: string) =>
      put<{ revision: number }>(`/clusters/${clusterId}/kv/${encodeURIComponent(bucket)}/entry?key=${encodeURIComponent(key)}`, { value }),
    delete:  (clusterId: string, bucket: string, key: string, purge = false) =>
      del<void>(`/clusters/${clusterId}/kv/${encodeURIComponent(bucket)}/entry?key=${encodeURIComponent(key)}${purge ? '&purge=true' : ''}`),
  },

  obj: {
    buckets:      (clusterId: string) => get<ObjectBucketInfo[]>(`/clusters/${clusterId}/obj`),
    createBucket: (clusterId: string, cfg: ObjectBucketConfig) => post<ObjectBucketInfo>(`/clusters/${clusterId}/obj`, cfg),
    deleteBucket: (clusterId: string, bucket: string) => del<void>(`/clusters/${clusterId}/obj/${encodeURIComponent(bucket)}`),
    objects: (clusterId: string, bucket: string) =>
      get<ObjectEntry[]>(`/clusters/${clusterId}/obj/${encodeURIComponent(bucket)}/objects`),
    get: (clusterId: string, bucket: string, name: string) =>
      get<ObjectData>(`/clusters/${clusterId}/obj/${encodeURIComponent(bucket)}/object?name=${encodeURIComponent(name)}`),
    put: (clusterId: string, bucket: string, name: string, body: { text?: string; base64?: string }) =>
      put<ObjectEntry>(`/clusters/${clusterId}/obj/${encodeURIComponent(bucket)}/object?name=${encodeURIComponent(name)}`, body),
    delete: (clusterId: string, bucket: string, name: string) =>
      del<void>(`/clusters/${clusterId}/obj/${encodeURIComponent(bucket)}/object?name=${encodeURIComponent(name)}`),
  },

  publish: (clusterId: string, req: PublishRequest) =>
    post<PublishResult>(`/clusters/${clusterId}/publish`, req),

  request: (clusterId: string, req: RequestReplyRequest) =>
    post<RequestReplyResult>(`/clusters/${clusterId}/request`, req),

  services: {
    list: (clusterId: string) => get<ServiceInfo[]>(`/clusters/${clusterId}/services`),
    ping: (clusterId: string) => get<ServicePingResult>(`/clusters/${clusterId}/services/ping`),
  },

  debug: {
    fetch: (clusterId: string, stream: string, consumer: string, batch: number) =>
      post<DebugFetchResult>(`/clusters/${clusterId}/debug/fetch`, { stream, consumer, batch }),
    ack: (clusterId: string, sessionId: string, messageId: string, action: 'ack' | 'nak' | 'term') =>
      post<void>(`/clusters/${clusterId}/debug/ack`, { sessionId, messageId, action }),
  },

  metrics: {
    throughput: (clusterId: string) => get<unknown>(`/clusters/${clusterId}/metrics/throughput`),
  },

  health: () => fetch(`${API_ROOT}/health`).then(r => r.json()),
}
