import { useCallback, useRef, useLayoutEffect } from 'react'
import {
  Activity, Server, Layers, Users, Radio, RotateCcw,
  BarChart2, AlertTriangle, Settings, ChevronRight,
  Plus, Wifi, WifiOff, Shield, DatabaseZap, Send, LayoutDashboard, KeyRound, ArrowLeftRight,
} from 'lucide-react'
import { useUIStore, useDataStore } from '@/store'
import { api } from '@/lib/api'
import { HealthDot, Tooltip, cn } from '@/components/ui'
import { gsap, slideIndicator } from '@/lib/gsap'
import type { View } from '@/types'

interface NavItem { id: View; label: string; icon: React.ElementType }

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
      { id: 'kv',        label: 'Key-Value',        icon: KeyRound        },
      { id: 'accounts',  label: 'Accounts',         icon: Shield          },
    ],
  },
  {
    label: 'Messages',
    items: [
      { id: 'tail',      label: 'Live Tail',        icon: Radio           },
      { id: 'browser',   label: 'Message Browser',  icon: DatabaseZap     },
      { id: 'publisher', label: 'Publisher',        icon: Send            },
      { id: 'request',   label: 'Request–Reply',    icon: ArrowLeftRight  },
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

// Flat list for indicator math
const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap(g => g.items)

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

  const navRef            = useRef<HTMLElement>(null)
  const indicatorRef      = useRef<HTMLDivElement>(null)
  const buttonRefs        = useRef<Map<View, HTMLElement>>(new Map())

  const registerButton = useCallback((id: View, el: HTMLElement | null) => {
    if (el) buttonRefs.current.set(id, el)
    else    buttonRefs.current.delete(id)
  }, [])

  // Slide the lime indicator bar to the active nav item
  useLayoutEffect(() => {
    const target    = buttonRefs.current.get(activeView as View)
    const container = navRef.current
    slideIndicator(indicatorRef.current, target ?? null, container)
  }, [activeView, collapsed])

  const connectDiscovered = useCallback(async (host: string, clientPort: number) => {
    try {
      const res = await api.connections.connect({ name: `${host}:${clientPort}`, url: `nats://${host}:${clientPort}` })
      setActiveCluster(res.id)
    } catch { /* silent */ }
  }, [setActiveCluster])

  const connectedClusters = Object.values(clusters)

  return (
    <aside className={cn(
      'flex flex-col h-full flex-shrink-0 relative z-10 transition-all duration-200',
      'bg-bg-base border-r',
      collapsed ? 'w-12' : 'w-56',
    )}
    style={{ borderColor: 'var(--surface-border)' }}
    >
      {/* ── Logo ── */}
      <div className={cn(
        'flex items-center h-11 border-b flex-shrink-0',
        collapsed ? 'justify-center' : 'justify-between px-3',
      )}
      style={{ borderColor: 'var(--surface-border)' }}
      >
        {!collapsed ? (
          <>
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 flex items-center justify-center"
                style={{ background: 'var(--accent-primary)' }}
              >
                <span className="text-xs font-bold font-sans text-black leading-none">N</span>
              </div>
              <span className="font-sans font-semibold text-text-primary text-sm tracking-tight">
                NatsUI
              </span>
            </div>
            <button
              onClick={toggleSidebar}
              className="text-text-muted hover:text-text-secondary p-1 transition-colors"
            >
              <ChevronRight className="w-3 h-3 rotate-180" />
            </button>
          </>
        ) : (
          <button
            onClick={toggleSidebar}
            className="w-5 h-5 flex items-center justify-center hover:opacity-80"
            style={{ background: 'var(--accent-primary)' }}
          >
            <span className="text-xs font-bold font-sans text-black leading-none">N</span>
          </button>
        )}
      </div>

      {/* ── WS status ── */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 border-b',
        collapsed && 'justify-center px-0',
      )}
      style={{ borderColor: 'var(--surface-border)' }}
      >
        {wsConnected
          ? <Wifi className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
          : <WifiOff className="w-3 h-3 text-accent-red flex-shrink-0 animate-pulse" />
        }
        {!collapsed && (
          <span className={cn('text-xs font-sans', wsConnected ? '' : 'text-text-muted')}
                style={wsConnected ? { color: 'var(--accent-primary)' } : {}}>
            {wsConnected ? 'Connected' : 'Connecting…'}
          </span>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav ref={navRef} className="flex-1 overflow-y-auto py-1.5 relative select-none">
        {/* GSAP sliding active indicator */}
        <div
          ref={indicatorRef}
          className="absolute left-0 w-[2px] pointer-events-none transition-none"
          style={{
            background:     'var(--accent-primary)',
            top:            0,
            height:         32,
            boxShadow:      '2px 0 8px var(--accent-primary)',
            willChange:     'transform',
          }}
        />

        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-1' : ''}>
            {!collapsed && (
              <p className="px-3 pt-2 pb-0.5 text-2xs font-sans font-medium uppercase tracking-wider"
                 style={{ color: 'rgba(255,255,255,0.2)' }}>
                {group.label}
              </p>
            )}
            {collapsed && gi > 0 && (
              <div className="mx-2 my-1.5 h-px" style={{ background: 'var(--surface-border)' }} />
            )}

            {group.items.map(item => {
              const Icon   = item.icon
              const active = activeView === item.id
              return (
                <Tooltip key={item.id} content={collapsed ? item.label : undefined} side="right">
                  <button
                    ref={el => registerButton(item.id, el)}
                    onClick={() => setView(item.id)}
                    onMouseEnter={e => {
                      if (!active) gsap.to(e.currentTarget, { x: 2, duration: 0.12, ease: 'power2.out' })
                    }}
                    onMouseLeave={e => {
                      if (!active) gsap.to(e.currentTarget, { x: 0, duration: 0.12, ease: 'power2.out' })
                    }}
                    className={cn(
                      'w-full flex items-center transition-colors duration-100 text-left relative',
                      collapsed ? 'justify-center py-2.5' : 'gap-2.5 px-3 py-1.5',
                    )}
                    style={{
                      color: active
                        ? 'var(--accent-primary)'
                        : 'rgba(255,255,255,0.4)',
                      background: active ? 'rgba(var(--accent-primary-rgb) / 0.08)' : 'transparent',
                    }}
                  >
                    <Icon className="w-[15px] h-[15px] flex-shrink-0" />
                    {!collapsed && (
                      <span className="text-[13px] font-sans" style={{ fontWeight: active ? 500 : 400 }}>
                        {item.label}
                      </span>
                    )}
                  </button>
                </Tooltip>
              )
            })}
          </div>
        ))}

        {/* Clusters */}
        {!collapsed && connectedClusters.length > 0 && (
          <div className="mt-2">
            <div className="mx-3 my-1 h-px" style={{ background: 'var(--surface-border)' }} />
            <p className="px-3 pb-0.5 text-2xs font-sans font-medium uppercase tracking-wider"
               style={{ color: 'rgba(255,255,255,0.2)' }}>
              Clusters
            </p>
            {connectedClusters.map(cluster => (
              <div key={cluster.id} className="flex items-center gap-2 px-3 py-1.5 cursor-default"
                   style={{ color: 'rgba(255,255,255,0.5)' }}>
                <HealthDot health={cluster.health} size="xs" />
                <span className="flex-1 text-[13px] font-sans truncate">{cluster.name}</span>
                <span className="text-2xs font-mono tabular-nums">{cluster.numNodes}n</span>
              </div>
            ))}
          </div>
        )}

        {/* Discovered */}
        {!collapsed && discoveredServers.length > 0 && (
          <div className="mt-1">
            <div className="mx-3 my-1 h-px" style={{ background: 'var(--surface-border)' }} />
            {discoveredServers.slice(0, 5).map(s => (
              <div
                key={s.id}
                onClick={() => connectDiscovered(s.host, s.clientPort)}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer group"
                style={{ color: 'rgba(255,255,255,0.3)' }}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                     style={{ background: 'var(--accent-primary)' }} />
                <span className="flex-1 text-xs font-mono truncate">
                  {s.host}:{s.clientPort}
                </span>
                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* ── Bottom ── */}
      <div className="border-t py-1" style={{ borderColor: 'var(--surface-border)' }}>
        <Tooltip content={collapsed ? 'Command Palette  ⌘K' : undefined} side="right">
          <button
            onClick={openCmdPalette}
            className={cn(
              'w-full flex items-center gap-2.5 transition-colors',
              collapsed ? 'justify-center py-2.5' : 'px-3 py-1.5',
            )}
            style={{ color: 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}
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
            ref={el => registerButton('settings', el)}
            onClick={() => setView('settings')}
            className={cn(
              'w-full flex items-center gap-2.5 transition-colors relative',
              collapsed ? 'justify-center py-2.5' : 'px-3 py-1.5',
            )}
            style={{
              color:      activeView === 'settings' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.35)',
              background: activeView === 'settings' ? 'rgba(var(--accent-primary-rgb) / 0.08)' : 'transparent',
            }}
          >
            <Settings className="w-[15px] h-[15px] flex-shrink-0" />
            {!collapsed && (
              <span className="text-[13px] font-sans" style={{ fontWeight: activeView === 'settings' ? 500 : 400 }}>
                Settings
              </span>
            )}
          </button>
        </Tooltip>
      </div>
    </aside>
  )
}
