import { useEffect, useCallback } from 'react'
import { Command } from 'cmdk'
import {
  Activity, Layers, Users, Radio, RotateCcw, BarChart2,
  Server, Plug, Settings, Search, Zap, X, Shield, DatabaseZap, Send,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { cn } from '@/components/ui'

const GROUPS = [
  {
    label: 'Navigation',
    items: [
      { id: 'overview',  label: 'Overview',          icon: Activity,  shortcut: ['G', 'O'], view: 'overview' as const },
      { id: 'topology',  label: 'Cluster Topology',  icon: Server,    shortcut: ['G', 'T'], view: 'topology' as const },
      { id: 'streams',   label: 'Stream Explorer',   icon: Layers,    shortcut: ['G', 'S'], view: 'streams' as const },
      { id: 'consumers', label: 'Consumer Inspector',icon: Users,     shortcut: ['G', 'C'], view: 'consumers' as const },
      { id: 'tail',      label: 'Live Tail',          icon: Radio,        shortcut: ['G', 'L'], view: 'tail'      as const },
      { id: 'browser',   label: 'Message Browser',   icon: DatabaseZap,  shortcut: ['G', 'B'], view: 'browser'   as const },
      { id: 'publisher', label: 'Publish Message',   icon: Send,         shortcut: ['G', 'P'], view: 'publisher' as const },
      { id: 'replay',    label: 'Replay Studio',     icon: RotateCcw,    shortcut: ['G', 'R'], view: 'replay'    as const },
      { id: 'metrics',   label: 'Metrics Dashboard', icon: BarChart2, shortcut: ['G', 'M'], view: 'metrics' as const },
      { id: 'accounts',  label: 'Accounts & Users',  icon: Shield,    shortcut: ['G', 'A'], view: 'accounts' as const },
      { id: 'settings',  label: 'Settings',          icon: Settings,  shortcut: ['G', ','], view: 'settings' as const },
    ],
  },
  {
    label: 'Actions',
    items: [
      { id: 'connect',   label: 'Connect to NATS Server', icon: Plug,   shortcut: ['N'] },
      { id: 'scan',      label: 'Scan for NATS Servers',  icon: Search, shortcut: ['D'] },
      { id: 'new-tail',  label: 'New Message Tail',       icon: Zap,    shortcut: ['T'] },
    ],
  },
]

export function CommandPalette() {
  const open  = useUIStore(s => s.commandPaletteOpen)
  const close = useUIStore(s => s.closeCommandPalette)
  const setView = useUIStore(s => s.setView)

  // ⌘K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        useUIStore.getState().openCommandPalette()
      }
      if (e.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close])

  const handleSelect = useCallback((id: string) => {
    const item = GROUPS.flatMap(g => g.items).find(i => i.id === id)
    if (!item) return
    if ('view' in item && item.view != null) {
      setView(item.view as import('@/types').View)
    }
    close()
  }, [setView, close])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-bg-base/80 backdrop-blur-sm"
        onClick={close}
      />

      {/* Palette */}
      <div className="relative w-full max-w-xl mx-4 animate-slide-up">
        <Command
          className="bg-bg-elevated border border-bg-border-strong rounded-xl shadow-2xl overflow-hidden"
          shouldFilter
        >
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-bg-border">
            <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
            <Command.Input
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent text-text-primary placeholder-text-muted text-sm font-mono outline-none"
              autoFocus
            />
            <button onClick={close} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results */}
          <Command.List className="max-h-80 overflow-y-auto py-2">
            <Command.Empty className="py-8 text-center text-sm font-mono text-text-muted">
              No results found
            </Command.Empty>

            {GROUPS.map(group => (
              <Command.Group key={group.label}>
                <div className="px-3 py-1.5 text-2xs font-mono font-semibold text-text-muted uppercase tracking-widest">
                  {group.label}
                </div>

                {group.items.map(item => {
                  const Icon = item.icon
                  return (
                    <Command.Item
                      key={item.id}
                      value={item.label}
                      onSelect={() => handleSelect(item.id)}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                        'text-text-secondary hover:text-text-primary',
                        'aria-selected:bg-bg-hover aria-selected:text-text-primary',
                        'outline-none',
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0 text-text-muted" />
                      <span className="flex-1 text-sm font-mono">{item.label}</span>
                      {item.shortcut && (
                        <span className="flex items-center gap-1">
                          {item.shortcut.map((k, i) => (
                            <kbd
                              key={i}
                              className="px-1.5 py-0.5 text-2xs font-mono bg-bg-surface border border-bg-border-strong rounded text-text-muted"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      )}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            ))}
          </Command.List>

          {/* Footer hint */}
          <div className="border-t border-bg-border px-4 py-2 flex items-center gap-4 text-2xs font-mono text-text-muted">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> select</span>
            <span><kbd className="font-mono">Esc</kbd> close</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
