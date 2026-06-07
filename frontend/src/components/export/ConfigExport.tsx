/**
 * ConfigExport — "config as code" for a stream or consumer.
 *
 * Generates the equivalent `nats` CLI command, server JSON config, and a
 * Terraform (nats-io/jetstream provider) resource from the live config object,
 * so a console-clicked stream/consumer can be moved into committed GitOps.
 * Pure client-side — the config is already fetched.
 */
import { useState } from 'react'
import { X, Copy, Check, FileCode } from 'lucide-react'
import { cn } from '@/components/ui'
import type { StreamConfig, ConsumerConfig } from '@/types'

type Format = 'cli' | 'json' | 'terraform'

// ── helpers ──────────────────────────────────────────────────────────────────

function nsToDur(ns?: number): string {
  const n = ns ?? 0
  if (n <= 0) return '0s'
  const sec = Math.round(n / 1e9)
  if (sec % 3600 === 0) return `${sec / 3600}h`
  if (sec % 60 === 0) return `${sec / 60}m`
  return `${sec}s`
}
const tfId = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_')

// ── Stream generators ─────────────────────────────────────────────────────────

function streamCLI(c: StreamConfig): string {
  const L = [`nats stream add ${c.name} \\`]
  L.push(`  --subjects "${c.subjects.join(',')}" \\`)
  L.push(`  --storage ${c.storage} \\`)
  L.push(`  --retention ${c.retention} \\`)
  L.push(`  --replicas ${c.replicas} \\`)
  L.push(`  --max-age ${nsToDur(c.maxAge)} \\`)
  L.push(`  --max-bytes ${c.maxBytes ?? -1} \\`)
  L.push(`  --max-msgs ${c.maxMsgs ?? -1} \\`)
  L.push(`  --max-msg-size ${c.maxMsgSize ?? -1} \\`)
  L.push(`  --discard ${c.discard ?? 'old'} \\`)
  L.push(`  --dupe-window ${nsToDur(c.duplicates)} \\`)
  if (c.description) L.push(`  --description "${c.description}" \\`)
  L.push(`  --defaults`)
  return L.join('\n')
}
function streamJSON(c: StreamConfig): string {
  return JSON.stringify({
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    subjects: c.subjects,
    retention: c.retention,
    storage: c.storage,
    num_replicas: c.replicas,
    max_consumers: -1,
    max_msgs: c.maxMsgs ?? -1,
    max_bytes: c.maxBytes ?? -1,
    max_age: c.maxAge ?? 0,
    max_msg_size: c.maxMsgSize ?? -1,
    discard: c.discard ?? 'old',
    duplicate_window: c.duplicates ?? 0,
  }, null, 2)
}
function streamTF(c: StreamConfig): string {
  const L = [`resource "jetstream_stream" "${tfId(c.name)}" {`]
  L.push(`  name      = "${c.name}"`)
  L.push(`  subjects  = [${c.subjects.map(s => `"${s}"`).join(', ')}]`)
  L.push(`  storage   = "${c.storage}"`)
  L.push(`  retention = "${c.retention}"`)
  L.push(`  replicas  = ${c.replicas}`)
  L.push(`  max_age   = ${Math.round((c.maxAge ?? 0) / 1e9)}`)
  L.push(`  max_bytes = ${c.maxBytes ?? -1}`)
  L.push(`  max_msgs  = ${c.maxMsgs ?? -1}`)
  if (c.description) L.push(`  description = "${c.description}"`)
  L.push(`}`)
  return L.join('\n')
}

// ── Consumer generators ─────────────────────────────────────────────────────────

function deliverCLI(c: ConsumerConfig): string {
  switch (c.deliverPolicy) {
    case 'by_start_sequence': return String(c.optStartSeq ?? 1)
    case 'by_start_time':     return c.optStartTime ?? 'all'
    default:                  return c.deliverPolicy
  }
}
function consumerCLI(stream: string, c: ConsumerConfig): string {
  const name = c.durableName || c.name
  const L = [`nats consumer add ${stream} ${name} \\`]
  if (c.deliverSubject) L.push(`  --target "${c.deliverSubject}" \\`)
  else L.push(`  --pull \\`)
  L.push(`  --deliver ${deliverCLI(c)} \\`)
  L.push(`  --ack ${c.ackPolicy} \\`)
  L.push(`  --replay ${c.replayPolicy} \\`)
  L.push(`  --filter "${c.filterSubject ?? ''}" \\`)
  if (c.ackWait) L.push(`  --ack-wait ${nsToDur(c.ackWait)} \\`)
  L.push(`  --max-deliver ${c.maxDeliver ?? -1} \\`)
  if (c.maxAckPending) L.push(`  --max-pending ${c.maxAckPending} \\`)
  if (c.deliverGroup) L.push(`  --deliver-group "${c.deliverGroup}" \\`)
  if (c.description) L.push(`  --description "${c.description}" \\`)
  L.push(`  --defaults`)
  return L.join('\n')
}
function consumerJSON(c: ConsumerConfig): string {
  return JSON.stringify({
    durable_name: c.durableName || c.name,
    ...(c.description ? { description: c.description } : {}),
    ...(c.deliverSubject ? { deliver_subject: c.deliverSubject } : {}),
    ...(c.deliverGroup ? { deliver_group: c.deliverGroup } : {}),
    deliver_policy: c.deliverPolicy,
    ...(c.optStartSeq ? { opt_start_seq: c.optStartSeq } : {}),
    ...(c.optStartTime ? { opt_start_time: c.optStartTime } : {}),
    ack_policy: c.ackPolicy,
    ack_wait: c.ackWait ?? 0,
    max_deliver: c.maxDeliver ?? -1,
    ...(c.filterSubject ? { filter_subject: c.filterSubject } : {}),
    replay_policy: c.replayPolicy,
    max_ack_pending: c.maxAckPending ?? 0,
  }, null, 2)
}
function consumerTF(stream: string, c: ConsumerConfig): string {
  const name = c.durableName || c.name
  const L = [`resource "jetstream_consumer" "${tfId(stream + '_' + name)}" {`]
  L.push(`  stream_id     = jetstream_stream.${tfId(stream)}.id`)
  L.push(`  durable_name  = "${name}"`)
  L.push(`  deliver_all   = ${c.deliverPolicy === 'all'}`)
  L.push(`  deliver_last  = ${c.deliverPolicy === 'last'}`)
  L.push(`  deliver_new   = ${c.deliverPolicy === 'new'}`)
  L.push(`  ack_policy    = "${c.ackPolicy}"`)
  L.push(`  replay_policy = "${c.replayPolicy}"`)
  if (c.filterSubject) L.push(`  filter_subject = "${c.filterSubject}"`)
  if (c.maxDeliver != null) L.push(`  max_delivery  = ${c.maxDeliver}`)
  if (c.ackWait) L.push(`  ack_wait      = ${Math.round(c.ackWait / 1e9)}`)
  L.push(`}`)
  return L.join('\n')
}

// ── Modal ────────────────────────────────────────────────────────────────────

type ExportProps =
  | { kind: 'stream'; config: StreamConfig; onClose: () => void }
  | { kind: 'consumer'; stream: string; config: ConsumerConfig; onClose: () => void }

export function ConfigExportModal(props: ExportProps) {
  const [fmt, setFmt]     = useState<Format>('cli')
  const [copied, setCopied] = useState(false)

  const name = props.config.name
  const gen: Record<Format, string> = props.kind === 'stream'
    ? { cli: streamCLI(props.config), json: streamJSON(props.config), terraform: streamTF(props.config) }
    : { cli: consumerCLI(props.stream, props.config), json: consumerJSON(props.config), terraform: consumerTF(props.stream, props.config) }

  const text = gen[fmt]

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { /* clipboard blocked */ }
  }

  const tabs: { id: Format; label: string }[] = [
    { id: 'cli', label: 'nats CLI' },
    { id: 'json', label: 'JSON' },
    { id: 'terraform', label: 'Terraform' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-6" onClick={props.onClose}>
      <div className="surface-card w-full max-w-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-bg-border">
          <FileCode className="w-4 h-4 text-accent-primary" />
          <h2 className="text-sm font-mono font-semibold text-text-primary flex-1">
            Export {props.kind} <span className="text-accent-cyan">{name}</span>
          </h2>
          <button onClick={props.onClose} className="text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex items-center gap-1 px-5 pt-3">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setFmt(t.id)}
              className={cn('px-3 py-1.5 text-xs font-mono rounded-t-md border-b-2 transition-colors',
                fmt === t.id ? 'border-accent-primary text-accent-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
              {t.label}
            </button>
          ))}
          <button onClick={copy} className={cn(
            'ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-sans border transition-colors',
            copied ? 'border-accent-green/40 text-accent-green bg-accent-green/10' : 'border-bg-border text-text-secondary hover:border-accent-primary/40 hover:text-accent-primary')}>
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 pt-3">
          <pre className="font-mono text-xs leading-relaxed text-text-secondary bg-bg-base border border-bg-border rounded-lg p-4 overflow-auto whitespace-pre">
            {text}
          </pre>
        </div>
      </div>
    </div>
  )
}
