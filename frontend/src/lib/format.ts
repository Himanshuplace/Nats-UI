// ── Byte formatting ───────────────────────────────────────────────────────────

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatBytesPerSec(bps: number): string {
  return formatBytes(bps) + '/s'
}

// ── Number formatting ─────────────────────────────────────────────────────────

export function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

export function formatMsgsPerSec(mps: number): string {
  return formatNumber(mps) + ' msg/s'
}

export function formatLag(lag: number): { label: string; severity: 'ok' | 'warn' | 'critical' } {
  if (lag === 0) return { label: '0', severity: 'ok' }
  if (lag < 1000) return { label: formatNumber(lag), severity: 'ok' }
  if (lag < 100_000) return { label: formatNumber(lag), severity: 'warn' }
  return { label: formatNumber(lag), severity: 'critical' }
}

// ── Duration formatting ───────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

// ── Time formatting ───────────────────────────────────────────────────────────

export function formatTimestamp(ts: string | number): string {
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts)
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
}

export function formatTimeAgo(ts: string | number): string {
  const now = Date.now()
  const then = typeof ts === 'string' ? new Date(ts).getTime() : ts
  const diff = now - then

  if (diff < 1000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function formatHHMMSS(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

// ── Payload formatting ────────────────────────────────────────────────────────

export function tryParseJSON(s: string): { ok: true; pretty: string } | { ok: false } {
  try {
    const parsed = JSON.parse(s)
    return { ok: true, pretty: JSON.stringify(parsed, null, 2) }
  } catch {
    return { ok: false }
  }
}

export function base64ToText(b64: string): string {
  try {
    return atob(b64)
  } catch {
    return b64
  }
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

// ── Color utilities ───────────────────────────────────────────────────────────

export function healthColor(health: string): string {
  switch (health) {
    case 'ok':               return 'text-accent-green'
    case 'degraded':
    case 'slow':
    case 'lagging':          return 'text-accent-yellow'
    case 'critical':
    case 'dead':
    case 'redelivery_storm': return 'text-accent-red'
    default:                 return 'text-text-secondary'
  }
}

export function healthBg(health: string): string {
  switch (health) {
    case 'ok':               return 'bg-accent-green/10 border-accent-green/20'
    case 'degraded':
    case 'slow':
    case 'lagging':          return 'bg-accent-yellow/10 border-accent-yellow/20'
    case 'critical':
    case 'dead':
    case 'redelivery_storm': return 'bg-accent-red/10 border-accent-red/20'
    default:                 return 'bg-bg-surface border-bg-border'
  }
}

export function healthDot(health: string): string {
  switch (health) {
    case 'ok':               return 'bg-accent-green'
    case 'degraded':
    case 'slow':
    case 'lagging':          return 'bg-accent-yellow'
    case 'critical':
    case 'dead':
    case 'redelivery_storm': return 'bg-accent-red animate-pulse'
    default:                 return 'bg-text-muted'
  }
}

export function sourceLabel(source: string): string {
  switch (source) {
    case 'local':      return 'LOCAL'
    case 'docker':     return 'DOCKER'
    case 'kubernetes': return 'K8S'
    case 'manual':     return 'MANUAL'
    default:           return source.toUpperCase()
  }
}
