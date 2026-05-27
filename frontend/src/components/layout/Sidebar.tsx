import { useCallback } from 'react'
import {
  Activity, Server, Layers, Users, Radio, RotateCcw,
  BarChart2, AlertTriangle, Settings, ChevronLeft, ChevronRight,
  Plus, Wifi, WifiOff, Shield, DatabaseZap, Send, LayoutDashboard,
} from 'lucide-react'
import { useUIStore, useDataStore } from '@/store'
import { api } from '@/lib/api'
import { HealthDot, Tooltip, cn } from '@/components/ui'
import type { View } from '@/types'

interface NavItem {
  id: View
  label: string
  icon: React.ElementType
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Monitor',
    items: [
      { id: 'overview',  label: 'Overview',        icon: LayoutDashboard },
      { id: 'topology',  label: 'Topology',         icon: Server          },
      { id: 'metrics',   label: 'Metrics',          icon: BarChart2       },
    ],
  },
  {
    label: 'Streams',
    items: [
      { id: 'streams',   label: 'Streams',          icon: Layers          },
      { id: 'consumers', label: 'Consumers',        icon: Users           },
      { id: 'accounts',  label: 'Accounts',         icon: Shield          },
    ],
  },
  {
    label: 'Messages',
    items: [
      { id: 'tail',      label: 'Live Tail',        icon: Radio           },
      { id: 'browser',   label: 'Message Browser',  icon: DatabaseZap     },
      { id: 'publisher', label: 'Publisher',        icon: Send            },
      { id: 'replay',    label: 'Replay Studio',    icon: RotateCcw       },
    ],
  },
  {
    label: 'Admin',
    items: [
      { id: 'dlq',       label: 'Dead Letters',     icon: AlertTriangle   },
    ],
  },
]

export function Sidebar() {
  const activeView        = useUIStore(s => s.activeView)
  const collapsed         = useUIStore(s => s.sidebarCollapsed)
  const wsConnected       = useUIStore(s => s.wsConnected)
  const setView           = useUIStore(s => s.setView)
  const toggleSidebar     = useUIStore(s => s.toggleSidebar)
  const openCmdPalette    = useUIStore(s => s.openCommandPalette)
  const setActiveCluster  = useUIStore(s => s.setActiveCluster)
  const discoveredServers = useDataStore(s => s.discoveredServers)
  const clusters          = useDataStore(s => s.clusters)

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
    <aside className={cn(
      'flex flex-col glass border-r border-bg-border/50 h-full transition-all duration-200 flex-shrink-0 relative z-10',
      collapsed ? 'w-12' : 'w-56',
    )}>
      {/* ── Logo / header ── */}
      <div className={cn(
        'flex items-center h-12 border-b border-bg-border/40 flex-shrink-0',
        collapsed ? 'justify-between px-1.5' : 'justify-between px-3',
      )}>
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-nats-primary flex items-center justify-center flex-shrink-0 shadow-glow-cyan">
              <span className="text-white text-xs font-mono font-bold">N</span>
            </div>
            <span className="font-mono font-semibold text-text-primary text-sm tracking-tight">NatsUI</span>
          </div>
        ) : (
          <div className="w-6 h-6 rounded-md bg-nats-primary flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-mono font-bold">N</span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="text-text-muted hover:text-text-primary hover:bg-bg-hover/60 p-1 rounded-md transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── WS status strip ── */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 border-b border-bg-border/40 flex-shrink-0',
        collapsed && 'justify-center px-0',
      )}>
        {wsConnected
          ? <Wifi className="w-3 h-3 text-accent-green flex-shrink-0" />
          : <WifiOff className="w-3 h-3 text-accent-red flex-shrink-0 animate-pulse" />
        }
        {!collapsed && (
          <span className={cn('text-2xs font-mono', wsConnected ? 'text-accent-green' : 'text-accent-red')}>
            {wsConnected ? 'Connected' : 'Connecting…'}
          </span>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-1">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label}>
            {/* Section label — only when expanded */}
            {!collapsed && (
              <p className={cn(
                'px-3 pt-3 pb-1 text-2xs font-mono font-semibold uppercase tracking-widest text-text-muted/50',
                gi === 0 && 'pt-2',
              )}>
                {group.label}
              </p>
            )}
            {/* Divider before each section in collapsed mode */}
            {collapsed && gi > 0 && (
              <div className="mx-2 my-1.5 h-px bg-bg-border/50" />
            )}

            {group.items.map(item => {
              const Icon   = item.icon
              const active = activeView === item.id
              return (
                <Tooltip key={item.id} content={collapsed ? item.label : undefined} side="right">
                  <button
                    onClick={() => setView(item.id)}
                    className={cn(
                      'w-full flex items-center transition-all duration-150 text-left relative',
                      collapsed
                        ? 'justify-center py-2.5'
                        : 'gap-2.5 px-3 py-1.5',
                      active
                        ? 'text-accent-cyan bg-accent-cyan/10'
                        : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover/60',
                    )}
                  >
                    {/* Active left border indicator */}
                    {active && !collapsed && (
                      <span className="absolute left-0 top-0.5 bottom-0.5 w-0.5 bg-accent-cyan rounded-full" />
                    )}
                    {active && collapsed && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent-cyan rounded-full" />
                    )}
                    <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-accent-cyan' : '')} />
                    {!collapsed && (
                      <span className={cn(
                        'text-xs font-mono',
                        active ? 'text-accent-cyan font-medium' : 'text-text-secondary',
                      )}>
                        {item.label}
                      </span>
                    )}
                  </button>
                </Tooltip>
              )
            })}
          </div>
        ))}

        {/* ── Clusters ── */}
        {!collapsed && connectedClusters.length > 0 && (
          <>
            <div className="mx-3 my-2 h-px bg-bg-border/50" />
            <p className="px-3 pb-1 text-2xs font-mono font-semibold uppercase tracking-widest text-text-muted/50">
              Clusters
            </p>
            {connectedClusters.map(cluster => (
              <div
                key={cluster.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover/60 cursor-pointer transition-colors"
              >
                <HealthDot health={cluster.health} size="xs" />
                <span className="flex-1 text-xs font-mono text-text-secondary truncate">{cluster.name}</span>
                <span className="text-2xs font-mono text-text-muted">{cluster.numNodes}n</span>
              </div>
            ))}
          </>
        )}

        {/* ── Discovered servers ── */}
        {!collapsed && discoveredServers.length > 0 && (
          <>
            <div className="mx-3 my-2 h-px bg-bg-border/50" />
            <p className="px-3 pb-1 text-2xs font-mono font-semibold uppercase tracking-widest text-text-muted/50">
              Discovered
            </p>
            {discoveredServers.slice(0, 5).map(s => (
              <div
                key={s.id}
                onClick={() => connectDiscovered(s.host, s.clientPort)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover/60 cursor-pointer group transition-colors"
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

      {/* ── Bottom actions ── */}
      <div className={cn(
        'border-t border-bg-border/40 py-1',
        collapsed ? 'flex flex-col items-center gap-0.5' : '',
      )}>
        <Tooltip content={collapsed ? 'Command Palette  ⌘K' : undefined} side="right">
          <button
            onClick={openCmdPalette}
            className={cn(
              'w-full flex items-center gap-2.5 transition-colors text-text-muted hover:text-text-secondary hover:bg-bg-hover/60',
              collapsed ? 'justify-center py-2.5' : 'px-3 py-1.5',
            )}
          >
            <Activity className="w-4 h-4 flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-xs font-mono">Command Palette</span>
                <div className="flex gap-0.5">
                  <kbd className="text-2xs font-mono glass-sm px-1.5 py-0.5 rounded text-text-muted">⌘</kbd>
                  <kbd className="text-2xs font-mono glass-sm px-1.5 py-0.5 rounded text-text-muted">K</kbd>
                </div>
              </>
            )}
          </button>
        </Tooltip>

        <Tooltip content={collapsed ? 'Settings' : undefined} side="right">
          <button
            onClick={() => setView('settings')}
            className={cn(
              'w-full flex items-center gap-2.5 transition-all duration-150 relative',
              collapsed ? 'justify-center py-2.5' : 'px-3 py-1.5',
              activeView === 'settings'
                ? 'text-accent-cyan bg-accent-cyan/10'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover/60',
            )}
          >
            {activeView === 'settings' && !collapsed && (
              <span className="absolute left-0 top-0.5 bottom-0.5 w-0.5 bg-accent-cyan rounded-full" />
            )}
            <Settings className="w-4 h-4 flex-shrink-0" />
            {!collapsed && (
              <span className={cn(
                'text-xs font-mono',
                activeView === 'settings' ? 'text-accent-cyan font-medium' : '',
              )}>
                Settings
              </span>
            )}
          </button>
        </Tooltip>
      </div>
    </aside>
  )
}
