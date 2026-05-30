/**
 * TopologyScene — 3D extruded hex grid, real message particles, interactive hover.
 *
 * Nodes are isometric-style extruded hexagonal platforms.
 * Particles are spawned proportional to actual node outMsgs/inMsgs rates —
 * if a node is idle, no particles flow from it. Direction follows the route.
 * Hover a node to see a detailed stat card.
 *
 * Pure Canvas 2D + React overlay for tooltip.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { NodeInfo, RouteInfo } from '@/types'

export interface TopologySceneProps {
  nodes:           NodeInfo[]
  routes:          RouteInfo[]
  totalThroughput: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BG      = '#04090f'
const HEX_R   = 48      // radius center → vertex
const DEPTH   = 13      // 3D extrusion depth (px)
const DASH_V  = 48      // dash animation speed (px/s)

type RGB = readonly [number, number, number]
const CYAN  : RGB = [6,   182, 212]
const AMBER : RGB = [245, 158,  11]
const RED   : RGB = [239,  68,  68]
const WHITE : RGB = [255, 255, 255]
const DARK  : RGB = [4,    9,  15]

// ── Helpers ───────────────────────────────────────────────────────────────────

const c = ([r,g,b]: RGB, a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`

function healthRGB(h: string): RGB {
  if (h === 'critical') return RED
  if (h === 'degraded') return AMBER
  return CYAN
}

/** Flat-top hex vertices around (cx, cy). */
function hexVerts(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6   // flat-top: 30°, 90°, …
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]
  })
}

/** Trace a closed hex path onto ctx. */
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const v = hexVerts(cx, cy, r)
  ctx.beginPath()
  ctx.moveTo(v[0][0], v[0][1])
  for (let i = 1; i < 6; i++) ctx.lineTo(v[i][0], v[i][1])
  ctx.closePath()
}

/** Draw extruded 3D hex platform (top face + 3 visible walls). */
function draw3DHex(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  r: number,
  col: RGB,
  glowAlpha: number,   // 0-1 — boosted on hover
) {
  const v  = hexVerts(cx, cy, r)
  const d  = DEPTH

  // ── Walls — only the 3 bottom-facing edges are visible ──────────────────
  // flat-top vertex layout: 0=right-bottom, 1=bottom, 2=left-bottom,
  //                         3=left-top, 4=top, 5=right-top
  // Visible faces looking from slightly above: edges 5→0, 0→1, 1→2
  const wallEdges: [number, number][] = [[5, 0], [0, 1], [1, 2]]

  for (const [a, b] of wallEdges) {
    const [x1, y1] = v[a]
    const [x2, y2] = v[b]
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x2, y2 + d)
    ctx.lineTo(x1, y1 + d)
    ctx.closePath()
    const wg = ctx.createLinearGradient(cx, cy, cx, cy + d + 10)
    wg.addColorStop(0, c(col, 0.22 * glowAlpha))
    wg.addColorStop(1, c(DARK, 0.85))
    ctx.fillStyle = wg
    ctx.fill()
    ctx.strokeStyle = c(col, 0.18 * glowAlpha)
    ctx.lineWidth = 0.6
    ctx.stroke()
  }

  // ── Bottom face shadow ───────────────────────────────────────────────────
  hexPath(ctx, cx, cy + d, r - 2)
  ctx.fillStyle = c(DARK, 0.6)
  ctx.fill()

  // ── Top face fill ────────────────────────────────────────────────────────
  hexPath(ctx, cx, cy, r)
  const fg = ctx.createRadialGradient(cx, cy - r * 0.2, 0, cx, cy, r)
  fg.addColorStop(0,   c(col, 0.20 * glowAlpha))
  fg.addColorStop(0.5, c(col, 0.10 * glowAlpha))
  fg.addColorStop(1,   c(DARK, 0.9))
  ctx.fillStyle = fg
  ctx.fill()

  // ── Top face border (glowing) ────────────────────────────────────────────
  ctx.save()
  ctx.shadowColor = c(col, 0.7 * glowAlpha)
  ctx.shadowBlur  = 12 * glowAlpha
  hexPath(ctx, cx, cy, r)
  ctx.strokeStyle = c(col, (0.55 + 0.3 * Math.sin(Date.now() * 0.002)) * glowAlpha)
  ctx.lineWidth   = 1.5
  ctx.stroke()
  ctx.restore()

  // ── Vertex accent dots ───────────────────────────────────────────────────
  for (const [vx, vy] of v) {
    ctx.fillStyle = c(col, 0.8 * glowAlpha)
    ctx.beginPath()
    ctx.arc(vx, vy, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Inner bevel highlight (top edge glow) ────────────────────────────────
  hexPath(ctx, cx, cy, r - 3)
  ctx.strokeStyle = c(WHITE, 0.04 * glowAlpha)
  ctx.lineWidth = 1
  ctx.stroke()
}

/** Arrange nodes evenly in a circle. Single node is centered. */
function layoutNodes(n: number, W: number, H: number): [number, number][] {
  if (n === 0) return []
  if (n === 1) return [[W / 2, H / 2]]
  const r = Math.min(W, H) * 0.30
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return [W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r]
  })
}

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K'
  return String(n)
}

// ── Particle type ─────────────────────────────────────────────────────────────

interface MsgParticle {
  fromIdx: number
  toIdx:   number
  t:       number             // 0 → 1 along the edge
  speed:   number             // fraction / second
  trail:   [number, number][]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TopologyScene({ nodes, routes, totalThroughput }: TopologySceneProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const nodesRef     = useRef(nodes)
  const routesRef    = useRef(routes)
  const tpRef        = useRef(totalThroughput)
  const particles    = useRef<MsgParticle[]>([])
  const dashOff      = useRef(0)
  const pulsePhase   = useRef<number[]>([])
  const lastTs       = useRef(0)
  const posRef       = useRef<[number, number][]>([])

  nodesRef.current  = nodes
  routesRef.current = routes
  tpRef.current     = totalThroughput

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tipPos,     setTipPos]     = useState({ x: 0, y: 0 })

  // Re-seed pulse phases when node count changes
  useEffect(() => {
    pulsePhase.current = nodes.map(() => Math.random() * Math.PI * 2)
    particles.current  = []
  }, [nodes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse interaction
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx   = (e.clientX - rect.left) / rect.width  * canvas.offsetWidth
    const my   = (e.clientY - rect.top)  / rect.height * canvas.offsetHeight
    let found  = -1
    for (let i = 0; i < posRef.current.length; i++) {
      const [nx, ny] = posRef.current[i]
      if (Math.sqrt((mx - nx) ** 2 + (my - ny) ** 2) < HEX_R) { found = i; break }
    }
    setHoveredIdx(found === -1 ? null : found)
    setTipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  const handleMouseLeave = useCallback(() => setHoveredIdx(null), [])

  // Canvas setup + animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    canvas.addEventListener('mousemove',  handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    const observer = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
    })
    observer.observe(canvas)
    canvas.width  = canvas.offsetWidth  * devicePixelRatio
    canvas.height = canvas.offsetHeight * devicePixelRatio

    let raf: number

    const tick = (ts: number) => {
      const dt = Math.min((ts - (lastTs.current || ts)) / 1000, 0.05)
      lastTs.current = ts

      const W   = canvas.offsetWidth
      const H   = canvas.offsetHeight
      const dpr = devicePixelRatio
      const ns  = nodesRef.current
      const rs  = routesRef.current

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      const positions = layoutNodes(ns.length, W, H)
      posRef.current  = positions
      dashOff.current -= dt * DASH_V

      // ── Hex tile background ─────────────────────────────────────────────
      const bSize = 18
      const bCol  = bSize * Math.sqrt(3)
      const bRow  = bSize * 1.5
      ctx.strokeStyle = c(CYAN, 0.035)
      ctx.lineWidth   = 0.4
      for (let row = -1; row * bRow < H + bSize * 2; row++) {
        for (let col = -1; col * bCol + (row % 2 ? bCol / 2 : 0) < W + bSize * 2; col++) {
          const bx = col * bCol + (row % 2 ? bCol / 2 : 0)
          const by = row * bRow
          hexPath(ctx, bx, by, bSize - 1)
          ctx.stroke()
        }
      }

      // ── Build / refresh particles based on REAL message rates ───────────
      // Map node ID → index
      const idToIdx = new Map(ns.map((n, i) => [n.id, i]))

      // For each route, compute desired particle count per direction
      type RouteSlot = { fi: number; ti: number; rate: number }
      const slots: RouteSlot[] = []

      for (const rt of rs) {
        const fi = idToIdx.get(rt.from) ?? -1
        const ti = idToIdx.get(rt.to)   ?? -1
        if (fi === -1 || ti === -1) continue
        const numRoutes = Math.max(rs.length, 1)

        // Forward: node[fi] output distributed across its routes
        const fwdRate = (ns[fi].outMsgs ?? 0) / numRoutes
        // Backward: node[ti] output distributed across its routes
        const bwdRate = (ns[ti].outMsgs ?? 0) / numRoutes

        if (fwdRate > 0) slots.push({ fi, ti, rate: fwdRate })
        if (bwdRate > 0) slots.push({ fi: ti, ti: fi, rate: bwdRate })
      }

      // For clusters with no routes yet but active nodes, use totals
      if (slots.length === 0 && ns.length >= 2 && tpRef.current > 0) {
        for (let i = 0; i < ns.length; i++) {
          const j = (i + 1) % ns.length
          slots.push({ fi: i, ti: j, rate: ns[i].outMsgs ?? 0 })
        }
      }

      // Each slot gets up to 6 particles (1 per 15 msgs/s)
      const desired: MsgParticle[] = []
      for (const { fi, ti, rate } of slots) {
        const count = Math.min(Math.round(rate / 15), 6)
        for (let k = 0; k < count; k++) {
          desired.push({
            fromIdx: fi,
            toIdx:   ti,
            t:       k / count,
            speed:   0.30 + Math.random() * 0.25,
            trail:   [],
          })
        }
      }

      // Smoothly converge particle list toward desired (add/remove gradually)
      if (desired.length > particles.current.length) {
        particles.current.push(
          ...desired.slice(particles.current.length).map(p => ({ ...p, t: Math.random(), trail: [] }))
        )
      } else if (desired.length < particles.current.length) {
        particles.current.length = desired.length
      }

      // ── Connection lines ─────────────────────────────────────────────────
      for (const rt of rs) {
        const fi = idToIdx.get(rt.from) ?? -1
        const ti = idToIdx.get(rt.to)   ?? -1
        if (fi === -1 || ti === -1) continue
        const [x1, y1] = positions[fi]
        const [x2, y2] = positions[ti]
        const cA = healthRGB(ns[fi].health)
        const cB = healthRGB(ns[ti].health)

        // Glow
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
        ctx.strokeStyle = c(cA, 0.07); ctx.lineWidth = 8
        ctx.setLineDash([]); ctx.stroke()

        // Inner glow
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
        ctx.strokeStyle = c(cA, 0.14); ctx.lineWidth = 2; ctx.stroke()

        // Animated dashes
        const grad = ctx.createLinearGradient(x1, y1, x2, y2)
        grad.addColorStop(0, c(cA, 0.55))
        grad.addColorStop(1, c(cB, 0.55))
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
        ctx.strokeStyle = grad; ctx.lineWidth = 1
        ctx.setLineDash([5, 11]); ctx.lineDashOffset = dashOff.current
        ctx.stroke(); ctx.setLineDash([])
      }

      // ── Fallback connections (when no routes) ─────────────────────────────
      if (rs.length === 0) {
        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            const [x1, y1] = positions[i]; const [x2, y2] = positions[j]
            const col = healthRGB(ns[i].health)
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
            ctx.strokeStyle = c(col, 0.12); ctx.lineWidth = 1
            ctx.setLineDash([5, 11]); ctx.lineDashOffset = dashOff.current
            ctx.stroke(); ctx.setLineDash([])
          }
        }
      }

      // ── Message particles ────────────────────────────────────────────────
      for (const p of particles.current) {
        p.t += p.speed * dt
        if (p.t >= 1) {
          p.t = 0; p.trail = []
        }
        const p0 = positions[p.fromIdx]; const p1 = positions[p.toIdx]
        if (!p0 || !p1) continue

        const px = p0[0] + (p1[0] - p0[0]) * p.t
        const py = p0[1] + (p1[1] - p0[1]) * p.t

        p.trail.push([px, py])
        if (p.trail.length > 16) p.trail.shift()

        const col = healthRGB(ns[p.fromIdx]?.health ?? 'ok')

        // Trail
        for (let k = 0; k < p.trail.length - 1; k++) {
          const alpha = (k / p.trail.length) * 0.7
          ctx.beginPath()
          ctx.moveTo(p.trail[k][0], p.trail[k][1])
          ctx.lineTo(p.trail[k+1][0], p.trail[k+1][1])
          ctx.strokeStyle = c(col, alpha)
          ctx.lineWidth   = 2.5 * (k / p.trail.length)
          ctx.stroke()
        }

        // Glow head
        const g = ctx.createRadialGradient(px, py, 0, px, py, 8)
        g.addColorStop(0, c(col, 0.9)); g.addColorStop(1, c(col, 0))
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = c(WHITE, 0.95); ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill()
      }

      // ── Node hexagons ────────────────────────────────────────────────────
      for (let i = 0; i < ns.length; i++) {
        const node    = ns[i]
        const pos     = positions[i]
        if (!pos) continue
        const [x, y]  = pos
        const col     = healthRGB(node.health)
        const isHover = hoveredIdx === i
        pulsePhase.current[i] = (pulsePhase.current[i] ?? 0) + dt * 1.6
        const glow    = isHover ? 1.5 : 0.85 + Math.sin(pulsePhase.current[i]) * 0.15

        draw3DHex(ctx, x, y, HEX_R, col, glow)

        // ── Text inside hex ───────────────────────────────────────────────
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'

        // Node name
        ctx.fillStyle = c(WHITE, 0.92)
        ctx.font      = '600 11px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(node.name, x, y - 16)

        // Divider
        ctx.beginPath(); ctx.moveTo(x - 28, y - 5); ctx.lineTo(x + 28, y - 5)
        ctx.strokeStyle = c(col, 0.2); ctx.lineWidth = 0.7; ctx.stroke()

        // Msgs/s (the KEY real-time number)
        ctx.fillStyle = c(col, isHover ? 1.0 : 0.85)
        ctx.font      = '700 12px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(`${fmt(node.inMsgs)}/s`, x, y + 6)

        // Clients
        ctx.fillStyle = c(WHITE, 0.45)
        ctx.font      = '9px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(`${fmt(node.clients)} cli`, x, y + 20)

        // Role dot
        if (node.role === 'leader') {
          ctx.fillStyle = c(col, 0.9)
          ctx.font      = '8px "JetBrains Mono", ui-monospace, monospace'
          ctx.fillText('◆ LEADER', x, y - 28)
        }

        ctx.textBaseline = 'alphabetic'
      }

      // Empty state
      if (ns.length === 0) {
        ctx.textAlign = 'center'
        ctx.fillStyle = c(CYAN, 0.25)
        ctx.font      = '12px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText('No nodes connected', W / 2, H / 2)
      }

      ctx.restore()
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener('mousemove',  handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [handleMouseMove, handleMouseLeave])

  const hoveredNode = hoveredIdx !== null ? nodes[hoveredIdx] : null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', background: BG, cursor: hoveredIdx !== null ? 'crosshair' : 'default' }}
      />

      {/* ── Hover tooltip ─────────────────────────────────────────────────── */}
      {hoveredNode && (
        <div
          style={{
            position:    'absolute',
            left:        tipPos.x + 18,
            top:         tipPos.y - 10,
            pointerEvents: 'none',
            zIndex:      10,
            background:  'rgba(4,9,15,0.95)',
            border:      `1px solid rgba(6,182,212,0.35)`,
            borderRadius: 6,
            padding:     '10px 14px',
            minWidth:    160,
            boxShadow:   '0 0 20px rgba(6,182,212,0.15)',
            fontFamily:  '"JetBrains Mono", ui-monospace, monospace',
            fontSize:    10,
            lineHeight:  '1.9',
            color:       'rgba(255,255,255,0.85)',
          }}
        >
          <div style={{ color: '#22d3ee', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
            {hoveredNode.name}
            {hoveredNode.role === 'leader' && (
              <span style={{ marginLeft: 6, fontSize: 9, color: 'rgba(6,182,212,0.7)' }}>◆ LEADER</span>
            )}
          </div>
          <Row label="HOST"    value={`${hoveredNode.host}:${hoveredNode.port}`} />
          <Row label="VERSION" value={hoveredNode.version || '—'} />
          <Row label="CLIENTS" value={fmt(hoveredNode.clients)} />
          <Row label="SUBS"    value={fmt(hoveredNode.subscriptions)} />
          <div style={{ borderTop: '1px solid rgba(6,182,212,0.15)', margin: '6px 0' }} />
          <Row label="↑ IN"   value={`${fmt(hoveredNode.inMsgs)}/s`}   color="#22d3ee" />
          <Row label="↓ OUT"  value={`${fmt(hoveredNode.outMsgs)}/s`}  color="#67e8f9" />
          <Row label="↑ BYTES" value={`${fmt(hoveredNode.inBytes)}/s`} color="rgba(255,255,255,0.5)" />
          <Row label="↓ BYTES" value={`${fmt(hoveredNode.outBytes)}/s`} color="rgba(255,255,255,0.5)" />
          <div style={{ borderTop: '1px solid rgba(6,182,212,0.15)', margin: '6px 0' }} />
          <Row label="UPTIME"  value={hoveredNode.uptime || '—'} />
          <Row
            label="HEALTH"
            value={hoveredNode.health.toUpperCase()}
            color={hoveredNode.health === 'ok' ? '#22d3ee' : hoveredNode.health === 'degraded' ? '#f59e0b' : '#ef4444'}
          />
          {hoveredNode.jetstream && (
            <div style={{ marginTop: 6, color: '#a78bfa', fontSize: 9 }}>◈ JETSTREAM ENABLED</div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color = 'rgba(255,255,255,0.7)' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  )
}
