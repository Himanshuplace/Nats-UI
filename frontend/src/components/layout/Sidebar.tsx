import { useCallback } from 'react'
import {
  Activity, Server, Layers, Users, Radio, RotateCcw,
  BarChart2, AlertTriangle, Settings, ChevronLeft, Plus, Wifi, WifiOff,
  Shield,
} from 'lucide-react'
import { useUIStore, useDataStore } from '@/store'
import { api } from '@/lib/api'
import { HealthDot, Tooltip, cn } from '@/components/ui'
import type { View } from '@/types'

interface NavItem {
  id: View
  label: string
  icon: React.ElementType
  shortcut: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview',  label: 'Overview',        icon: Activity,       shortcut: 'O' },
  { id: 'topology',  label: 'Topology',        icon: Server,         shortcut: 'T' },
  { id: 'streams',   label: 'Streams',         icon: Layers,         shortcut: 'S' },
  { id: 'consumers', label: 'Consumers',       icon: Users,          shortcut: 'C' },
  { id: 'tail',      label: 'Message Tail',    icon: Radio,          shortcut: 'L' },
  { id: 'replay',    label: 'Replay Studio',   icon: RotateCcw,      shortcut: 'R' },
  { id: 'metrics',   label: 'Metrics',         icon: BarChart2,      shortcut: 'M' },
  { id: 'accounts',  label: 'Accounts',        icon: Shield,         shortcut: 'A' },
  { id: 'dlq',       label: 'Dead Letters',    icon: AlertTriangle,  shortcut: 'D' },
]

export function Sidebar() {
  const activeView        = useUIStore(s => s.activeView)
  const collapsed         = useUIStore(s => s.sidebarCollapsed)
  const wsConnected       = useUIStore(s => s.wsConnected)
  const setView           = useUIStore(s => s.setView)
  const toggleSidebar     = useUIStore(s => s.toggleSidebar)
  const openCmdPalette    = useUIStore(s => s.openCommandPalette)
  const setActiveCluster  = useUIStore(s => s.setActiveCluster)
  const discoveredServers  = useDataStore(s => s.discoveredServers)
  const clusters           = useDataStore(s => s.clusters)

  const connectDiscovered = useCallback(async (host: string, clientPort: number) => {
    try {
      const res = await api.connections.connect({
        name: `${host}:${clientPort}`,
        url:  `nats://${host}:${clientPort}`,
      })
      setActiveCluster(res.id)
    } catch (err) {
      console.error('[sidebar] connect failed', err)
    }
  }, [setActiveCluster])

  const connectedClusters = Object.values(clusters)

  return (
    <aside
      className={cn(
        'flex flex-col bg-bg-elevated border-r border-bg-border h-full transition-all duration-200 flex-shrink-0',
        collapsed ? 'w-12' : 'w-52',
      )}
    >
      {/* Logo / header */}
      <div className={cn(
        'flex items-center border-b border-bg-border flex-shrink-0',
        collapsed ? 'justify-center h-12' : 'justify-between px-3 h-12',
      )}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-nats-primary flex items-center justify-center flex-shrink-0">
              <span className="text-bg-base text-2xs font-mono font-bold">N</span>
            </div>
            <span className="font-mono font-semibold text-text-primary text-sm tracking-tight">
              NatsUI
            </span>
          </div>
        )}
        {collapsed && (
          <div className="w-6 h-6 rounded bg-nats-primary flex items-center justify-center">
            <span className="text-bg-base text-xs font-mono font-bold">N</span>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={toggleSidebar}
            className="text-text-muted hover:text-text-secondary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Connection status */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 border-b border-bg-border flex-shrink-0',
        collapsed && 'justify-center px-0',
      )}>
        {wsConnected
          ? <Wifi className="w-3 h-3 text-accent-green flex-shrink-0" />
          : <WifiOff className="w-3 h-3 text-accent-red flex-shrink-0 animate-pulse" />
        }
        {!collapsed && (
          <span className={cn(
            'text-2xs font-mono',
            wsConnected ? 'text-accent-green' : 'text-accent-red',
          )}>
            {wsConnected ? 'Connected' : 'Connecting...'}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {!collapsed && (
          <p className="px-3 py-1 text-2xs font-mono font-semibold text-text-muted uppercase tracking-widest">
            Views
          </p>
        )}

        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          const active = activeView === item.id
          return (
            <Tooltip key={item.id} content={collapsed ? item.label : undefined}>
              <button
                onClick={() => setView(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 transition-colors text-left',
                  collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
                  active
                    ? 'text-accent-cyan bg-accent-cyan/5 border-r-2 border-accent-cyan'
                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
                )}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', active && 'text-accent-cyan')} />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-xs font-mono">{item.label}</span>
                    <span className="text-2xs font-mono text-text-muted/60 hidden group-hover:block">
                      {item.shortcut}
                    </span>
                  </>
                )}
              </button>
            </Tooltip>
          )
        })}

        {/* Clusters section */}
        {!collapsed && connectedClusters.length > 0 && (
          <>
            <div className="mx-3 my-2 h-px bg-bg-border" />
            <p className="px-3 py-1 text-2xs font-mono font-semibold text-text-muted uppercase tracking-widest">
              Clusters
            </p>
            {connectedClusters.map(cluster => (
              <div
                key={cluster.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer"
              >
                <HealthDot health={cluster.health} size="xs" />
                <span className="flex-1 text-xs font-mono text-text-secondary truncate">
                  {cluster.name}
                </span>
                <span className="text-2xs font-mono text-text-muted">
                  {cluster.numNodes}n
                </span>
              </div>
            ))}
          </>
        )}

        {/* Discovered servers */}
        {!collapsed && discoveredServers.length > 0 && (
          <>
            <div className="mx-3 my-2 h-px bg-bg-border" />
            <p className="px-3 py-1 text-2xs font-mono font-semibold text-text-muted uppercase tracking-widest">
              Discovered
            </p>
            {discoveredServers.slice(0, 5).map(s => (
              <div
                key={s.id}
                onClick={() => connectDiscovered(s.host, s.clientPort)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer group"
                title={`Connect to ${s.host}:${s.clientPort}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-nats-primary flex-shrink-0" />
                <span className="flex-1 text-xs font-mono text-text-muted truncate">
                  {s.host}:{s.clientPort}
                </span>
                <Plus className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </>
        )}
      </nav>

      {/* Bottom actions */}
      <div className={cn('border-t border-bg-border py-2', collapsed ? 'flex flex-col items-center gap-1' : '')}>
        <Tooltip content={collapsed ? 'Command Palette' : undefined}>
          <button
            onClick={openCmdPalette}
            className={cn(
              'w-full flex items-center gap-3 transition-colors text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              collapsed ? 'justify-center py-2' : 'px-3 py-2',
            )}
          >
            <Activity className="w-4 h-4 flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-xs font-mono">Command Palette</span>
                <div className="flex gap-1">
                  <kbd className="text-2xs font-mono bg-bg-surface border border-bg-border px-1 rounded">⌘</kbd>
                  <kbd className="text-2xs font-mono bg-bg-surface border border-bg-border px-1 rounded">K</kbd>
                </div>
              </>
            )}
          </button>
        </Tooltip>

        <Tooltip content={collapsed ? 'Settings' : undefined}>
          <button
            onClick={() => setView('settings')}
            className={cn(
              'w-full flex items-center gap-3 transition-colors text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              collapsed ? 'justify-center py-2' : 'px-3 py-2',
              activeView === 'settings' && 'text-accent-cyan',
            )}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span className="text-xs font-mono">Settings</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  )
}
