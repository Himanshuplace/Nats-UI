import { useState } from 'react'
import { Eye, EyeOff, Wifi } from 'lucide-react'
import { api } from '@/lib/api'
import { useUIStore } from '@/store'
import { ParticleBackground } from '@/components/three/ParticleBackground'

export function LoginPage() {
  const setAuth = useUIStore(s => s.setAuth)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const username = (fd.get('username') as string).trim()
    const password = fd.get('password') as string

    if (!username || !password) {
      setError('Username and password are required')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await api.auth.login(username, password)
      setAuth(res.token)
    } catch (err: any) {
      setError(err.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-bg-base overflow-hidden">
      <ParticleBackground />

      <div className="relative z-10 w-full max-w-sm px-4">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent-primary/10 border border-accent-primary/20 mb-4">
            <Wifi className="w-6 h-6 text-accent-primary" />
          </div>
          <h1 className="text-2xl font-sans font-semibold text-text-primary tracking-tight">NatsUI</h1>
          <p className="text-sm font-mono text-text-muted mt-1">Realtime NATS Control Plane</p>
        </div>

        {/* Card */}
        <div className="surface-card p-6 space-y-5">
          <div>
            <h2 className="text-sm font-sans font-semibold text-text-primary">Sign in</h2>
            <p className="text-xs font-mono text-text-muted mt-0.5">
              Use the credentials from your <code className="text-accent-primary">natsui.json</code> config
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">
                Username
              </label>
              <input
                name="username"
                type="text"
                autoComplete="username"
                defaultValue="admin"
                className="input-base"
                disabled={loading}
              />
            </div>

            <div>
              <label className="text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="input-base pr-9"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                  tabIndex={-1}
                >
                  {showPassword
                    ? <EyeOff className="w-3.5 h-3.5" />
                    : <Eye className="w-3.5 h-3.5" />
                  }
                </button>
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
              className="w-full py-2 px-4 bg-accent-primary text-bg-base text-sm font-mono font-semibold rounded-lg
                         hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
