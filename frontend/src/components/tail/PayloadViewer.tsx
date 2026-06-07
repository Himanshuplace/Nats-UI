import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { Copy, Check } from 'lucide-react'
import { cn, Badge, Button } from '@/components/ui'
import { tryParseJSON, formatTimestamp, formatBytes } from '@/lib/format'
import type { TailedMessage } from '@/types'

type TabId = 'payload' | 'headers' | 'meta'

export function PayloadViewer({ message }: { message: TailedMessage }) {
  const [tab, setTab]         = useState<TabId>('payload')
  const [copied, setCopied]   = useState(false)
  const [viewMode, setMode]   = useState<'text' | 'json' | 'hex'>('text')

  const text     = message.payloadText ?? ''
  const jsonParse = tryParseJSON(text)
  const pretty   = jsonParse.ok ? jsonParse.pretty : text

  const handleCopy = async () => {
    await navigator.clipboard.writeText(pretty)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: 'payload', label: 'Payload' },
    { id: 'headers', label: `Headers (${Object.keys(message.headers ?? {}).length})` },
    { id: 'meta',    label: 'Metadata' },
  ]

  return (
    <div className="border border-bg-border/50 rounded-lg overflow-hidden glass">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-bg-border/50 glass-sm">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3 py-1.5 text-2xs font-mono transition-colors border-r border-bg-border',
              tab === t.id
                ? 'text-accent-primary bg-bg-surface'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
            )}
          >
            {t.label}
          </button>
        ))}

        {tab === 'payload' && (
          <div className="flex items-center gap-1 ml-auto px-2">
            {(['text', 'json', 'hex'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setMode(mode)}
                className={cn(
                  'px-1.5 py-0.5 text-2xs font-mono rounded transition-colors',
                  viewMode === mode
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {mode.toUpperCase()}
              </button>
            ))}
            <button
              onClick={handleCopy}
              className="p-1 text-text-muted hover:text-text-secondary transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-accent-green" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto">
        {tab === 'payload' && (
          <>
            {viewMode === 'json' && jsonParse.ok ? (
              <Editor
                height="200px"
                language="json"
                value={pretty}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, monospace',
                  lineNumbers: 'off',
                  folding: true,
                  wordWrap: 'on',
                  renderLineHighlight: 'none',
                  contextmenu: false,
                  padding: { top: 8, bottom: 8 },
                }}
              />
            ) : viewMode === 'hex' ? (
              <HexDump text={text} />
            ) : (
              <pre className="p-3 text-xs font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed">
                {text || <span className="text-text-muted italic">(empty payload)</span>}
              </pre>
            )}
          </>
        )}

        {tab === 'headers' && (
          <div className="p-3">
            {Object.keys(message.headers ?? {}).length === 0 ? (
              <span className="text-2xs font-mono text-text-muted italic">No headers</span>
            ) : (
              <table className="w-full text-xs font-mono">
                <tbody>
                  {Object.entries(message.headers ?? {}).map(([k, v]) => (
                    <tr key={k} className="border-b border-bg-border/40 last:border-0">
                      <td className="py-1.5 pr-4 text-text-muted text-2xs uppercase tracking-wide align-top whitespace-nowrap">
                        {k}
                      </td>
                      <td className="py-1.5 text-text-secondary break-all">
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'meta' && (
          <div className="p-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
            <MetaRow label="Subject"   value={message.subject} />
            <MetaRow label="Sequence"  value={String(message.seq)} />
            <MetaRow label="Stream"    value={message.stream} />
            <MetaRow label="Size"      value={formatBytes(message.payloadSize)} />
            <MetaRow label="Timestamp" value={formatTimestamp(message.timestamp)} />
            <MetaRow
              label="Redelivered"
              value={message.redelivered ? 'Yes' : 'No'}
              valueClass={message.redelivered ? 'text-accent-yellow' : 'text-text-secondary'}
            />
            {message.replyTo && (
              <MetaRow label="Reply-To" value={message.replyTo} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MetaRow({ label, value, valueClass }: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <>
      <span className="text-text-muted text-2xs uppercase tracking-wide">{label}</span>
      <span className={cn('text-text-secondary break-all', valueClass)}>{value}</span>
    </>
  )
}

function HexDump({ text }: { text: string }) {
  const bytes = new TextEncoder().encode(text)
  const rows: string[] = []
  for (let i = 0; i < Math.min(bytes.length, 512); i += 16) {
    const chunk = bytes.slice(i, i + 16)
    const hex   = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(chunk)
      .map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'))
      .join('')
    const addr  = i.toString(16).padStart(8, '0')
    rows.push(`${addr}  ${hex.padEnd(47)}  ${ascii}`)
  }

  return (
    <pre className="p-3 text-2xs font-mono text-text-muted whitespace-pre overflow-x-auto leading-relaxed">
      {rows.join('\n')}
      {bytes.length > 512 && `\n... (${bytes.length - 512} more bytes)`}
    </pre>
  )
}
