import { Suspense, lazy, useState, useRef, useLayoutEffect, useEffect, Component, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { ParticleBackground } from '@/components/three/ParticleBackground'
import { NatsAuthFields, emptyNatsAuth, authToProfile, type NatsAuth } from '@/components/auth/NatsAuthFields'
import { useUIStore } from '@/store'
import { Spinner } from '@/components/ui'
import { animateViewIn } from '@/lib/gsap'
import { api } from '@/lib/api'

// ── Error Boundary ────────────────────────────────────────────────────────────
// Wraps each lazy view so a crash shows a clean error card instead of blank page.

interface EBState { error: Error | null }
class ViewErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null }

  static getDerivedStateFromError(error: Error): EBState {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="surface-card p-6 max-w-lg w-full space-y-3">
            <p className="text-sm font-sans font-semibold text-accent-red">View crashed</p>
            <p className="text-xs font-sans text-text-secondary break-all">
              {this.state.error.message}
            </p>
            <pre className="terminal-pre">{this.state.error.stack}</pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-3 py-1.5 rounded-md bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-xs font-sans hover:bg-accent-primary/15 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const ClusterTopology   = lazy(() => import('@/components/cluster/ClusterTopology').then(m => ({ default: m.ClusterTopology })))
const StreamExplorer    = lazy(() => import('@/components/streams/StreamExplorer').then(m => ({ default: m.StreamExplorer })))
const ConsumerInspector = lazy(() => import('@/components/consumers/ConsumerInspector').then(m => ({ default: m.ConsumerInspector })))
const KVManager         = lazy(() => import('@/components/kv/KVManager').then(m => ({ default: m.KVManager })))
const ObjectStore       = lazy(() => import('@/components/objects/ObjectStore').then(m => ({ default: m.ObjectStore })))
const MessageTail       = lazy(() => import('@/components/tail/MessageTail').then(m => ({ default: m.MessageTail })))
const MessageBrowser    = lazy(() => import('@/components/tail/MessageBrowser').then(m => ({ default: m.MessageBrowser })))
const MessagePublisher  = lazy(() => import('@/components/publisher/MessagePublisher').then(m => ({ default: m.MessagePublisher })))
const RequestReplyConsole = lazy(() => import('@/components/request/RequestReplyConsole').then(m => ({ default: m.RequestReplyConsole })))
const ReplayStudio      = lazy(() => import('@/components/replay/ReplayStudio').then(m => ({ default: m.ReplayStudio })))
const ConsumerLab       = lazy(() => import('@/components/debug/ConsumerLab').then(m => ({ default: m.ConsumerLab })))
const MetricsDashboard  = lazy(() => import('@/components/metrics/MetricsDashboard').then(m => ({ default: m.MetricsDashboard })))
const ServicesExplorer  = lazy(() => import('@/components/services/ServicesExplorer').then(m => ({ default: m.ServicesExplorer })))
const HealthPanel       = lazy(() => import('@/components/health/HealthPanel').then(m => ({ default: m.HealthPanel })))
const ServerLatency     = lazy(() => import('@/components/latency/ServerLatency').then(m => ({ default: m.ServerLatency })))
const AccountsView      = lazy(() => import('@/components/accounts/AccountsView').then(m => ({ default: m.AccountsView })))

function ViewFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner size="md" />
    </div>
  )
}

function OverviewView() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-sans font-semibold text-text-primary tracking-tight">Overview</h1>
          <p className="text-sm font-mono text-text-muted mt-1">
            NatsUI — Realtime NATS & JetStream control plane
          </p>
        </div>

        {/* Quick start cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickStartCard
            title="1. Connect"
            description="Connect to a NATS server or let NatsUI auto-discover one locally or in Docker."
            action="Settings → Connections"
            color="primary"
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

        {/* Keyboard shortcuts */}
        <div className="surface-card p-5">
          <h3 className="text-xs font-sans font-semibold text-text-muted uppercase tracking-wide mb-4">
            Keyboard Shortcuts
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            {[
              ['⌘K', 'Command palette'],
              ['G T', 'Cluster topology'],
              ['G S', 'Stream explorer'],
              ['G C', 'Consumer inspector'],
              ['G L', 'Live tail'],
              ['G R', 'Replay studio'],
              ['G M', 'Metrics dashboard'],
              ['?', 'Show all shortcuts'],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-3">
                <kbd className="kbd whitespace-nowrap">{key}</kbd>
                <span className="text-xs font-sans text-text-muted">{desc}</span>
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
  color: 'primary' | 'green' | 'purple'
}) {
  const accentBorder = {
    primary: 'border-l-accent-primary',
    green:   'border-l-accent-green',
    purple:  'border-l-accent-purple',
  }[color]
  const accentText = {
    primary: 'text-accent-primary',
    green:   'text-accent-green',
    purple:  'text-accent-purple',
  }[color]

  return (
    <div className={`surface-card p-5 border-l-2 ${accentBorder} space-y-2`}>
      <h3 className={`text-sm font-sans font-semibold ${accentText}`}>{title}</h3>
      <p className="text-xs font-sans text-text-secondary leading-relaxed">{description}</p>
      <p className={`text-2xs font-sans ${accentText} opacity-70`}>→ {action}</p>
    </div>
  )
}

function SettingsView() {
  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-2xl space-y-6 animate-fade-in">
        <h1 className="text-xl font-sans font-semibold text-text-primary tracking-tight">Settings</h1>
        <div className="surface-card p-5 space-y-5">
          <h3 className="text-xs font-sans font-semibold text-text-muted uppercase tracking-wide">
            NATS Connections
          </h3>
          <ConnectionList />
          <div className="border-t border-bg-border pt-4">
            <p className="text-xs font-sans font-semibold text-text-secondary mb-3">Add Connection</p>
            <ConnectForm />
          </div>
        </div>
      </div>
    </div>
  )
}

interface SavedConn {
  id: string
  name: string
  url: string
  jetstream: boolean
  status: string
}

function ConnectionList() {
  const removeActiveCluster = useUIStore(s => s.removeActiveCluster)
  const [conns, setConns] = useState<SavedConn[]>([])
  const [removing, setRemoving] = useState<string | null>(null)

  const load = () => {
    api.connections.list()
      .then(setConns)
      .catch(() => {})
  }

  useEffect(() => { load() }, [])

  if (conns.length === 0) {
    return (
      <p className="text-xs font-mono text-text-muted">No active connections.</p>
    )
  }

  const handleRemove = async (id: string) => {
    setRemoving(id)
    try {
      await api.connections.remove(id)
      removeActiveCluster(id)
      setConns(prev => prev.filter(c => c.id !== id))
    } catch {
      /* ignore */
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-2">
      {conns.map(c => (
        <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-bg-surface border border-bg-border">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'CONNECTED' ? 'bg-accent-green' : 'bg-accent-red'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-sans font-medium text-text-primary truncate">{c.name}</p>
            <p className="text-2xs font-mono text-text-muted truncate">{c.url}</p>
          </div>
          {c.jetstream && (
            <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary border border-accent-primary/20 flex-shrink-0">
              JS
            </span>
          )}
          <button
            onClick={() => handleRemove(c.id)}
            disabled={removing === c.id}
            className="h-6 w-6 flex items-center justify-center rounded text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-40"
            title="Disconnect"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

function ConnectForm() {
  const setActive = useUIStore(s => s.setActiveCluster)
  const [status, setStatus]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [auth, setAuth]       = useState<NatsAuth>(emptyNatsAuth)

  const handleConnect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd    = new FormData(e.currentTarget)
    const raw   = (fd.get('url') as string).trim()
    const name  = (fd.get('name') as string) || raw

    // Normalize: bare IP/host → nats://host:4222, host:port → nats://host:port
    let url = raw
    if (url && !url.startsWith('nats://') && !url.startsWith('tls://')) {
      url = 'nats://' + url + (url.includes(':') ? '' : ':4222')
    }

    setLoading(true)
    setStatus(null)
    try {
      const res = await api.connections.connect({ name, url, ...authToProfile(auth) })
      setActive(res.id)
      setStatus({ ok: true, msg: `Connected — JetStream: ${res.jetstream}` })
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
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">
            Connection Name <span className="normal-case opacity-60">(optional)</span>
          </label>
          <input name="name" type="text" placeholder="prod-us-east-1" className="input-base" />
        </div>
        <div>
          <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">
            Server Address
          </label>
          <input
            name="url" type="text"
            placeholder="192.168.1.100:4222"
            required
            className="input-base"
          />
        </div>
      </div>
      <NatsAuthFields value={auth} onChange={setAuth} disabled={loading} />
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-accent-primary text-bg-base text-xs font-mono font-semibold rounded-lg hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Connecting…' : 'Connect'}
        </button>
        {status && (
          <span className={`text-xs font-mono ${status.ok ? 'text-accent-green' : 'text-accent-red'}`}>
            {status.msg}
          </span>
        )}
      </div>
    </form>
  )
}

// ── Main AppShell ─────────────────────────────────────────────────────────────

export function AppShell() {
  const activeView = useUIStore(s => s.activeView)
  const mainRef    = useRef<HTMLDivElement>(null)

  // GSAP view transition: slide + fade on every view change
  useLayoutEffect(() => {
    const tween = animateViewIn(mainRef.current)
    return () => { tween?.kill() }
  }, [activeView])

  const viewContent = () => {
    switch (activeView) {
      case 'overview':  return <OverviewView />
      case 'topology':  return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><ClusterTopology /></ViewErrorBoundary></Suspense>
      case 'streams':   return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><StreamExplorer /></ViewErrorBoundary></Suspense>
      case 'consumers': return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><ConsumerInspector /></ViewErrorBoundary></Suspense>
      case 'kv':        return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><KVManager /></ViewErrorBoundary></Suspense>
      case 'objects':   return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><ObjectStore /></ViewErrorBoundary></Suspense>
      case 'tail':      return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><MessageTail /></ViewErrorBoundary></Suspense>
      case 'browser':   return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><MessageBrowser /></ViewErrorBoundary></Suspense>
      case 'publisher': return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><MessagePublisher /></ViewErrorBoundary></Suspense>
      case 'request':   return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><RequestReplyConsole /></ViewErrorBoundary></Suspense>
      case 'replay':    return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><ReplayStudio /></ViewErrorBoundary></Suspense>
      case 'lab':       return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><ConsumerLab /></ViewErrorBoundary></Suspense>
      case 'metrics':   return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><MetricsDashboard /></ViewErrorBoundary></Suspense>
      case 'services':  return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><ServicesExplorer /></ViewErrorBoundary></Suspense>
      case 'health':    return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><HealthPanel /></ViewErrorBoundary></Suspense>
      case 'latency':   return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><ServerLatency /></ViewErrorBoundary></Suspense>
      case 'accounts':  return <Suspense fallback={<ViewFallback />}><ViewErrorBoundary><AccountsView /></ViewErrorBoundary></Suspense>
      case 'dlq':       return <DLQPlaceholder />
      case 'settings':  return <SettingsView />
      default:          return <OverviewView />
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base text-text-primary relative">
      {/* Phosphor particle field — fixed behind everything */}
      <ParticleBackground />

      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        <TopBar />
        <main ref={mainRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {viewContent()}
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}

function DLQPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center font-mono animate-fade-in">
        <p className="text-4xl mb-3">🪦</p>
        <p className="text-sm font-mono text-text-secondary">Dead Letter Queue Analyzer</p>
        <p className="text-xs font-mono text-text-muted mt-1">Coming soon — poison message inspection & redelivery analysis</p>
      </div>
    </div>
  )
}
