import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Shield, Users, Activity, ArrowUpDown, Database,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'
import {
  Badge, EmptyState, Spinner, StatCard, cn,
} from '@/components/ui'
import { formatBytes, formatNumber } from '@/lib/format'
import type { NATSAccount, NATSUser } from '@/types'

export function AccountsView() {
  const activeClusters = useUIStore(s => s.activeClusters)
  const clusterId      = activeClusters[0] ?? ''

  const { data: accounts, isLoading: loadingAccounts, error: accountsError } = useQuery({
    queryKey:  ['accounts', clusterId],
    queryFn:   () => api.cluster.accounts(clusterId),
    enabled:   activeClusters.length > 0 && Boolean(clusterId),
    refetchInterval: 10_000,
  })

  const { data: connections, isLoading: loadingConns } = useQuery({
    queryKey:  ['connz', clusterId],
    queryFn:   () => api.cluster.connz(clusterId),
    enabled:   activeClusters.length > 0 && Boolean(clusterId),
    refetchInterval: 5_000,
  })

  if (activeClusters.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="glass rounded-xl p-8 shadow-glass text-center space-y-2">
          <Shield className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm font-mono text-text-secondary">No cluster connected</p>
          <p className="text-xs font-mono text-text-muted">Connect to a NATS server in Settings to view accounts and users</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: accounts list */}
      <div className="w-80 flex-shrink-0 border-r border-bg-border/50 flex flex-col glass">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/50">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-accent-cyan" />
            <span className="text-xs font-mono font-semibold text-text-primary uppercase tracking-widest">
              Accounts
            </span>
            {accounts && (
              <span className="text-2xs font-mono bg-bg-surface border border-bg-border px-1.5 rounded text-text-muted">
                {accounts.length}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {(loadingAccounts) && (
            <div className="flex justify-center py-8"><Spinner /></div>
          )}

          {accountsError && (
            <div className="px-4 py-3 text-2xs font-mono text-accent-red">
              {(accountsError as Error).message}
            </div>
          )}

          {!loadingAccounts && accounts?.length === 0 && (
            <EmptyState
              icon={<Shield className="w-6 h-6" />}
              title="No accounts found"
              description="No NATS accounts were returned by the monitoring endpoint"
            />
          )}

          {accounts?.map(account => (
            <AccountRow
              key={account.name}
              account={account}
              connections={connections?.filter(u => u.account === account.name || u.account === '') ?? []}
            />
          ))}
        </div>
      </div>

      {/* Right: active connections / users */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-accent-cyan" />
            <span className="text-xs font-mono font-semibold text-text-primary uppercase tracking-widest">
              Active Connections
            </span>
            {connections && (
              <span className="text-2xs font-mono bg-bg-surface border border-bg-border px-1.5 rounded text-text-muted">
                {connections.length}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingConns && (
            <div className="flex justify-center py-8"><Spinner /></div>
          )}

          {!loadingConns && connections?.length === 0 && (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title="No active connections"
              description="No clients are currently connected to this cluster"
            />
          )}

          {connections && connections.length > 0 && (
            <ConnectionTable connections={connections} />
          )}
        </div>

        {/* Summary stats at bottom */}
        {accounts && (
          <div className="border-t border-bg-border px-4 py-3 flex flex-wrap gap-4">
            <SummaryItem
              label="Total Accounts"
              value={String(accounts.length)}
              icon={<Shield className="w-3.5 h-3.5" />}
            />
            <SummaryItem
              label="Total Connections"
              value={String(accounts.reduce((s, a) => s + a.connections, 0))}
              icon={<Users className="w-3.5 h-3.5" />}
            />
            <SummaryItem
              label="JetStream Accounts"
              value={String(accounts.filter(a => a.jetStream).length)}
              icon={<Database className="w-3.5 h-3.5" />}
            />
            <SummaryItem
              label="Total In"
              value={formatNumber(accounts.reduce((s, a) => s + a.inMsgs, 0)) + ' msgs'}
              icon={<Activity className="w-3.5 h-3.5 text-accent-green" />}
            />
            <SummaryItem
              label="Total Out"
              value={formatNumber(accounts.reduce((s, a) => s + a.outMsgs, 0)) + ' msgs'}
              icon={<Activity className="w-3.5 h-3.5 text-accent-cyan" />}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Account Row ───────────────────────────────────────────────────────────────

function AccountRow({
  account, connections,
}: {
  account: NATSAccount
  connections: NATSUser[]
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-bg-border/50">
      {/* Account header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-bg-hover transition-colors text-left"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        }

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-medium text-text-primary truncate">
              {account.name}
            </span>
            {account.jetStream && (
              <Badge variant="purple" size="xs">JS</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-2xs font-mono text-text-muted">
            <span>{account.connections} conn</span>
            <span>{formatNumber(account.subscriptions)} subs</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-0.5 text-2xs font-mono text-text-muted flex-shrink-0">
          <span className="text-accent-green">↑ {formatNumber(account.inMsgs)}</span>
          <span className="text-accent-cyan">↓ {formatNumber(account.outMsgs)}</span>
        </div>
      </button>

      {/* Expanded stats */}
      {expanded && (
        <div className="px-8 pb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs font-mono">
          <AccountStat label="Leaf Nodes"     value={String(account.leafNodes)} />
          <AccountStat label="Subscriptions"  value={formatNumber(account.subscriptions)} />
          <AccountStat label="In Bytes"       value={formatBytes(account.inBytes)} />
          <AccountStat label="Out Bytes"      value={formatBytes(account.outBytes)} />
          {connections.length > 0 && (
            <div className="col-span-2 mt-1">
              <p className="text-text-muted/60 mb-1">Connected users:</p>
              {connections.slice(0, 5).map((u, i) => (
                <p key={i} className="text-text-secondary truncate">
                  {u.username || '(anonymous)'} — {u.ip}:{u.port}
                </p>
              ))}
              {connections.length > 5 && (
                <p className="text-text-muted">+{connections.length - 5} more…</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AccountStat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </>
  )
}

// ── Connection Table ──────────────────────────────────────────────────────────

function ConnectionTable({ connections }: { connections: NATSUser[] }) {
  return (
    <div className="font-mono">
      {/* Header */}
      <div className="flex items-center gap-0 px-4 py-1.5 border-b border-bg-border/50 glass-sm text-2xs text-text-muted select-none sticky top-0">
        <span className="flex-1">USER / CLIENT</span>
        <span className="w-32 flex-shrink-0">ACCOUNT</span>
        <span className="w-36 flex-shrink-0">ADDRESS</span>
        <span className="w-16 flex-shrink-0 text-right">SUBS</span>
        <span className="w-20 flex-shrink-0 text-right text-accent-green">IN</span>
        <span className="w-20 flex-shrink-0 text-right text-accent-cyan">OUT</span>
      </div>

      {connections.map((user, i) => (
        <div
          key={i}
          className="flex items-center gap-0 px-4 py-1.5 border-b border-bg-border/50 hover:bg-bg-hover text-xs"
        >
          <span className="flex-1 text-text-primary font-mono truncate">
            {user.username || <span className="text-text-muted italic">anonymous</span>}
          </span>
          <span className="w-32 flex-shrink-0 text-text-muted truncate">
            {user.account || '$G'}
          </span>
          <span className="w-36 flex-shrink-0 text-text-muted font-mono text-2xs">
            {user.ip}:{user.port}
          </span>
          <span className="w-16 flex-shrink-0 text-right text-text-secondary">
            {formatNumber(user.subs)}
          </span>
          <span className="w-20 flex-shrink-0 text-right text-accent-green font-mono text-2xs">
            {formatNumber(user.inMsgs)}
          </span>
          <span className="w-20 flex-shrink-0 text-right text-accent-cyan font-mono text-2xs">
            {formatNumber(user.outMsgs)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Summary ───────────────────────────────────────────────────────────────────

function SummaryItem({ label, value, icon }: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-text-muted">{icon}</span>
      <div>
        <p className="text-2xs font-mono text-text-muted">{label}</p>
        <p className="text-xs font-mono font-semibold text-text-secondary">{value}</p>
      </div>
    </div>
  )
}
