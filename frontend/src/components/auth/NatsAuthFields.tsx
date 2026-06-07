/**
 * NatsAuthFields — reusable credential inputs for connecting to a secured NATS
 * server. Supports every auth mechanism NATS provides: user/password, token,
 * decentralized JWT (.creds), NKey seed, and TLS (CA certificate).
 *
 * Controlled component: the parent owns a `NatsAuth` value and merges
 * `authToProfile(value)` into the connection profile on submit.
 */
import { useState } from 'react'
import { ShieldOff, User, KeyRound, FileKey2, Hash, Lock, Eye, EyeOff } from 'lucide-react'
import type { ConnectionProfile } from '@/types'

export type NatsAuthMethod = 'none' | 'userpass' | 'token' | 'creds' | 'nkey'

export interface NatsAuth {
  method: NatsAuthMethod
  username: string
  password: string
  token: string
  credsContent: string
  nkeySeed: string
  tls: boolean
  tlsCaContent: string
}

export const emptyNatsAuth: NatsAuth = {
  method: 'none',
  username: '',
  password: '',
  token: '',
  credsContent: '',
  nkeySeed: '',
  tls: false,
  tlsCaContent: '',
}

/** Map the chosen auth into the connection-profile fields the backend expects. */
export function authToProfile(a: NatsAuth): Partial<ConnectionProfile> {
  const p: Partial<ConnectionProfile> = {}
  switch (a.method) {
    case 'userpass':
      if (a.username) p.username = a.username
      if (a.password) p.password = a.password
      break
    case 'token':
      if (a.token) p.token = a.token.trim()
      break
    case 'creds':
      if (a.credsContent) p.credsContent = a.credsContent
      break
    case 'nkey':
      if (a.nkeySeed) p.nkeySeed = a.nkeySeed.trim()
      break
  }
  if (a.tls && a.tlsCaContent) p.tlsCaContent = a.tlsCaContent
  return p
}

const METHODS: { id: NatsAuthMethod; label: string; icon: typeof User }[] = [
  { id: 'none',     label: 'None',          icon: ShieldOff },
  { id: 'userpass', label: 'User / Pass',   icon: User },
  { id: 'token',    label: 'Token',         icon: KeyRound },
  { id: 'creds',    label: 'Credentials',   icon: FileKey2 },
  { id: 'nkey',     label: 'NKey',          icon: Hash },
]

const LABEL = 'text-2xs font-mono text-text-muted uppercase tracking-widest block mb-1.5'

interface Props {
  value: NatsAuth
  onChange: (a: NatsAuth) => void
  disabled?: boolean
}

export function NatsAuthFields({ value, onChange, disabled }: Props) {
  const [showPass, setShowPass] = useState(false)
  const set = (patch: Partial<NatsAuth>) => onChange({ ...value, ...patch })

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Authentication</label>
        <div className="flex flex-wrap gap-1.5">
          {METHODS.map(({ id, label, icon: Icon }) => {
            const active = value.method === id
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => set({ method: id })}
                className={[
                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-2xs font-mono rounded-md border transition-colors',
                  active
                    ? 'bg-accent-primary/15 border-accent-primary/50 text-accent-primary'
                    : 'bg-bg-surface border-bg-border text-text-muted hover:text-text-secondary hover:border-bg-border-strong',
                ].join(' ')}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Method-specific fields ─────────────────────────────────────────── */}
      {value.method === 'userpass' && (
        <div className="grid grid-cols-2 gap-3 animate-fade-in">
          <div>
            <label className={LABEL}>Username</label>
            <input
              type="text" autoComplete="off" spellCheck={false} disabled={disabled}
              className="input-base" placeholder="app-user"
              value={value.username}
              onChange={e => set({ username: e.target.value })}
            />
          </div>
          <div>
            <label className={LABEL}>Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'} autoComplete="off" disabled={disabled}
                className="input-base pr-8" placeholder="••••••••"
                value={value.password}
                onChange={e => set({ password: e.target.value })}
              />
              <button
                type="button" tabIndex={-1}
                onClick={() => setShowPass(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
              >
                {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {value.method === 'token' && (
        <div className="animate-fade-in">
          <label className={LABEL}>Auth Token</label>
          <input
            type={showPass ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={disabled}
            className="input-base" placeholder="s3cr3t-token"
            value={value.token}
            onChange={e => set({ token: e.target.value })}
          />
        </div>
      )}

      {value.method === 'creds' && (
        <div className="animate-fade-in">
          <label className={LABEL}>Credentials (.creds file contents)</label>
          <textarea
            rows={4} spellCheck={false} disabled={disabled}
            className="input-base resize-none leading-relaxed"
            placeholder={'-----BEGIN NATS USER JWT-----\neyJ0eXAiOiJKV1Q...\n------END NATS USER JWT------\n...'}
            value={value.credsContent}
            onChange={e => set({ credsContent: e.target.value })}
          />
          <p className="text-2xs font-mono text-text-muted/60 mt-1">Paste the full decorated user .creds file</p>
        </div>
      )}

      {value.method === 'nkey' && (
        <div className="animate-fade-in">
          <label className={LABEL}>NKey Seed</label>
          <input
            type={showPass ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={disabled}
            className="input-base" placeholder="SUACSSL3UAHUDXKFSNVUZRF5UHPMWZ6BFDTJ7M6USDXIEDNPPQYYYCU3VY"
            value={value.nkeySeed}
            onChange={e => set({ nkeySeed: e.target.value })}
          />
          <p className="text-2xs font-mono text-text-muted/60 mt-1">The seed begins with “S”</p>
        </div>
      )}

      {/* ── TLS (optional, any method) ─────────────────────────────────────── */}
      <div className="pt-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox" disabled={disabled}
            checked={value.tls}
            onChange={e => set({ tls: e.target.checked })}
            className="accent-[color:var(--accent-primary)] w-3.5 h-3.5"
          />
          <Lock className="w-3 h-3 text-text-muted" />
          <span className="text-2xs font-mono text-text-secondary uppercase tracking-widest">TLS / self-signed CA</span>
        </label>
        {value.tls && (
          <div className="mt-2 animate-fade-in">
            <textarea
              rows={3} spellCheck={false} disabled={disabled}
              className="input-base resize-none leading-relaxed"
              placeholder={'-----BEGIN CERTIFICATE-----\nMIIDxz...\n-----END CERTIFICATE-----'}
              value={value.tlsCaContent}
              onChange={e => set({ tlsCaContent: e.target.value })}
            />
            <p className="text-2xs font-mono text-text-muted/60 mt-1">
              Paste CA cert (PEM). Use a <code className="text-accent-cyan">tls://</code> URL to force TLS.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
