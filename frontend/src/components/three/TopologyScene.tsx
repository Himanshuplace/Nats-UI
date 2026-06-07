/**
 * TopologyScene — real WebGL 3D NATS cluster topology (data-first).
 *
 * Each NATS server is a glassy hexagonal prism on a holographic grid. Nodes
 * show live health + in/out counts; connection wires thicken & brighten with
 * REAL relative route load. Every travelling square is ONE real message sampled
 * from a filtered ">" feed (app subjects = cyan, internal $…/_… = amber), with
 * the newest packets carrying their subject as a tag. Nothing is synthetic.
 *
 * Rendered with @react-three/fiber + drei (lazy-loaded by ClusterTopology so
 * Three.js never touches the initial bundle).
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { TrackballControls, Grid, Edges, Html, Line, Text, Billboard, Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei'
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

// ── Palette (holographic datacenter) ───────────────────────────────────────────
const BG          = '#06070f'
const CYAN_HEX    = '#22d3ee'
const AMBER_HEX   = '#f59e0b'
const RED_HEX     = '#ef4444'
const VIOLET_HEX  = '#a78bfa'

const NODE_Y = 0.5   // vertical center of a node (particles travel through here)
const HEX_H  = 0.7   // prism height
const HEX_R  = 1.15  // prism radius
const SCRATCH_SCALE = new THREE.Vector3()  // reused each frame (avoids per-frame alloc)

function healthHex(h: string): string {
  if (h === 'critical') return RED_HEX
  if (h === 'degraded') return AMBER_HEX
  return CYAN_HEX
}

/** 0..1 relative busyness from cumulative counters (drives glow brightness). */
function activity(n: NodeInfo): number {
  const total = (n.inMsgs ?? 0) + (n.outMsgs ?? 0)
  return Math.min(1, Math.log10(1 + total) / 7)
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

// ── Glow sprite texture (shared) ────────────────────────────────────────────────
let _glowTex: THREE.Texture | null = null
function glowTexture(): THREE.Texture {
  if (_glowTex) return _glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0,    'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)')
  grd.addColorStop(0.5,  'rgba(255,255,255,0.3)')
  grd.addColorStop(1,    'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  _glowTex = t
  return t
}

// ── Node ────────────────────────────────────────────────────────────────────────

interface HexNodeProps {
  node:     NodeInfo
  position: THREE.Vector3
  hovered:  boolean
  onOver:   () => void
  onOut:    () => void
  onDown:   () => void
}

function HexNode({ node, position, hovered, onOver, onOut, onDown }: HexNodeProps) {
  const matRef  = useRef<THREE.MeshStandardMaterial>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const col = useMemo(() => new THREE.Color(healthHex(node.health)), [node.health])
  const act = activity(node)
  const hpx = healthHex(node.health)

  // Steady, readable nodes — emissive eases toward a target set by real activity
  // & hover (no sinusoidal "breathing"), and the prism grows slightly on hover.
  useFrame(() => {
    if (matRef.current) {
      const target = (hovered ? 1.7 : 1) * (0.5 + act * 1.15)
      matRef.current.emissiveIntensity += (target - matRef.current.emissiveIntensity) * 0.12
    }
    if (meshRef.current) {
      const s = hovered ? 1.12 : 1
      meshRef.current.scale.lerp(SCRATCH_SCALE.set(s, s, s), 0.16)
    }
  })

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Static, subtle ground halo — depth without the glowy pulse */}
      <sprite position={[0, NODE_Y, 0]} scale={[4.2, 4.2, 4.2]}>
        <spriteMaterial
          map={glowTexture()} color={col} transparent depthWrite={false}
          blending={THREE.AdditiveBlending} opacity={0.16 + act * 0.22}
        />
      </sprite>

      {/* Glass hexagonal prism */}
      <mesh
        ref={meshRef}
        position={[0, NODE_Y, 0]}
        rotation={[0, Math.PI / 6, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onOver(); document.body.style.cursor = 'grab' }}
        onPointerOut={(e) => { e.stopPropagation(); onOut(); document.body.style.cursor = 'auto' }}
        onPointerDown={(e) => { e.stopPropagation(); document.body.style.cursor = 'grabbing'; onDown() }}
      >
        <cylinderGeometry args={[HEX_R, HEX_R, HEX_H, 6]} />
        <meshStandardMaterial
          ref={matRef}
          color="#0a1322" emissive={col} emissiveIntensity={1}
          metalness={0.9} roughness={0.16} envMapIntensity={1.35}
          transparent opacity={0.9}
        />
        <Edges threshold={15} color={hpx} lineWidth={1.8} transparent opacity={0.95} />
      </mesh>

      {/* Leader crown */}
      {node.role === 'leader' && (
        <mesh position={[0, HEX_H + 0.14, 0]} rotation={[0, Math.PI / 6, 0]}>
          <cylinderGeometry args={[HEX_R * 0.45, HEX_R * 0.45, 0.05, 6]} />
          <meshStandardMaterial color={VIOLET_HEX} emissive={VIOLET_HEX} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      )}

      {/* Always-on data card: name · health · live in/out (data-first) */}
      <Html position={[0, HEX_H + 1.0, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[15, 0]}>
        <div style={{
          pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'center',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace', transform: 'translateY(-4px)',
          display: 'inline-block', padding: '3px 9px', borderRadius: 9,
          background: 'rgba(6,7,15,0.62)', border: `1px solid ${hpx}38`, backdropFilter: 'blur(4px)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#eaf7ff' }}>
            {node.name}
            {node.role === 'leader' && <span style={{ color: VIOLET_HEX, marginLeft: 5 }}>◆</span>}
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: hpx, letterSpacing: '0.06em', marginTop: 1 }}>
            {node.health.toUpperCase()}
          </div>
          <div style={{ fontSize: 10, marginTop: 2, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: '#22d3ee' }}>↓</span>{full(node.inMsgs)}
            <span style={{ opacity: 0.4, margin: '0 5px' }}>·</span>
            <span style={{ color: '#67e8f9' }}>↑</span>{full(node.outMsgs)}
          </div>
        </div>
      </Html>
    </group>
  )
}

// ── Hover tooltip ────────────────────────────────────────────────────────────────

function NodeTooltip({ node, position }: { node: NodeInfo; position: THREE.Vector3 }) {
  return (
    <Html position={[position.x, NODE_Y + HEX_H + 0.2, position.z]} style={{ pointerEvents: 'none' }} zIndexRange={[30, 20]}>
      <div style={{
        pointerEvents: 'none', transform: 'translate(16px, -50%)', minWidth: 212,
        background: 'rgba(6,7,15,0.94)', border: `1px solid ${healthHex(node.health)}55`,
        borderRadius: 8, padding: '10px 13px', boxShadow: `0 0 24px ${healthHex(node.health)}22`,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 10, lineHeight: '1.85',
        color: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)',
      }}>
        <div style={{ color: '#67e8f9', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
          {node.name}
          {node.role === 'leader' && <span style={{ marginLeft: 6, fontSize: 9, color: VIOLET_HEX }}>◆ LEADER</span>}
        </div>
        <TipRow label="HOST"    value={`${node.host}:${node.port}`} />
        <TipRow label="VERSION" value={node.version || '—'} />
        <TipRow label="JETSTREAM" value={node.jetstream ? 'ENABLED' : 'OFF'}
          color={node.jetstream ? VIOLET_HEX : undefined} />
        <div style={{ borderTop: '1px solid rgba(103,232,249,0.15)', margin: '6px 0' }} />
        <TipRow label="CLIENTS" value={full(node.clients)} />
        <TipRow label="SUBS"    value={full(node.subscriptions)} />
        <TipRow label="SLOW CONSUMERS" value={full(node.slowClients)}
          color={node.slowClients > 0 ? AMBER_HEX : undefined} />
        <div style={{ borderTop: '1px solid rgba(103,232,249,0.15)', margin: '6px 0' }} />
        <TipRow label="↑ MSGS IN"  value={full(node.inMsgs)}  color="#22d3ee" />
        <TipRow label="↓ MSGS OUT" value={full(node.outMsgs)} color="#67e8f9" />
        <TipRow label="↑ DATA IN"  value={bytes(node.inBytes)}  color="#22d3ee" />
        <TipRow label="↓ DATA OUT" value={bytes(node.outBytes)} color="#67e8f9" />
        <div style={{ borderTop: '1px solid rgba(103,232,249,0.15)', margin: '6px 0' }} />
        <TipRow label="UPTIME"  value={node.uptime || '—'} />
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

  // Each wire's thickness + brightness encodes its REAL relative route load
  // (log-scaled against the busiest link), so heavy routes are obvious at a glance.
  const wires = useMemo(() => {
    const maxW = edges.reduce((m, e) => Math.max(m, e.weight), 1)
    const denom = Math.log10(1 + maxW) || 1
    return edges.map(({ ai, bi, weight }) => {
      const a = new THREE.Vector3(positions[ai].x, NODE_Y, positions[ai].z)
      const b = new THREE.Vector3(positions[bi].x, NODE_Y, positions[bi].z)
      const pts = new THREE.QuadraticBezierCurve3(a, arcMid(a, b), b).getPoints(28)
      const load = Math.min(1, Math.log10(1 + weight) / denom)
      const color = new THREE.Color(CYAN_HEX).lerp(new THREE.Color('#eaffff'), load * 0.6)
      return { pts, width: 0.7 + load * 2.3, opacity: 0.12 + load * 0.42, color }
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

const MAX_PARTICLES = 220
const MAX_LABELS = 8         // one tag per DISTINCT subject (deduped) — plenty

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
    pos:  new Float32Array(MAX_PARTICLES * 3),
    col:  new Float32Array(MAX_PARTICLES * 3),
    size: new Float32Array(MAX_PARTICLES),
    scratch: new THREE.Vector3(),
    bestLabels: new Map<string, Particle>(),   // reused each frame (subject → packet)
  })

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(store.current.pos, 3))
    g.setAttribute('aColor',   new THREE.BufferAttribute(store.current.col, 3))
    g.setAttribute('size',     new THREE.BufferAttribute(store.current.size, 1))
    g.setDrawRange(0, 0)
    return g
  }, [])

  // Crisp solid SQUARE "data packets" — no additive glow. A subtle darker frame
  // gives each one a chip-like edge so they read as discrete packets, not blobs.
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uPix: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float size;
      varying vec3 vColor;
      uniform float uPix;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPix * (110.0 / max(-mv.z, 0.001));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        vec2 d = abs(gl_PointCoord - 0.5);
        float edge = max(d.x, d.y);          // 0 center .. 0.5 corner
        float frame = step(0.40, edge);      // outer chip frame
        vec3 col = mix(vColor, vColor * 0.38, frame);
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: false, depthWrite: true, depthTest: true, blending: THREE.NormalBlending,
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
    // crisp square per message. App subjects = cyan; internal ($…,_…) = amber
    // (only present when the "All traffic" toggle is on), so they're distinct.
    const q = pulseQueue.current
    while (q.length && st.parts.length < MAX_PARTICLES) {
      const ev = q.shift()!
      const size = 3.2 + Math.min(2.2, Math.log10(1 + ev.size) * 0.9)
      const isInt = /^[$_]/.test(ev.subject)
      const color = new THREE.Color(isInt ? AMBER_HEX : CYAN_HEX).lerp(new THREE.Color('#ffffff'), 0.18)
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

    // write one crisp square per packet
    let w = 0
    const sc = st.scratch
    for (const p of st.parts) {
      const tt = p.t, u = 1 - tt
      sc.set(
        u * u * p.a.x + 2 * u * tt * p.mid.x + tt * tt * p.b.x,
        u * u * p.a.y + 2 * u * tt * p.mid.y + tt * tt * p.b.y,
        u * u * p.a.z + 2 * u * tt * p.mid.z + tt * tt * p.b.z,
      )
      const i3 = w * 3
      st.pos[i3] = sc.x; st.pos[i3 + 1] = sc.y; st.pos[i3 + 2] = sc.z
      st.col[i3] = p.color.r; st.col[i3 + 1] = p.color.g; st.col[i3 + 2] = p.color.b
      st.size[w] = p.size
      w++
    }
    geom.setDrawRange(0, w)
    ;(geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(geom.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
    ;(geom.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true

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

function SceneContent({ nodes, routes, pulseQueue }: {
  nodes: NodeInfo[]
  routes: RouteInfo[]
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

      <ambientLight intensity={0.4} />
      <pointLight position={[0, 16, 8]}    intensity={0.9} color={CYAN_HEX}   distance={80} />
      <pointLight position={[-14, 10, -12]} intensity={0.5} color={VIOLET_HEX} distance={80} />

      {/* In-scene image-based lighting (no network fetch) — gives the glass/metal
          nodes real reflections so they read as premium instead of flat plastic. */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect"   intensity={2.4} color="#22d3ee" position={[7, 6, 7]}   scale={[9, 9, 1]} />
        <Lightformer form="rect"   intensity={1.5} color="#a78bfa" position={[-9, 5, -7]}  scale={[9, 9, 1]} />
        <Lightformer form="circle" intensity={1.7} color="#ffffff" position={[0, 12, 0]}   scale={[7, 7, 1]} />
      </Environment>

      {/* Reflective floor — mirrors the glowing nodes for depth + a premium finish.
          Single-sided so it culls from below (the grid stays visible underneath). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <planeGeometry args={[160, 160]} />
        <MeshReflectorMaterial
          resolution={256}
          mirror={0.5}
          mixBlur={8}
          mixStrength={1.3}
          blur={[300, 120]}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.2}
          depthScale={1.1}
          metalness={0.6}
          roughness={0.85}
          color="#04060c"
        />
      </mesh>

      <Grid
        position={[0, 0, 0]}
        args={[80, 80]}
        cellSize={1} cellThickness={0.5} cellColor="#0d343d"
        sectionSize={5} sectionThickness={1} sectionColor="#155e6b"
        fadeDistance={48} fadeStrength={1.6} infiniteGrid
        side={THREE.DoubleSide}
      />

      <EdgeWires nodes={nodes} routes={routes} positions={positions} />
      <Packets nodes={nodes} routes={routes} positions={positions} pulseQueue={pulseQueue} />

      {nodes.map((n, i) => positions[i] && (
        <HexNode
          key={n.id}
          node={n}
          position={positions[i]}
          hovered={hovered === i}
          onOver={() => setHovered(i)}
          onOut={() => setHovered(h => (h === i ? null : h))}
          onDown={() => startDrag(i)}
        />
      ))}

      {hovered !== null && nodes[hovered] && positions[hovered] && (
        <NodeTooltip node={nodes[hovered]} position={positions[hovered]} />
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
        <Bloom
          intensity={0.42}
          luminanceThreshold={0.62}
          luminanceSmoothing={0.9}
          mipmapBlur
          radius={0.6}
        />
        <Vignette eskil={false} offset={0.28} darkness={0.78} />
      </EffectComposer>
    </>
  )
}

// ── Public component ─────────────────────────────────────────────────────────────

export function TopologyScene({ clusterId, nodes, routes, externalOnly }: TopologySceneProps) {
  const pulseQueue = useRef<FlowPulse[]>([])

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
        <SceneContent nodes={nodes} routes={routes} pulseQueue={pulseQueue} />
      </Canvas>

      {nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 12, color: 'rgba(103,232,249,0.4)',
        }}>
          No nodes connected
        </div>
      )}
    </div>
  )
}
