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
      'flex flex-col h-full flex-shrink-0 relative z-10 transition-all duration-200',
      'bg-bg-base border-r border-bg-border',
      collapsed ? 'w-12' : 'w-56',
    )}>
      {/* ── Logo / header ── */}
      <div className={cn(
        'flex items-center h-12 border-b border-bg-border flex-shrink-0',
        collapsed ? 'justify-center px-2' : 'justify-between px-3',
      )}>
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[5px] bg-accent-primary flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold font-sans">N</span>
            </div>
            <span className="font-sans font-semibold text-text-primary text-sm tracking-tight">NatsUI</span>
          </div>
        ) : (
          <div className="w-6 h-6 rounded-[5px] bg-accent-primary flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold font-sans">N</span>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={toggleSidebar}
            className="text-text-muted hover:text-text-secondary hover:bg-bg-hover p-1 rounded transition-colors"
            title="Collapse sidebar"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
        {collapsed && (
          <button
            onClick={toggleSidebar}
            className="absolute -right-3 top-8 z-20 w-5 h-5 rounded-full bg-bg-elevated border border-bg-border flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            title="Expand sidebar"
          >
            <ChevronRight className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* ── WS status ── */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 border-b border-bg-border',
        collapsed && 'justify-center px-0',
      )}>
        {wsConnected
          ? <Wifi className="w-3 h-3 text-accent-green flex-shrink-0" />
          : <WifiOff className="w-3 h-3 text-accent-red flex-shrink-0 animate-pulse" />
        }
        {!collapsed && (
          <span className={cn(
            'text-xs font-sans',
            wsConnected ? 'text-accent-green' : 'text-text-muted',
          )}>
            {wsConnected ? 'Connected' : 'Connecting…'}
          </span>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-1.5">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-1' : ''}>
            {/* Section label */}
            {!collapsed && (
              <p className="px-3 pt-2 pb-0.5 text-2xs font-sans font-medium uppercase tracking-wider text-text-muted/60">
                {group.label}
              </p>
            )}
            {collapsed && gi > 0 && (
              <div className="mx-2 my-1.5 h-px bg-bg-border" />
            )}

            {group.items.map(item => {
              const Icon   = item.icon
              const active = activeView === item.id
              return (
                <Tooltip key={item.id} content={collapsed ? item.label : undefined} side="right">
                  <button
                    onClick={() => setView(item.id)}
                    className={cn(
                      'w-full flex items-center transition-colors duration-100 text-left relative rounded-none',
                      collapsed ? 'justify-center py-2.5' : 'gap-2.5 px-3 py-1.5',
                      active
                        ? 'bg-accent-primary/8 text-accent-primary'
                        : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    {/* Active indicator bar */}
                    {active && (
                      <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-accent-primary rounded-r-full" />
                    )}
                    <Icon className={cn(
                      'w-[15px] h-[15px] flex-shrink-0',
                      active ? 'text-accent-primary' : 'text-text-muted',
                    )} />
                    {!collapsed && (
                      <span className={cn(
                        'text-[13px] font-sans',
                        active ? 'text-accent-primary font-medium' : 'text-text-secondary',
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

        {/* ── Connected clusters ── */}
        {!collapsed && connectedClusters.length > 0 && (
          <div className="mt-2">
            <div className="mx-3 mb-1 h-px bg-bg-border" />
            <p className="px-3 pb-0.5 text-2xs font-sans font-medium uppercase tracking-wider text-text-muted/60">
              Clusters
            </p>
            {connectedClusters.map(cluster => (
              <div
                key={cluster.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer transition-colors"
              >
                <HealthDot health={cluster.health} size="xs" />
                <span className="flex-1 text-[13px] font-sans text-text-secondary truncate">{cluster.name}</span>
                <span className="text-2xs font-mono text-text-muted tabular-nums">{cluster.numNodes}n</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Discovered servers ── */}
        {!collapsed && discoveredServers.length > 0 && (
          <div className="mt-1">
            <div className="mx-3 my-1 h-px bg-bg-border" />
            <p className="px-3 pb-0.5 text-2xs font-sans font-medium uppercase tracking-wider text-text-muted/60">
              Discovered
            </p>
            {discoveredServers.slice(0, 5).map(s => (
              <div
                key={s.id}
                onClick={() => connectDiscovered(s.host, s.clientPort)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer group transition-colors"
                title={`Connect to ${s.host}:${s.clientPort}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-nats-primary flex-shrink-0" />
                <span className="flex-1 text-[13px] font-mono text-text-muted truncate">
                  {s.host}:{s.clientPort}
                </span>
                <Plus className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* ── Bottom actions ── */}
      <div className="border-t border-bg-border py-1">
        <Tooltip content={collapsed ? 'Command Palette  ⌘K' : undefined} side="right">
          <button
            onClick={openCmdPalette}
            className={cn(
              'w-full flex items-center gap-2.5 transition-colors text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              collapsed ? 'justify-center py-2.5' : 'px-3 py-1.5',
            )}
          >
            <Activity className="w-[15px] h-[15px] flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-[13px] font-sans">Command Palette</span>
                <div className="flex gap-0.5">
                  <span className="kbd">⌘</span>
                  <span className="kbd">K</span>
                </div>
              </>
            )}
          </button>
        </Tooltip>

        <Tooltip content={collapsed ? 'Settings' : undefined} side="right">
          <button
            onClick={() => setView('settings')}
            className={cn(
              'w-full flex items-center gap-2.5 transition-colors relative',
              collapsed ? 'justify-center py-2.5' : 'px-3 py-1.5',
              activeView === 'settings'
                ? 'bg-accent-primary/8 text-accent-primary'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
            )}
          >
            {activeView === 'settings' && (
              <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-accent-primary rounded-r-full" />
            )}
            <Settings className={cn('w-[15px] h-[15px] flex-shrink-0', activeView === 'settings' ? 'text-accent-primary' : '')} />
            {!collapsed && (
              <span className={cn(
                'text-[13px] font-sans',
                activeView === 'settings' ? 'text-accent-primary font-medium' : '',
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
