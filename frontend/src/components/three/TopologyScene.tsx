/**
 * TopologyScene — real WebGL 3D NATS cluster topology (data-first).
 *
 * "Obsidian Chips": each NATS server is a slim matte-dark hexagonal puck
 * floating in a pure ink void (no grid, no mirror floor) — the 3D extension
 * of the app's surface cards. Almost all color is removed from the bodies;
 * the ONLY color is precise light: a thin progress-style arc ring around each
 * chip encoding RELATIVE LOAD (fill % = load share, color runs the cyan →
 * indigo → violet → rose heat ramp from real per-node message rates), plus
 * the message pulses. Health stays on the node card + tooltip. Hairline
 * violet route wires thicken slightly with REAL relative route load. Every
 * travelling comet pulse is ONE real message sampled from a filtered ">"
 * feed (app subjects = theme violet, internal $…/_… = amber), with the
 * newest packets carrying their subject as a tag. Nothing is synthetic.
 *
 * Rendered with @react-three/fiber + drei (lazy-loaded by ClusterTopology so
 * Three.js never touches the initial bundle).
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { TrackballControls, Edges, Html, Line, Text, Billboard, Environment, Lightformer } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { ws } from '@/lib/ws'
import type { NodeInfo, RouteInfo } from '@/types'

export interface TopologySceneProps {
  clusterId:       string
  nodes:           NodeInfo[]
  routes:          RouteInfo[]
  totalThroughput: number
  /** When true (default) only external/app subjects show; internal NATS &
   *  JetStream traffic ($…, _…) is hidden. Driven by the cluster-bar toggle. */
  externalOnly:    boolean
}

// ── Palette (Refine Midnight Violet, obsidian) ──────────────────────────────────
const BG          = '#06070f'
const CYAN_HEX    = '#22d3ee'
const AMBER_HEX   = '#f59e0b'
const RED_HEX     = '#ef4444'
const VIOLET_HEX  = '#a78bfa'   // app --accent-primary
const WIRE_DIM    = '#4c4178'   // muted violet — idle route wires
const WIRE_HOT    = '#c4b5fd'   // bright violet — loaded route wires

const NODE_Y = 0.3   // wire/particle travel height (just above the chips)
const HEX_H  = 0.3   // slim puck height
const HEX_R  = 1.15  // puck radius
const SCRATCH_SCALE = new THREE.Vector3()  // reused each frame (avoids per-frame alloc)

function healthHex(h: string): string {
  if (h === 'critical') return RED_HEX
  if (h === 'degraded') return AMBER_HEX
  return CYAN_HEX
}

// ── Load heatmap (cyan = least busy node, rose = busiest) ────────────────────────

// Thermal ramp on the scene's own palette: calm cyan → indigo → violet → hot
// rose. Idle nodes blend into the holographic identity; only genuinely hot
// nodes pull toward warm rose — a heatmap should be quiet until it matters.
const HEAT_STOPS = ['#22d3ee', '#818cf8', '#c084fc', '#fb7185'].map(h => new THREE.Color(h))

/** Relative load 0..1 → piecewise blend along HEAT_STOPS. */
function heatColor(t: number): THREE.Color {
  const x = THREE.MathUtils.clamp(t, 0, 1) * (HEAT_STOPS.length - 1)
  const i = Math.min(Math.floor(x), HEAT_STOPS.length - 2)
  return HEAT_STOPS[i].clone().lerp(HEAT_STOPS[i + 1], x - i)
}

function heatHex(t: number): string {
  return `#${heatColor(t).getHexString()}`
}

/**
 * Per-node relative load 0..1. Uses the REAL message rate (delta of
 * inMsgs+outMsgs between topology refreshes) so a long-lived idle node isn't
 * painted hot by its cumulative counters; before the second snapshot it falls
 * back to cumulative share. Min-max normalized across nodes: the least busy
 * node is 0 (cool cyan), the busiest is 1 (hot rose). When every node carries
 * the same load there is no hotspot, so all stay cool.
 */
function useNodeHeat(nodes: NodeInfo[]): number[] {
  const prev = useRef(new Map<string, { total: number; at: number }>())
  const rate = useRef(new Map<string, number>())
  return useMemo(() => {
    const now = performance.now()
    for (const n of nodes) {
      const total = (n.inMsgs ?? 0) + (n.outMsgs ?? 0)
      const p = prev.current.get(n.id)
      if (!p) {
        prev.current.set(n.id, { total, at: now })
      } else if (now - p.at > 1500) {   // ignore re-renders of the same snapshot
        rate.current.set(n.id, Math.max(0, total - p.total) / ((now - p.at) / 1000))
        prev.current.set(n.id, { total, at: now })
      }
    }
    const hasRates = nodes.some(n => rate.current.has(n.id))
    const vals = nodes.map(n =>
      hasRates ? (rate.current.get(n.id) ?? 0) : (n.inMsgs ?? 0) + (n.outMsgs ?? 0))
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    if (max <= min) return nodes.map(() => 0)
    return vals.map(v => (v - min) / (max - min))
  }, [nodes])
}

/** Full exact number with thousands separators — 4823915 → "4,823,915". */
function full(n: number): string {
  return Math.round(n ?? 0).toLocaleString('en-US')
}

/** Human-readable byte size with the exact count — 1572864 → "1.5 MB (1,572,864 B)". */
function bytes(n: number): string {
  n = n ?? 0
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n, i = -1
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${u[i]} (${full(n)} B)`
}

/** Lay nodes out on the floor (XZ plane). Single node is centered. */
function layout(n: number): THREE.Vector3[] {
  if (n <= 0) return []
  if (n === 1) return [new THREE.Vector3(0, 0, 0)]
  const R = Math.max(3.4, n * 0.95)
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)
  })
}

// ── Node ────────────────────────────────────────────────────────────────────────

interface HexNodeProps {
  node:     NodeInfo
  position: THREE.Vector3
  /** 0..1 relative load — fills & colors the arc ring cyan (cool) → rose (hot). */
  heat:     number
  hovered:  boolean
  onOver:   () => void
  onOut:    () => void
  onDown:   () => void
}

function HexNode({ node, position, heat, hovered, onOver, onOut, onDown }: HexNodeProps) {
  const matRef  = useRef<THREE.MeshStandardMaterial>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const col = useMemo(() => heatColor(heat), [heat])
  const hpx = healthHex(node.health)

  // Progress-ring load arc: the filled portion = this node's load share, like
  // the app's circular progress indicators. Rebuilt only on the 10s refresh.
  // Always shows a small sliver so idle nodes still read as "alive".
  const arcGeom = useMemo(() => {
    const sweep = Math.max(0.06, heat) * Math.PI * 2
    // start at 12 o'clock, sweep clockwise (negative theta direction)
    return new THREE.RingGeometry(HEX_R * 1.26, HEX_R * 1.33, 64, 1, Math.PI / 2 - sweep, sweep)
  }, [heat])
  useEffect(() => () => arcGeom.dispose(), [arcGeom])

  // Quiet chips — the only motion is a gentle hover response: a slight grow
  // and a touch more inner light. No breathing, no pulsing.
  useFrame(() => {
    if (matRef.current) {
      const target = hovered ? 1.4 : 0.7
      matRef.current.emissiveIntensity += (target - matRef.current.emissiveIntensity) * 0.12
    }
    if (meshRef.current) {
      const s = hovered ? 1.08 : 1
      meshRef.current.scale.lerp(SCRATCH_SCALE.set(s, s, s), 0.16)
    }
  })

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Matte obsidian puck — the app's surface-card, extruded */}
      <mesh
        ref={meshRef}
        position={[0, HEX_H / 2, 0]}
        rotation={[0, Math.PI / 6, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onOver(); document.body.style.cursor = 'grab' }}
        onPointerOut={(e) => { e.stopPropagation(); onOut(); document.body.style.cursor = 'auto' }}
        onPointerDown={(e) => { e.stopPropagation(); document.body.style.cursor = 'grabbing'; onDown() }}
      >
        <cylinderGeometry args={[HEX_R, HEX_R, HEX_H, 6]} />
        <meshStandardMaterial
          ref={matRef}
          color="#11141d" emissive="#1a1533" emissiveIntensity={0.7}
          metalness={0.5} roughness={0.45} envMapIntensity={0.65}
        />
        {/* hairline rim — the app's 1px card border, brighter on hover */}
        <Edges threshold={15} color="#8d80d6" lineWidth={1.2} transparent opacity={hovered ? 0.95 : 0.55} />
      </mesh>

      {/* Load ring: faint full track + heat-colored filled arc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[HEX_R * 1.26, HEX_R * 1.33, 64]} />
        <meshBasicMaterial color="#2a2348" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} geometry={arcGeom}>
        <meshBasicMaterial color={col} transparent opacity={0.95} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>

      {/* Leader: hairline violet hex ring inset on the top face */}
      {node.role === 'leader' && (
        <mesh position={[0, HEX_H + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[HEX_R * 0.5, HEX_R * 0.56, 6]} />
          <meshBasicMaterial color={VIOLET_HEX} transparent opacity={0.85} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}

      {/* Always-on data card: name · health · live in/out (data-first) */}
      <Html position={[0, HEX_H + 0.85, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[15, 0]}>
        <div style={{
          pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'center',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace', transform: 'translateY(-4px)',
          display: 'inline-block', padding: '3px 9px', borderRadius: 9,
          background: 'rgba(6,7,15,0.72)', border: '1px solid rgba(167,139,250,0.22)', backdropFilter: 'blur(4px)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#eaf7ff' }}>
            {node.name}
            {node.role === 'leader' && <span style={{ color: VIOLET_HEX, marginLeft: 5 }}>◆</span>}
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: hpx, letterSpacing: '0.06em', marginTop: 1 }}>
            {node.health.toUpperCase()}
          </div>
          <div style={{ fontSize: 10, marginTop: 2, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>
            {/* in = violet, out = cyan — same pairing as the cluster bar chips */}
            <span style={{ color: VIOLET_HEX }}>↓</span>{full(node.inMsgs)}
            <span style={{ opacity: 0.4, margin: '0 5px' }}>·</span>
            <span style={{ color: CYAN_HEX }}>↑</span>{full(node.outMsgs)}
          </div>
        </div>
      </Html>
    </group>
  )
}

// ── Hover tooltip ────────────────────────────────────────────────────────────────

function NodeTooltip({ node, position, heat }: { node: NodeInfo; position: THREE.Vector3; heat: number }) {
  return (
    <Html position={[position.x, NODE_Y + HEX_H + 0.2, position.z]} style={{ pointerEvents: 'none' }} zIndexRange={[30, 20]}>
      <div style={{
        pointerEvents: 'none', transform: 'translate(16px, -50%)', minWidth: 212,
        background: 'rgba(6,7,15,0.94)', border: `1px solid ${healthHex(node.health)}55`,
        borderRadius: 8, padding: '10px 13px', boxShadow: `0 0 24px ${healthHex(node.health)}22`,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 10, lineHeight: '1.85',
        color: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)',
      }}>
        <div style={{ color: '#c4b5fd', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
          {node.name}
          {node.role === 'leader' && <span style={{ marginLeft: 6, fontSize: 9, color: VIOLET_HEX }}>◆ LEADER</span>}
        </div>
        <TipRow label="HOST"    value={`${node.host}:${node.port}`} />
        <TipRow label="VERSION" value={node.version || '—'} />
        <TipRow label="JETSTREAM" value={node.jetstream ? 'ENABLED' : 'OFF'}
          color={node.jetstream ? VIOLET_HEX : undefined} />
        <div style={{ borderTop: '1px solid rgba(167,139,250,0.18)', margin: '6px 0' }} />
        <TipRow label="CLIENTS" value={full(node.clients)} />
        <TipRow label="SUBS"    value={full(node.subscriptions)} />
        <TipRow label="SLOW CONSUMERS" value={full(node.slowClients)}
          color={node.slowClients > 0 ? AMBER_HEX : undefined} />
        <div style={{ borderTop: '1px solid rgba(167,139,250,0.18)', margin: '6px 0' }} />
        <TipRow label="↑ MSGS IN"  value={full(node.inMsgs)}  color={VIOLET_HEX} />
        <TipRow label="↓ MSGS OUT" value={full(node.outMsgs)} color={CYAN_HEX} />
        <TipRow label="↑ DATA IN"  value={bytes(node.inBytes)}  color={VIOLET_HEX} />
        <TipRow label="↓ DATA OUT" value={bytes(node.outBytes)} color={CYAN_HEX} />
        <div style={{ borderTop: '1px solid rgba(167,139,250,0.18)', margin: '6px 0' }} />
        <TipRow label="UPTIME"  value={node.uptime || '—'} />
        <TipRow label="REL LOAD" value={heat >= 0.999 ? 'HOTTEST' : heat <= 0.001 ? 'COOLEST' : `${Math.round(heat * 100)}%`} color={heatHex(heat)} />
        <TipRow
          label="HEALTH" value={node.health.toUpperCase()}
          color={node.health === 'ok' ? '#22d3ee' : node.health === 'degraded' ? AMBER_HEX : RED_HEX}
        />
      </div>
    </Html>
  )
}

function TipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
      <span style={{ color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: color ?? 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

// ── Connection wires ─────────────────────────────────────────────────────────────

interface Edge { ai: number; bi: number; weight: number }

/** Build the logical edge graph used by both the wires and the particle flow. */
function buildEdges(nodes: NodeInfo[], routes: RouteInfo[]): Edge[] {
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]))
  const out: Edge[] = []
  for (const r of routes) {
    const ai = idToIdx.get(r.from) ?? -1
    const bi = idToIdx.get(r.to) ?? -1
    if (ai === -1 || bi === -1 || ai === bi) continue
    const w = (nodes[ai].outMsgs ?? 0) + (nodes[bi].outMsgs ?? 0) + 1
    out.push({ ai, bi, weight: w })
  }
  // Fallback: ring mesh when no routes are reported but we have ≥2 nodes.
  if (out.length === 0 && nodes.length >= 2) {
    for (let i = 0; i < nodes.length; i++) {
      const j = (i + 1) % nodes.length
      out.push({ ai: i, bi: j, weight: (nodes[i].outMsgs ?? 0) + 1 })
    }
  }
  return out
}

/** Arc control point above the midpoint of an edge. */
function arcMid(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const m = a.clone().lerp(b, 0.5)
  m.y += a.distanceTo(b) * 0.18 + 0.6
  return m
}

function EdgeWires({ nodes, routes, positions }: { nodes: NodeInfo[]; routes: RouteInfo[]; positions: THREE.Vector3[] }) {
  const edges = useMemo(() => buildEdges(nodes, routes), [nodes, routes])

  // Hairline routes — load still nudges width/brightness (log-scaled against
  // the busiest link) but everything stays thin; the pulses carry the energy.
  const wires = useMemo(() => {
    const maxW = edges.reduce((m, e) => Math.max(m, e.weight), 1)
    const denom = Math.log10(1 + maxW) || 1
    return edges.map(({ ai, bi, weight }) => {
      const a = new THREE.Vector3(positions[ai].x, NODE_Y, positions[ai].z)
      const b = new THREE.Vector3(positions[bi].x, NODE_Y, positions[bi].z)
      const pts = new THREE.QuadraticBezierCurve3(a, arcMid(a, b), b).getPoints(28)
      const load = Math.min(1, Math.log10(1 + weight) / denom)
      const color = new THREE.Color(WIRE_DIM).lerp(new THREE.Color(WIRE_HOT), load)
      return { pts, width: 0.5 + load * 0.9, opacity: 0.12 + load * 0.3, color }
    })
  }, [edges, positions])

  return (
    <>
      {wires.map(({ pts, width, opacity, color }, i) => (
        <Line key={i} points={pts} color={color} lineWidth={width} transparent opacity={opacity} />
      ))}
    </>
  )
}

// ── Particle flow ────────────────────────────────────────────────────────────────

export interface FlowPulse { subject: string; size: number }

interface Particle {
  a: THREE.Vector3
  mid: THREE.Vector3
  b: THREE.Vector3
  t: number
  speed: number
  color: THREE.Color
  size: number
  subject: string
}

const MAX_PARTICLES = 140
const MAX_LABELS = 8         // one tag per DISTINCT subject (deduped) — plenty

// Dot rendering: each message is a small crisp dot with a tight fading tail —
// discrete data points gliding along the routes, not a spray of glow.
const TRAIL = 3                            // head + 2 ghosts per particle
const MAX_POINTS = MAX_PARTICLES * TRAIL
const TRAIL_ALPHA = [1, 0.35, 0.12]        // opacity per trail sample
const TRAIL_GAP = 0.03                     // t-space spacing between samples

function anchor(p: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(p.x, NODE_Y, p.z)
}

function Packets({
  nodes, routes, positions, pulseQueue,
}: {
  nodes: NodeInfo[]
  routes: RouteInfo[]
  positions: THREE.Vector3[]
  pulseQueue: MutableRefObject<FlowPulse[]>
}) {
  const nodesRef = useRef(nodes);                 nodesRef.current = nodes
  const routesRef = useRef(routes);               routesRef.current = routes
  const posRef = useRef(positions);               posRef.current = positions

  const bbRefs  = useRef<(THREE.Object3D | null)[]>([])  // subject-tag billboards
  const txtRefs = useRef<any[]>([])                       // troika Text instances
  const shown   = useRef<string[]>(new Array(MAX_LABELS).fill(''))

  const store = useRef({
    parts: [] as Particle[],
    pos:   new Float32Array(MAX_POINTS * 3),
    col:   new Float32Array(MAX_POINTS * 3),
    size:  new Float32Array(MAX_POINTS),
    alpha: new Float32Array(MAX_POINTS),
    scratch: new THREE.Vector3(),
    bestLabels: new Map<string, Particle>(),   // reused each frame (subject → packet)
  })

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(store.current.pos, 3))
    g.setAttribute('aColor',   new THREE.BufferAttribute(store.current.col, 3))
    g.setAttribute('size',     new THREE.BufferAttribute(store.current.size, 1))
    g.setAttribute('aAlpha',   new THREE.BufferAttribute(store.current.alpha, 1))
    g.setDrawRange(0, 0)
    return g
  }, [])

  // Small crisp dots — anti-aliased solid discs, NORMAL blending so stacked
  // messages never bloom into a glare. Quiet, discrete, readable: each dot is
  // one message, full stop. Trail ghosts reuse the shader at lower alpha.
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uPix: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float size;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float uPix;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPix * (42.0 / max(-mv.z, 0.001));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;   // 0 center .. 1 rim
        float a = (1.0 - smoothstep(0.7, 1.0, d)) * vAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
  }), [])

  useEffect(() => () => { geom.dispose(); mat.dispose() }, [geom, mat])

  // ── Particle factories ───────────────────────────────────────────────────
  const edgeParticle = (e: Edge, color: THREE.Color, size: number, speed: number, subject: string): Particle => {
    const ns = nodesRef.current, ps = posRef.current
    const oa = (ns[e.ai]?.outMsgs ?? 0) + 1
    const ob = (ns[e.bi]?.outMsgs ?? 0) + 1
    const forward = Math.random() < oa / (oa + ob)
    const fromI = forward ? e.ai : e.bi
    const toI   = forward ? e.bi : e.ai
    const a = anchor(ps[fromI]); const b = anchor(ps[toI])
    return { a, mid: arcMid(a, b), b, t: 0, speed, color, size, subject }
  }

  const radialParticle = (center: THREE.Vector3, color: THREE.Color, size: number, speed: number, outward: boolean, subject: string): Particle => {
    const ang = Math.random() * Math.PI * 2
    const R = 4.6
    const rim = new THREE.Vector3(center.x + Math.cos(ang) * R, NODE_Y, center.z + Math.sin(ang) * R)
    const a = outward ? center.clone() : rim
    const b = outward ? rim : center.clone()
    const mid = a.clone().lerp(b, 0.5); mid.y += 1.1
    return { a, mid, b, t: 0, speed, color, size, subject }
  }

  const hideAllLabels = () => {
    for (let i = 0; i < MAX_LABELS; i++) { const bb = bbRefs.current[i]; if (bb) bb.visible = false }
  }

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const st = store.current
    const ns = nodesRef.current
    const ps = posRef.current
    if (ps.length === 0) { geom.setDrawRange(0, 0); hideAllLabels(); return }

    const edges = buildEdges(ns, routesRef.current)
    const single = ps.length === 1
    const center = single ? anchor(ps[0]) : null

    // advance + cull
    const alive: Particle[] = []
    for (const p of st.parts) { p.t += p.speed * dt; if (p.t < 1) alive.push(p) }
    st.parts = alive

    // Every packet is a REAL message sampled from the (filtered) ">" feed — one
    // comet pulse per message. App subjects = cyan; internal ($…,_…) = amber
    // (only present when the "All traffic" toggle is on), so they're distinct.
    const q = pulseQueue.current
    while (q.length && st.parts.length < MAX_PARTICLES) {
      const ev = q.shift()!
      const size = 1.8 + Math.min(1.0, Math.log10(1 + ev.size) * 0.45)
      const isInt = /^[$_]/.test(ev.subject)
      // App traffic = soft theme violet (--accent-primary); internal = amber.
      const color = new THREE.Color(isInt ? AMBER_HEX : VIOLET_HEX).lerp(new THREE.Color('#ffffff'), 0.3)
      if (single && center) {
        st.parts.push(radialParticle(center, color, size, 0.7, true, ev.subject))
      } else if (edges.length) {
        // stable subject→edge mapping so a subject always travels the same lane
        let h = 0
        for (let i = 0; i < ev.subject.length; i++) h = (h * 31 + ev.subject.charCodeAt(i)) | 0
        const e = edges[Math.abs(h) % edges.length]
        st.parts.push(edgeParticle(e, color, size, 0.62, ev.subject))
      }
    }

    // write each packet as a comet: glowing head + fading trail ghosts behind
    // it along the same arc (older samples are smaller and dimmer)
    let w = 0
    const sc = st.scratch
    for (const p of st.parts) {
      for (let k = 0; k < TRAIL; k++) {
        const tk = p.t - k * TRAIL_GAP
        if (tk < 0) break
        const u = 1 - tk
        sc.set(
          u * u * p.a.x + 2 * u * tk * p.mid.x + tk * tk * p.b.x,
          u * u * p.a.y + 2 * u * tk * p.mid.y + tk * tk * p.b.y,
          u * u * p.a.z + 2 * u * tk * p.mid.z + tk * tk * p.b.z,
        )
        const i3 = w * 3
        st.pos[i3] = sc.x; st.pos[i3 + 1] = sc.y; st.pos[i3 + 2] = sc.z
        st.col[i3] = p.color.r; st.col[i3 + 1] = p.color.g; st.col[i3 + 2] = p.color.b
        st.size[w]  = p.size * (1 - k * 0.16)
        st.alpha[w] = TRAIL_ALPHA[k]
        w++
      }
    }
    geom.setDrawRange(0, w)
    ;(geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(geom.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
    ;(geom.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true
    ;(geom.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true

    // Subject tags — at most ONE tag per DISTINCT subject, riding that subject's
    // most-visible mid-flight packet. This kills the pile-up of overlapping
    // labels at node centers when many same-subject packets spawn together:
    // 3 app subjects → 3 clean tags, not 16 stacked ones.
    const best = st.bestLabels
    best.clear()
    for (const p of st.parts) {
      if (p.t < 0.2 || p.t > 0.88) continue                 // skip spawn/arrival clumps
      const cur = best.get(p.subject)                        // prefer t closest to mid-arc
      if (!cur || Math.abs(p.t - 0.5) < Math.abs(cur.t - 0.5)) best.set(p.subject, p)
    }
    let li = 0
    for (const p of best.values()) {
      if (li >= MAX_LABELS) break
      const bb = bbRefs.current[li]
      if (!bb) { li++; continue }
      const tt = p.t, u = 1 - tt
      bb.position.set(
        u * u * p.a.x + 2 * u * tt * p.mid.x + tt * tt * p.b.x,
        (u * u * p.a.y + 2 * u * tt * p.mid.y + tt * tt * p.b.y) + 0.55,
        u * u * p.a.z + 2 * u * tt * p.mid.z + tt * tt * p.b.z,
      )
      bb.visible = true
      if (shown.current[li] !== p.subject) {       // only re-sync SDF text on change
        const t = txtRefs.current[li]
        if (t) { t.text = p.subject; t.sync?.() }
        shown.current[li] = p.subject
      }
      li++
    }
    for (; li < MAX_LABELS; li++) { const bb = bbRefs.current[li]; if (bb) bb.visible = false }
  })

  return (
    <>
      <points geometry={geom} material={mat} frustumCulled={false} />
      {Array.from({ length: MAX_LABELS }).map((_, i) => (
        <Billboard key={i} ref={(el) => { bbRefs.current[i] = el }} visible={false}>
          <Text
            ref={(el) => { txtRefs.current[i] = el }}
            fontSize={0.26}
            color="#dff6ff"
            anchorX="center"
            anchorY="bottom"
            outlineWidth={0.018}
            outlineColor="#03050b"
            maxWidth={12}
          >
            {''}
          </Text>
        </Billboard>
      ))}
    </>
  )
}

// ── Scene ────────────────────────────────────────────────────────────────────────

function SceneContent({ nodes, routes, heat, pulseQueue }: {
  nodes: NodeInfo[]
  routes: RouteInfo[]
  /** Per-node relative load 0..1 (same order as `nodes`) — see useNodeHeat. */
  heat: number[]
  pulseQueue: MutableRefObject<FlowPulse[]>
}) {
  // Base layout (auto) + optional per-node drag overrides. `positions` falls back
  // to the layout whenever the node count changes, so consumers never see a
  // length mismatch and dragging resets cleanly on topology changes.
  const basePositions = useMemo(() => layout(nodes.length), [nodes.length])
  const [dragPositions, setDragPositions] = useState<THREE.Vector3[] | null>(null)
  const positions = dragPositions && dragPositions.length === nodes.length ? dragPositions : basePositions

  const [hovered, setHovered] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const controlsRef = useRef<any>(null)

  useEffect(() => { if (hovered !== null && hovered >= nodes.length) setHovered(null) }, [nodes.length, hovered])

  // End a drag on any global pointer-up (covers releasing off the drag plane).
  useEffect(() => {
    if (dragIndex === null) return
    const end = () => {
      setDragIndex(null)
      if (controlsRef.current) controlsRef.current.enabled = true
      document.body.style.cursor = 'auto'
    }
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [dragIndex])

  const startDrag = (i: number) => {
    setDragIndex(i)
    if (controlsRef.current) controlsRef.current.enabled = false   // freeze camera while dragging a node
  }
  const onDragMove = (e: any) => {
    if (dragIndex === null) return
    e.stopPropagation()
    const p = e.point as THREE.Vector3
    setDragPositions(positions.map((q, idx) => idx === dragIndex ? new THREE.Vector3(p.x, 0, p.z) : q))
  }

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 34, 140]} />

      <ambientLight intensity={0.45} />
      <pointLight position={[0, 16, 8]}    intensity={0.6} color="#8b5cf6"    distance={80} />
      <pointLight position={[-14, 10, -12]} intensity={0.35} color={VIOLET_HEX} distance={80} />

      {/* In-scene image-based lighting (no network fetch) — soft violet sheen
          so the matte pucks read as material, not flat shapes. Kept dim: the
          obsidian look is 90% darkness, 10% precise light. */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect"   intensity={1.3} color="#8b5cf6" position={[7, 6, 7]}   scale={[9, 9, 1]} />
        <Lightformer form="rect"   intensity={0.9} color="#a78bfa" position={[-9, 5, -7]}  scale={[9, 9, 1]} />
        <Lightformer form="circle" intensity={1.1} color="#ffffff" position={[0, 12, 0]}   scale={[7, 7, 1]} />
      </Environment>

      {/* No grid, no mirror floor — pure ink void. The Vignette below supplies
          the only framing; depth comes from fog + the load rings. */}

      <EdgeWires nodes={nodes} routes={routes} positions={positions} />
      <Packets nodes={nodes} routes={routes} positions={positions} pulseQueue={pulseQueue} />

      {nodes.map((n, i) => positions[i] && (
        <HexNode
          key={n.id}
          node={n}
          position={positions[i]}
          heat={heat[i] ?? 0}
          hovered={hovered === i}
          onOver={() => setHovered(i)}
          onOut={() => setHovered(h => (h === i ? null : h))}
          onDown={() => startDrag(i)}
        />
      ))}

      {hovered !== null && nodes[hovered] && positions[hovered] && (
        <NodeTooltip node={nodes[hovered]} position={positions[hovered]} heat={heat[hovered] ?? 0} />
      )}

      {/* Invisible drag plane — present only while dragging; converts the pointer
          to a floor (x,z) position so you can grab a node and reposition it. */}
      {dragIndex !== null && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, NODE_Y, 0]} onPointerMove={onDragMove}>
          <planeGeometry args={[800, 800]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {/* Gimbal-free trackball — tumble a full 360° around any axis. Frozen while
          dragging a node. Left-drag = tumble · scroll = zoom · right-drag = pan. */}
      <TrackballControls
        ref={controlsRef}
        makeDefault
        rotateSpeed={3.4}
        zoomSpeed={1.3}
        panSpeed={0.8}
        staticMoving={false}
        dynamicDampingFactor={0.12}
        minDistance={1.5}
        maxDistance={120}
      />

      <EffectComposer multisampling={2}>
        {/* Quiet bloom — only the load rings & leader ring (toneMapped=false)
            cross the threshold; the message dots stay crisp and un-glowed. */}
        <Bloom
          intensity={0.3}
          luminanceThreshold={0.72}
          luminanceSmoothing={0.9}
          mipmapBlur
          radius={0.55}
        />
        <Vignette eskil={false} offset={0.28} darkness={0.78} />
      </EffectComposer>
    </>
  )
}

// ── Public component ─────────────────────────────────────────────────────────────

export function TopologyScene({ clusterId, nodes, routes, externalOnly }: TopologySceneProps) {
  const pulseQueue = useRef<FlowPulse[]>([])
  const heat = useNodeHeat(nodes)

  // Start the backend ">" flow feed and collect real message pulses while open.
  // includeInternal mirrors the cluster-bar toggle (external-only by default).
  // Re-runs when the toggle flips → backend restarts the sub with the new filter.
  useEffect(() => {
    if (!clusterId) return
    ws.send('flow.start', { clusterId, includeInternal: !externalOnly })
    const off = ws.on<{ clusterId: string; subject: string; size: number; internal?: boolean }>('topology.flow', ({ data }) => {
      if (data.clusterId !== clusterId) return
      // When external-only, drop internal NATS/JetStream plumbing ($…, _…).
      if (externalOnly && (data.internal || /^[$_]/.test(data.subject))) return
      pulseQueue.current.push({ subject: data.subject, size: data.size })
      if (pulseQueue.current.length > 240) pulseQueue.current.shift()
    })
    return () => { off(); ws.send('flow.stop', { clusterId }) }
  }, [clusterId, externalOnly])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 9, 15], fov: 45 }}
        style={{ background: BG, display: 'block', width: '100%', height: '100%' }}
      >
        <SceneContent nodes={nodes} routes={routes} heat={heat} pulseQueue={pulseQueue} />
      </Canvas>

      {/* Load heatmap legend — relative coloring only makes sense with ≥2 nodes */}
      {nodes.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 12, right: 12, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 7,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 10,
          color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap',
          background: 'rgba(6,7,15,0.62)', border: '1px solid rgba(167,139,250,0.18)',
          borderRadius: 8, padding: '5px 10px', backdropFilter: 'blur(4px)',
        }}>
          <span style={{ letterSpacing: '0.06em' }}>NODE LOAD</span>
          <span>low</span>
          <div style={{
            width: 72, height: 6, borderRadius: 3,
            background: 'linear-gradient(90deg, #22d3ee, #818cf8, #c084fc, #fb7185)',
          }} />
          <span>high</span>
        </div>
      )}

      {nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 12, color: 'rgba(167,139,250,0.45)',
        }}>
          No nodes connected
        </div>
      )}
    </div>
  )
}
