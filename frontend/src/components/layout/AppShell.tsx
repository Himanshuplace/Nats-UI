import { Suspense, lazy, useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { useUIStore } from '@/store'
import { Spinner } from '@/components/ui'

const ClusterTopology  = lazy(() => import('@/components/cluster/ClusterTopology').then(m => ({ default: m.ClusterTopology })))
const StreamExplorer   = lazy(() => import('@/components/streams/StreamExplorer').then(m => ({ default: m.StreamExplorer })))
const ConsumerInspector= lazy(() => import('@/components/consumers/ConsumerInspector').then(m => ({ default: m.ConsumerInspector })))
const MessageTail      = lazy(() => import('@/components/tail/MessageTail').then(m => ({ default: m.MessageTail })))
const ReplayStudio     = lazy(() => import('@/components/replay/ReplayStudio').then(m => ({ default: m.ReplayStudio })))
const MetricsDashboard = lazy(() => import('@/components/metrics/MetricsDashboard').then(m => ({ default: m.MetricsDashboard })))
const AccountsView     = lazy(() => import('@/components/accounts/AccountsView').then(m => ({ default: m.AccountsView })))

function ViewFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner size="md" />
    </div>
  )
}

function OverviewView() {
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-bg-base">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-mono font-bold text-text-primary">Overview</h1>
          <p className="text-sm font-mono text-text-muted mt-1">
            NatsUI — Realtime NATS & JetStream control plane
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickStartCard
            title="1. Connect"
            description="Connect to a NATS server manually or let NatsUI auto-discover one locally or in Docker."
            action="Settings → Connections"
            color="cyan"
          />
          <QuickStartCard
            title="2. Explore"
            description="Browse cluster topology, inspect JetStream streams, and monitor consumer lag."
            action="Use the sidebar"
            color="green"
          />
          <QuickStartCard
            title="3. Debug"
            description="Tail live messages, replay from timestamp, trace ACKs, and analyze dead letters."
            action="Message Tail or Replay"
            color="purple"
          />
        </div>

        <div className="bg-bg-elevated border border-bg-border rounded-lg p-4">
          <h3 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest mb-3">
            Keyboard Shortcuts
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
            {[
              ['⌘K', 'Command palette'],
              ['G T', 'Cluster topology'],
              ['G S', 'Stream explorer'],
              ['G C', 'Consumer inspector'],
              ['G L', 'Message tail'],
              ['G R', 'Replay studio'],
              ['G M', 'Metrics dashboard'],
              ['?', 'Show all shortcuts'],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-3">
                <kbd className="text-2xs font-mono bg-bg-surface border border-bg-border px-1.5 py-0.5 rounded text-text-muted whitespace-nowrap">
                  {key}
                </kbd>
                <span className="text-xs font-mono text-text-muted">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickStartCard({ title, description, action, color }: {
  title: string
  description: string
  action: string
  color: 'cyan' | 'green' | 'purple'
}) {
  const borderColor = { cyan: 'border-accent-cyan/20', green: 'border-accent-green/20', purple: 'border-accent-purple/20' }[color]
  const textColor   = { cyan: 'text-accent-cyan', green: 'text-accent-green', purple: 'text-accent-purple' }[color]

  return (
    <div className={`bg-bg-elevated border ${borderColor} rounded-lg p-4 space-y-2`}>
      <h3 className={`text-sm font-mono font-bold ${textColor}`}>{title}</h3>
      <p className="text-xs font-mono text-text-secondary leading-relaxed">{description}</p>
      <p className={`text-2xs font-mono ${textColor} opacity-70`}>→ {action}</p>
    </div>
  )
}

function SettingsView() {
  return (
    <div className="flex-1 p-6 bg-bg-base">
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-mono font-bold text-text-primary">Settings</h1>
        <div className="bg-bg-elevated border border-bg-border rounded-lg p-4">
          <h3 className="text-xs font-mono font-semibold text-text-muted uppercase tracking-widest mb-4">
            NATS Connections
          </h3>
          <ConnectForm />
        </div>
      </div>
    </div>
  )
}

function ConnectForm() {
  const setActive = useUIStore(s => s.setActiveCluster)
  const [status, setStatus]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleConnect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd    = new FormData(e.currentTarget)
    const url   = fd.get('url') as string
    const name  = (fd.get('name') as string) || url
    const token = (fd.get('token') as string) || undefined

    setLoading(true)
    setStatus(null)
    try {
      const { api } = await import('@/lib/api')
      const res = await api.connections.connect({ name, url, token })
      setActive(res.id)
      setStatus({ ok: true, msg: `Connected! JetStream: ${res.jetstream}` })
    } catch (err: any) {
      setStatus({ ok: false, msg: err.message ?? 'Connection failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleConnect} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1">
            Connection Name
          </label>
          <input
            name="name"
            type="text"
            placeholder="prod-us-east-1"
            className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
          />
        </div>
        <div>
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1">
            Auth Token <span className="normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            name="token"
            type="password"
            placeholder="natsui-dev-token"
            className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
          />
        </div>
      </div>
      <div>
        <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1">
          NATS URL
        </label>
        <input
          name="url"
          type="text"
          placeholder="nats://localhost:4222"
          defaultValue="nats://localhost:4222"
          required
          className="w-full bg-bg-surface border border-bg-border rounded px-3 py-2 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-cyan/50"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-accent-cyan text-bg-base text-xs font-mono font-medium rounded hover:bg-accent-cyan/90 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Connecting…' : 'Connect'}
        </button>
        {status && (
          <span className={`text-xs font-mono ${status.ok ? 'text-accent-green' : 'text-accent-red'}`}>
            {status.msg}
          </span>
        )}
      </div>
      <p className="text-2xs font-mono text-text-muted/60">
        The NATS cluster in docker-compose uses token auth by default.
        Set <code className="text-accent-cyan">NATS_AUTH_TOKEN</code> in your environment (default: <code className="text-accent-cyan">natsui-dev-token</code>).
      </p>
    </form>
  )
}

// ── Main AppShell ─────────────────────────────────────────────────────────────

export function AppShell() {
  const activeView = useUIStore(s => s.activeView)

  const viewContent = () => {
    switch (activeView) {
      case 'overview':  return <OverviewView />
      case 'topology':  return <Suspense fallback={<ViewFallback />}><ClusterTopology /></Suspense>
      case 'streams':   return <Suspense fallback={<ViewFallback />}><StreamExplorer /></Suspense>
      case 'consumers': return <Suspense fallback={<ViewFallback />}><ConsumerInspector /></Suspense>
      case 'tail':      return <Suspense fallback={<ViewFallback />}><MessageTail /></Suspense>
      case 'replay':    return <Suspense fallback={<ViewFallback />}><ReplayStudio /></Suspense>
      case 'metrics':   return <Suspense fallback={<ViewFallback />}><MetricsDashboard /></Suspense>
      case 'accounts':  return <Suspense fallback={<ViewFallback />}><AccountsView /></Suspense>
      case 'dlq':       return <DLQPlaceholder />
      case 'settings':  return <SettingsView />
      default:          return <OverviewView />
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base text-text-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {viewContent()}
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}

function DLQPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center bg-bg-base">
      <div className="text-center font-mono">
        <p className="text-4xl mb-3">🪦</p>
        <p className="text-sm font-mono text-text-secondary">Dead Letter Queue Analyzer</p>
        <p className="text-xs font-mono text-text-muted mt-1">Coming soon — poison message inspection & redelivery analysis</p>
      </div>
    </div>
  )
}
