import { Search, Bell, Zap, ChevronRight, Sun, Moon } from 'lucide-react'
import { useUIStore, useDataStore } from '@/store'
import { Badge, Button, HealthDot, cn } from '@/components/ui'
import { formatNumber } from '@/lib/format'
import type { View } from '@/types'

const VIEW_LABELS: Record<View, string> = {
  overview:   'Overview',
  topology:   'Cluster Topology',
  streams:    'Stream Explorer',
  consumers:  'Consumer Inspector',
  tail:       'Live Tail',
  browser:    'Message Browser',
  publisher:  'Publish Message',
  replay:     'Replay Studio',
  metrics:    'Metrics Dashboard',
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
  const clusters    = useDataStore(s => s.clusters)
  const throughput  = useDataStore(s => s.throughput)

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
    <header className="h-12 flex items-center gap-3 px-4 glass border-b border-bg-border/40 flex-shrink-0 relative z-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-xs font-mono text-text-muted">NatsUI</span>
        <ChevronRight className="w-3 h-3 text-text-muted/50 flex-shrink-0" />
        <span className="text-xs font-mono text-text-primary font-medium truncate">
          {VIEW_LABELS[activeView]}
        </span>

        {/* Active cluster badges */}
        {clusterList.length > 0 && (
          <>
            <ChevronRight className="w-3 h-3 text-text-muted/50 flex-shrink-0" />
            <div className="flex items-center gap-1.5">
              {clusterList.slice(0, 3).map(c => (
                <div key={c.id} className="flex items-center gap-1">
                  <HealthDot health={c.health} size="xs" />
                  <span className="text-2xs font-mono text-text-muted">{c.name}</span>
                </div>
              ))}
              {clusterList.length > 3 && (
                <span className="text-2xs font-mono text-text-muted">+{clusterList.length - 3}</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Live throughput ticker */}
      {totalMsgs > 0 && (
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 glass-sm rounded-lg">
          <Zap className="w-3 h-3 text-accent-cyan" />
          <span className="text-2xs font-mono text-accent-cyan">
            {formatNumber(totalMsgs)} msg/s
          </span>
        </div>
      )}

      {/* Cluster health summary */}
      {clusterList.length > 0 && (
        <Badge
          variant={clusterHealth === 'ok' ? 'green' : clusterHealth === 'critical' ? 'red' : 'yellow'}
          size="xs"
        >
          <HealthDot health={clusterHealth} size="xs" />
          <span className="ml-1">{clusterList.length} cluster{clusterList.length !== 1 ? 's' : ''}</span>
        </Badge>
      )}

      {/* Search button */}
      <Button
        variant="ghost"
        size="xs"
        onClick={openPalette}
        className="hidden sm:flex items-center gap-1.5 text-text-muted hover:text-text-secondary"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="text-2xs font-mono">Search</span>
        <kbd className="text-2xs font-mono glass-sm px-1.5 py-0.5 rounded text-text-muted">⌘K</kbd>
      </Button>

      {/* Dark / light toggle */}
      <button
        onClick={toggleTheme}
        className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover/60 transition-colors"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark'
          ? <Sun className="w-4 h-4" />
          : <Moon className="w-4 h-4" />
        }
      </button>

      {/* Notifications placeholder */}
      <button className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover/60 transition-colors relative">
        <Bell className="w-4 h-4" />
      </button>

      {/* WS dot */}
      <div
        className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          wsConnected ? 'bg-accent-green' : 'bg-accent-red animate-pulse',
        )}
        title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
      />
    </header>
  )
}
