import type {
  ClusterInfo, StreamInfo, ConsumerInfo,
  ConnectionProfile, NATSServer, NATSAccount, NATSUser,
  StoredMessage, PublishRequest, PublishResult, SubjectInfo,
} from '@/types'

const API_ROOT = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080'
const BASE = API_ROOT + '/api/v1'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

const get  = <T>(path: string) => req<T>('GET', path)
const post = <T>(path: string, body: unknown) => req<T>('POST', path, body)
const del  = <T>(path: string) => req<T>('DELETE', path)

export const api = {
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

  publish: (clusterId: string, req: PublishRequest) =>
    post<PublishResult>(`/clusters/${clusterId}/publish`, req),

  metrics: {
    throughput: (clusterId: string) => get<unknown>(`/clusters/${clusterId}/metrics/throughput`),
  },

  health: () => fetch(`${API_ROOT}/health`).then(r => r.json()),
}
