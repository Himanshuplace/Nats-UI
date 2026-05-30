import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  View, Tab, ClusterInfo, StreamInfo, ConsumerInfo,
  TailedMessage, ThroughputPoint, NATSServer, ReplayProgress,
} from '@/types'

// ── Per-view persisted UI state ───────────────────────────────────────────────
// Survives route changes; components read from here on mount instead of resetting.

export interface TailViewState {
  mode: 'stream' | 'subject'
  selectedStream: string
  subjectPattern: string
  filter: string
  isPaused: boolean
}

export interface BrowserViewState {
  selectedStream: string
  subjectFilter: string
  startSeq: string
}

export interface ConsumerViewState {
  selectedStream: string
  selectedConsumer: string | null
}

export interface PublisherViewState {
  subject: string
  payload: string
  headers: { key: string; value: string }[]
}

interface ViewStates {
  tail:      TailViewState
  browser:   BrowserViewState
  consumers: ConsumerViewState
  publisher: PublisherViewState
}

const DEFAULT_VIEW_STATES: ViewStates = {
  tail:      { mode: 'stream', selectedStream: '', subjectPattern: '', filter: '', isPaused: false },
  browser:   { selectedStream: '', subjectFilter: '', startSeq: '' },
  consumers: { selectedStream: '', selectedConsumer: null },
  publisher: { subject: '', payload: '', headers: [] },
}

// ── UI Store ──────────────────────────────────────────────────────────────────

interface UIState {
  activeView: View
  activeClusters: string[]    // connected cluster IDs
  activeStream: string | null
  activeConsumer: string | null
  tabs: Tab[]
  activeTabId: string | null
  commandPaletteOpen: boolean
  sidebarCollapsed: boolean
  splitPaneRatio: number       // 0–1 fraction for split pane
  wsConnected: boolean
  theme: 'dark' | 'light'
  viewStates: ViewStates

  setView: (view: View) => void
  setActiveCluster: (id: string) => void
  removeActiveCluster: (id: string) => void
  setActiveStream: (name: string | null) => void
  setActiveConsumer: (name: string | null) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  toggleSidebar: () => void
  setSplitRatio: (ratio: number) => void
  setWSConnected: (connected: boolean) => void
  addTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  toggleTheme: () => void
  setTailState:     (patch: Partial<TailViewState>)      => void
  setBrowserState:  (patch: Partial<BrowserViewState>)   => void
  setConsumerState: (patch: Partial<ConsumerViewState>)  => void
  setPublisherState:(patch: Partial<PublisherViewState>) => void
}

export const useUIStore = create<UIState>()(
  subscribeWithSelector((set) => ({
    activeView:        'overview',
    activeClusters:    [],
    activeStream:      null,
    activeConsumer:    null,
    tabs:              [],
    activeTabId:       null,
    commandPaletteOpen: false,
    sidebarCollapsed:  false,
    splitPaneRatio:    0.5,
    wsConnected:       false,
    theme:             (localStorage.getItem('natsui-theme') as 'dark' | 'light') ?? 'dark',
    viewStates:        DEFAULT_VIEW_STATES,

    setView: (view) => set({ activeView: view }),

    setActiveCluster: (id) => set((s) => ({
      activeClusters: s.activeClusters.includes(id)
        ? s.activeClusters
        : [...s.activeClusters, id],
    })),

    removeActiveCluster: (id) => set((s) => ({
      activeClusters: s.activeClusters.filter(c => c !== id),
    })),

    setActiveStream:   (name) => set({ activeStream: name }),
    setActiveConsumer: (name) => set({ activeConsumer: name }),

    openCommandPalette:  () => set({ commandPaletteOpen: true }),
    closeCommandPalette: () => set({ commandPaletteOpen: false }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    setSplitRatio: (ratio) => set({ splitPaneRatio: Math.max(0.2, Math.min(0.8, ratio)) }),
    setWSConnected: (connected) => set({ wsConnected: connected }),

    addTab: (tab) => set((s) => ({
      tabs: [...s.tabs.filter(t => t.id !== tab.id), tab],
      activeTabId: tab.id,
    })),

    closeTab: (id) => set((s) => {
      const tabs = s.tabs.filter(t => t.id !== id)
      const activeTabId = s.activeTabId === id
        ? (tabs[tabs.length - 1]?.id ?? null)
        : s.activeTabId
      return { tabs, activeTabId }
    }),

    setActiveTab: (id) => set({ activeTabId: id }),

    toggleTheme: () => set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('natsui-theme', next)
      document.documentElement.classList.toggle('dark', next === 'dark')
      document.documentElement.style.backgroundColor = next === 'dark' ? '#09090b' : '#fafafa'
      return { theme: next }
    }),

    setTailState: (patch) => set((s) => ({
      viewStates: { ...s.viewStates, tail: { ...s.viewStates.tail, ...patch } },
    })),
    setBrowserState: (patch) => set((s) => ({
      viewStates: { ...s.viewStates, browser: { ...s.viewStates.browser, ...patch } },
    })),
    setConsumerState: (patch) => set((s) => ({
      viewStates: { ...s.viewStates, consumers: { ...s.viewStates.consumers, ...patch } },
    })),
    setPublisherState: (patch) => set((s) => ({
      viewStates: { ...s.viewStates, publisher: { ...s.viewStates.publisher, ...patch } },
    })),
  })),
)

// ── Cluster / Data Store ──────────────────────────────────────────────────────

interface DataState {
  discoveredServers: NATSServer[]
  clusters: Record<string, ClusterInfo>
  streams: Record<string, StreamInfo[]>         // key: clusterId
  consumers: Record<string, ConsumerInfo[]>     // key: `${clusterId}:${stream}`
  throughput: Record<string, ThroughputPoint[]> // key: clusterId, last N points
  tailMessages: Record<string, TailedMessage[]> // key: `${clusterId}:${stream}`
  tailActive: Record<string, boolean>           // key: `${clusterId}:${stream}`
  replay: Record<string, ReplayProgress>        // key: replayId

  setDiscoveredServers: (servers: NATSServer[]) => void
  addDiscoveredServer: (server: NATSServer) => void
  removeDiscoveredServer: (id: string) => void
  setCluster: (cluster: ClusterInfo) => void
  setStreams: (clusterId: string, streams: StreamInfo[]) => void
  setConsumers: (key: string, consumers: ConsumerInfo[]) => void
  pushThroughput: (clusterId: string, point: ThroughputPoint, maxPoints?: number) => void
  pushTailMessage: (key: string, msg: TailedMessage, maxMsgs?: number) => void
  batchPushTailMessages: (key: string, msgs: TailedMessage[], maxMsgs?: number) => void
  clearTail: (key: string) => void
  setTailActive: (key: string, active: boolean) => void
  setReplayProgress: (id: string, progress: ReplayProgress) => void
}

const MAX_THROUGHPUT_POINTS = 120
const MAX_TAIL_MESSAGES = 10_000

export const useDataStore = create<DataState>()(
  subscribeWithSelector((set) => ({
    discoveredServers: [],
    clusters:          {},
    streams:           {},
    consumers:         {},
    throughput:        {},
    tailMessages:      {},
    tailActive:        {},
    replay:            {},

    setDiscoveredServers: (servers) => set({ discoveredServers: servers }),

    addDiscoveredServer: (server) => set((s) => ({
      discoveredServers: [
        ...s.discoveredServers.filter(d => d.id !== server.id),
        server,
      ],
    })),

    removeDiscoveredServer: (id) => set((s) => ({
      discoveredServers: s.discoveredServers.filter(d => d.id !== id),
    })),

    setCluster: (cluster) => set((s) => ({
      clusters: { ...s.clusters, [cluster.id]: cluster },
    })),

    setStreams: (clusterId, streams) => set((s) => ({
      streams: { ...s.streams, [clusterId]: streams },
    })),

    setConsumers: (key, consumers) => set((s) => ({
      consumers: { ...s.consumers, [key]: consumers },
    })),

    pushThroughput: (clusterId, point, maxPoints = MAX_THROUGHPUT_POINTS) =>
      set((s) => {
        const prev = s.throughput[clusterId] ?? []
        const next = [...prev, point].slice(-maxPoints)
        return { throughput: { ...s.throughput, [clusterId]: next } }
      }),

    pushTailMessage: (key, msg, maxMsgs = MAX_TAIL_MESSAGES) =>
      set((s) => {
        const prev = s.tailMessages[key] ?? []
        const next = [...prev, msg]
        if (next.length > maxMsgs) next.splice(0, next.length - maxMsgs)
        return { tailMessages: { ...s.tailMessages, [key]: next } }
      }),

    // Batch variant: one Zustand update for N messages — used by the RAF flush loop.
    batchPushTailMessages: (key, newMsgs, maxMsgs = MAX_TAIL_MESSAGES) =>
      set((s) => {
        if (newMsgs.length === 0) return s
        const prev = s.tailMessages[key] ?? []
        const combined = [...prev, ...newMsgs]
        const next = combined.length > maxMsgs ? combined.slice(-maxMsgs) : combined
        return { tailMessages: { ...s.tailMessages, [key]: next } }
      }),

    clearTail: (key) => set((s) => ({
      tailMessages: { ...s.tailMessages, [key]: [] },
    })),

    setTailActive: (key, active) => set((s) => ({
      tailActive: { ...s.tailActive, [key]: active },
    })),

    setReplayProgress: (id, progress) => set((s) => ({
      replay: { ...s.replay, [id]: progress },
    })),
  })),
)
