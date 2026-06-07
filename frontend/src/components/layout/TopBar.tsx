import { Search, Bell, Zap, ChevronRight, Sun, Moon, LogOut } from 'lucide-react'
import { useUIStore, useDataStore } from '@/store'
import { HealthDot, cn } from '@/components/ui'
import { formatNumber } from '@/lib/format'
import { ws } from '@/lib/ws'
import type { View } from '@/types'

const VIEW_LABELS: Record<View, string> = {
  overview:   'Overview',
  topology:   'Cluster Topology',
  streams:    'Stream Explorer',
  consumers:  'Consumer Inspector',
  kv:         'Key-Value Store',
  tail:       'Live Tail',
  browser:    'Message Browser',
  publisher:  'Publish Message',
  request:    'Request–Reply',
  replay:     'Replay Studio',
  lab:        'Consumer Lab',
  metrics:    'Metrics Dashboard',
  services:   'Services',
  health:     'Health & Alerts',
  accounts:   'Accounts & Users',
  dlq:        'Dead Letter Queue',
  settings:   'Settings',
}

export function TopBar() {
  const activeView  = useUIStore(s => s.activeView)
  const wsConnected = useUIStore(s => s.wsConnected)
  const openPalette = useUIStore(s => s.openCommandPalette)
  const theme       = useUIStore(s => s.theme)
  const toggleTheme = useUIStore(s => s.toggleTheme)
  const clearAuth   = useUIStore(s => s.clearAuth)
  const clusters    = useDataStore(s => s.clusters)
  const throughput  = useDataStore(s => s.throughput)

  const handleLogout = () => {
    ws.disconnect()
    clearAuth()
  }

  const clusterList   = Object.values(clusters)
  const clusterHealth = clusterList.every(c => c.health === 'ok')
    ? 'ok'
    : clusterList.some(c => c.health === 'critical')
    ? 'critical'
    : 'degraded'

  const totalMsgs = Object.values(throughput).reduce((sum, pts) => {
    const last = pts[pts.length - 1]
    return sum + (last?.inMsgs ?? 0) + (last?.outMsgs ?? 0)
  }, 0)

  return (
    <header className="h-11 flex items-center gap-2 px-4 bg-bg-base border-b border-bg-border flex-shrink-0 relative z-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-xs font-sans text-text-muted">NatsUI</span>
        <ChevronRight className="w-3 h-3 text-text-muted/40 flex-shrink-0" />
        <span className="text-xs font-sans font-medium text-text-primary truncate">
          {VIEW_LABELS[activeView]}
        </span>

        {/* Cluster indicator */}
        {clusterList.length > 0 && (
          <>
            <ChevronRight className="w-3 h-3 text-text-muted/40 flex-shrink-0" />
            <div className="flex items-center gap-1">
              <HealthDot health={clusterHealth} size="xs" />
              <span className="text-xs font-mono text-text-muted">
                {clusterList.length === 1 ? clusterList[0].name : `${clusterList.length} clusters`}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Live throughput ticker */}
      {totalMsgs > 0 && (
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-surface border border-bg-border">
          <Zap className="w-3 h-3 text-accent-cyan" />
          <span className="text-2xs font-mono text-text-secondary tabular-nums">
            {formatNumber(totalMsgs)} msg/s
          </span>
        </div>
      )}

      {/* Search / command palette */}
      <button
        onClick={openPalette}
        className="hidden sm:flex items-center gap-2 h-7 px-2.5 rounded-md border border-bg-border bg-bg-surface
                   text-text-muted hover:text-text-secondary hover:border-bg-border-strong transition-colors"
      >
        <Search className="w-3 h-3" />
        <span className="text-xs font-sans">Search</span>
        <span className="kbd ml-1">⌘K</span>
      </button>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="h-7 w-7 flex items-center justify-center rounded-md text-text-muted
                   hover:text-text-primary hover:bg-bg-hover transition-colors"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark'
          ? <Sun className="w-3.5 h-3.5" />
          : <Moon className="w-3.5 h-3.5" />
        }
      </button>

      {/* Notifications */}
      <button className="h-7 w-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors relative">
        <Bell className="w-3.5 h-3.5" />
      </button>

      {/* WS connection dot */}
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          wsConnected ? 'bg-accent-green' : 'bg-accent-red animate-pulse',
        )}
        title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
      />

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="h-7 w-7 flex items-center justify-center rounded-md text-text-muted
                   hover:text-accent-red hover:bg-accent-red/10 transition-colors"
        title="Sign out"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </header>
  )
}
