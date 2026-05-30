import { useState } from 'react'
import { Server, ArrowRight, CheckCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { ParticleBackground } from '@/components/three/ParticleBackground'

interface Props {
  onConnected: (clusterId: string) => void
}

function normalizeNatsURL(input: string): string {
  const v = input.trim()
  if (!v) return ''
  if (v.startsWith('nats://') || v.startsWith('tls://')) return v
  // "host:port" → add scheme
  if (v.includes(':')) return 'nats://' + v
  // plain host/IP → add scheme + default port
  return 'nats://' + v + ':4222'
}

export function ConnectionSetup({ onConnected }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const rawAddr = (fd.get('address') as string).trim()
    const name = (fd.get('name') as string).trim() || rawAddr

    if (!rawAddr) {
      setError('Server address is required')
      return
    }

    const url = normalizeNatsURL(rawAddr)

    setLoading(true)
    setError(null)
    try {
      const res = await api.connections.connect({ name, url })
      onConnected(res.id)
    } catch (err: any) {
      setError(err.message ?? 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-bg-base overflow-hidden">
      <ParticleBackground />

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent-green/10 border border-accent-green/20 mb-4">
            <Server className="w-6 h-6 text-accent-green" />
          </div>
          <h1 className="text-2xl font-sans font-semibold text-text-primary tracking-tight">Connect to NATS</h1>
          <p className="text-sm font-mono text-text-muted mt-1">
            Enter the address of your NATS server or cluster
          </p>
        </div>

        {/* Card */}
        <div className="surface-card p-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">
                Connection Name <span className="normal-case opacity-60">(optional)</span>
              </label>
              <input
                name="name"
                type="text"
                placeholder="Production Cluster"
                className="input-base"
                disabled={loading}
              />
            </div>

            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">
                Server Address
              </label>
              <input
                name="address"
                type="text"
                placeholder="192.168.1.100:4222"
                required
                className="input-base"
                disabled={loading}
              />
              <div className="mt-2 space-y-1">
                {[
                  ['192.168.1.100', 'IP address (port defaults to 4222)'],
                  ['192.168.1.100:4222', 'IP address with port'],
                  ['my-nats-server.com:4222', 'Domain name with port'],
                  ['nats://10.0.0.5:4222', 'Full nats:// URL'],
                ].map(([ex, desc]) => (
                  <div key={ex} className="flex items-center gap-2">
                    <CheckCircle className="w-3 h-3 text-accent-green/50 flex-shrink-0" />
                    <code className="text-2xs font-mono text-accent-cyan">{ex}</code>
                    <span className="text-2xs font-mono text-text-muted/60">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-xs font-mono text-accent-red bg-accent-red/10 border border-accent-red/20 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2 px-4
                         bg-accent-green text-bg-base text-sm font-mono font-semibold rounded-lg
                         hover:bg-accent-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Connecting…' : (
                <>
                  Connect
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-2xs font-mono text-text-muted/50 mt-4">
          You can manage connections later from Settings
        </p>
      </div>
    </div>
  )
}
