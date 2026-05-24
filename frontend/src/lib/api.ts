import type {
  ClusterInfo, StreamInfo, ConsumerInfo,
  ConnectionProfile, NATSServer, NATSAccount, NATSUser,
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

// ── Discovery ─────────────────────────────────────────────────────────────────

export const api = {
  discovery: {
    scan:  () => get<NATSServer[]>('/discovery/scan'),
    known: () => get<NATSServer[]>('/discovery/known'),
  },

  // ── Connections ─────────────────────────────────────────────────────────────

  connections: {
    list: () => get<Array<{ id: string; name: string; url: string; jetstream: boolean; status: string }>>('/connections'),
    connect: (profile: Omit<ConnectionProfile, 'id'> & { id?: string }) =>
      post<{ id: string; connected: boolean; jetstream: boolean }>('/connections', profile),
    remove: (id: string) => del<void>(`/connections/${id}`),
  },

  // ── Cluster ──────────────────────────────────────────────────────────────────

  cluster: {
    topology: (id: string) => get<ClusterInfo>(`/clusters/${id}/topology`),
    health:   (id: string) => get<{ health: string; nodes: number }>(`/clusters/${id}/health`),
    accounts: (id: string) => get<NATSAccount[]>(`/clusters/${id}/accounts`),
    connz:    (id: string) => get<NATSUser[]>(`/clusters/${id}/connz`),
  },

  // ── Streams ──────────────────────────────────────────────────────────────────

  streams: {
    list: (clusterId: string) => get<StreamInfo[]>(`/clusters/${clusterId}/streams`),
    get:  (clusterId: string, name: string) => get<StreamInfo>(`/clusters/${clusterId}/streams/${name}`),
  },

  // ── Consumers ────────────────────────────────────────────────────────────────

  consumers: {
    list: (clusterId: string, stream: string) =>
      get<ConsumerInfo[]>(`/clusters/${clusterId}/streams/${stream}/consumers`),
    get: (clusterId: string, stream: string, name: string) =>
      get<ConsumerInfo>(`/clusters/${clusterId}/streams/${stream}/consumers/${name}`),
  },

  // ── Metrics ──────────────────────────────────────────────────────────────────

  metrics: {
    throughput: (clusterId: string) => get<unknown>(`/clusters/${clusterId}/metrics/throughput`),
  },

  // ── Health ───────────────────────────────────────────────────────────────────

  health: () => fetch(`${API_ROOT}/health`).then(r => r.json()),
}
