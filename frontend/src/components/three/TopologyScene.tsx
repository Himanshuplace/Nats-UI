/**
 * TopologyScene — "Hex Grid" visualization.
 *
 * Nodes are flat-top hexagonal tiles on a tiled hex-grid background.
 * Connections are straight glowing lines with animated dash flow and
 * fast-moving message particles. Cyan / deep-blue color palette.
 *
 * Pure Canvas 2D — zero external dependencies.
 */
import { useEffect, useRef } from 'react'
import type { NodeInfo } from '@/types'

export interface TopologySceneProps {
  nodes:           NodeInfo[]
  totalThroughput: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BG         = '#04090f'
const C_CYAN     : RGB = [6,   182, 212]   // #06b6d4  healthy
const C_AMBER    : RGB = [245, 158,  11]   // #f59e0b  degraded
const C_RED      : RGB = [239,  68,  68]   // #ef4444  critical
const C_WHITE    : RGB = [255, 255, 255]
const HEX_R      = 50      // node hex radius (center → vertex)
const BG_HEX_R   = 16      // background tiling hex radius
const DASH_SPEED = 55      // px/s for flowing dashes

type RGB = readonly [number, number, number]

// ── Helpers ───────────────────────────────────────────────────────────────────

function healthColor(h: string): RGB {
  if (h === 'critical') return C_RED
  if (h === 'degraded') return C_AMBER
  return C_CYAN
}

function rgba([r, g, b]: RGB, a: number) {
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

/** Flat-top hexagon path (rotation = 0 → vertex at right, Math.PI/6 → vertex at top-right) */
function hexPath(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number,
  rotation = Math.PI / 6,  // flat-top
) {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + rotation
    const x = cx + radius * Math.cos(a)
    const y = cy + radius * Math.sin(a)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function layoutNodes(n: number, W: number, H: number): [number, number][] {
  if (n === 0) return []
  if (n === 1) return [[W / 2, H / 2]]
  const r = Math.min(W, H) * 0.30
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return [W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r]
  })
}

// ── Particle types ────────────────────────────────────────────────────────────

interface Particle {
  from:    number
  to:      number
  t:       number       // 0 → 1 along the line
  speed:   number       // fraction per second
  trail:   [number, number][]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TopologyScene({ nodes, totalThroughput }: TopologySceneProps) {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const nodesRef      = useRef(nodes)
  const tpRef         = useRef(totalThroughput)
  const particles     = useRef<Particle[]>([])
  const dashOffset    = useRef(0)
  const pulsePhase    = useRef<number[]>([])
  const lastTs        = useRef(0)

  nodesRef.current = nodes
  tpRef.current    = totalThroughput

  // Re-init particles when topology changes
  useEffect(() => {
    pulsePhase.current = nodes.map(() => Math.random() * Math.PI * 2)
    particles.current  = []
  }, [nodes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const observer = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
    })
    observer.observe(canvas)
    canvas.width  = canvas.offsetWidth  * devicePixelRatio
    canvas.height = canvas.offsetHeight * devicePixelRatio

    let raf: number

    const tick = (ts: number) => {
      const dt  = Math.min((ts - (lastTs.current || ts)) / 1000, 0.05)
      lastTs.current = ts

      const W   = canvas.offsetWidth
      const H   = canvas.offsetHeight
      const dpr = devicePixelRatio
      const ns  = nodesRef.current
      const tp  = Math.max(tpRef.current, 0)

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // ── Background hex grid ───────────────────────────────────────────────
      const bh  = BG_HEX_R
      const col = Math.sqrt(3) * bh
      const row = 1.5 * bh

      ctx.strokeStyle = rgba(C_CYAN, 0.04)
      ctx.lineWidth   = 0.5
      let r = -1
      while (r * row < H + bh * 2) {
        let c = -1
        const offset = r % 2 === 0 ? 0 : col / 2
        while (c * col + offset < W + bh * 2) {
          hexPath(ctx, c * col + offset, r * row, bh - 1)
          ctx.stroke()
          c++
        }
        r++
      }

      const positions = layoutNodes(ns.length, W, H)

      // ── Manage particle count ─────────────────────────────────────────────
      if (ns.length >= 2) {
        const target = Math.min(Math.max(Math.floor(tp / 5) + 2, 2), 20)
        while (particles.current.length < target) {
          const from = Math.floor(Math.random() * ns.length)
          let   to   = Math.floor(Math.random() * ns.length)
          while (to === from) to = Math.floor(Math.random() * ns.length)
          particles.current.push({
            from, to,
            t:     Math.random(),
            speed: 0.40 + Math.random() * 0.35,
            trail: [],
          })
        }
        if (particles.current.length > target + 4)
          particles.current.length = target + 4
      } else {
        particles.current = []
      }

      // ── Connection lines ──────────────────────────────────────────────────
      dashOffset.current -= dt * DASH_SPEED

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const [x1, y1] = positions[i]
          const [x2, y2] = positions[j]

          const cA = healthColor(ns[i].health)
          const cB = healthColor(ns[j].health)

          // Outer glow
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.strokeStyle = rgba(cA, 0.08)
          ctx.lineWidth   = 7
          ctx.setLineDash([])
          ctx.stroke()

          // Inner glow
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.strokeStyle = rgba(cA, 0.15)
          ctx.lineWidth   = 2
          ctx.stroke()

          // Animated dash flow
          const grad = ctx.createLinearGradient(x1, y1, x2, y2)
          grad.addColorStop(0, rgba(cA, 0.6))
          grad.addColorStop(1, rgba(cB, 0.6))
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.strokeStyle    = grad
          ctx.lineWidth      = 1
          ctx.setLineDash([6, 10])
          ctx.lineDashOffset = dashOffset.current
          ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // ── Particles ─────────────────────────────────────────────────────────
      const speedMul = 1 + tp * 0.012

      for (const p of particles.current) {
        p.t += p.speed * speedMul * dt
        if (p.t >= 1) {
          p.t    = 0
          p.trail = []
          const from = Math.floor(Math.random() * ns.length)
          let   to   = Math.floor(Math.random() * ns.length)
          while (to === from) to = Math.floor(Math.random() * ns.length)
          p.from = from; p.to = to
        }

        const p0 = positions[p.from]
        const p1 = positions[p.to]
        if (!p0 || !p1) continue

        const px = p0[0] + (p1[0] - p0[0]) * p.t
        const py = p0[1] + (p1[1] - p0[1]) * p.t

        p.trail.push([px, py])
        if (p.trail.length > 18) p.trail.shift()

        const col = healthColor(ns[p.from]?.health ?? 'ok')

        // Draw trail
        for (let k = 0; k < p.trail.length - 1; k++) {
          const alpha = (k / p.trail.length) * 0.65
          ctx.beginPath()
          ctx.moveTo(p.trail[k][0], p.trail[k][1])
          ctx.lineTo(p.trail[k + 1][0], p.trail[k + 1][1])
          ctx.strokeStyle = rgba(col, alpha)
          ctx.lineWidth   = 2.5 * (k / p.trail.length)
          ctx.stroke()
        }

        // Head glow
        const g = ctx.createRadialGradient(px, py, 0, px, py, 8)
        g.addColorStop(0, rgba(col, 0.85))
        g.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(px, py, 8, 0, Math.PI * 2)
        ctx.fill()

        // Bright core
        ctx.fillStyle = rgba(C_WHITE, 0.95)
        ctx.beginPath()
        ctx.arc(px, py, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── Hex nodes ─────────────────────────────────────────────────────────
      for (let i = 0; i < ns.length; i++) {
        const node = ns[i]
        const pos  = positions[i]
        if (!pos) continue
        const [x, y] = pos

        // Advance pulse
        pulsePhase.current[i] = (pulsePhase.current[i] ?? 0) + dt * 1.8
        const pulse = 1 + Math.sin(pulsePhase.current[i]) * 0.05

        const col    = healthColor(node.health)
        const alpha  = 0.55 + Math.sin(pulsePhase.current[i]) * 0.18

        // ── Outer ambient hex glow ────────────────────────────────────────
        ctx.save()
        ctx.shadowColor = rgba(col, 0.4)
        ctx.shadowBlur  = 24
        hexPath(ctx, x, y, HEX_R * 1.25 * pulse)
        ctx.strokeStyle = rgba(col, 0.12)
        ctx.lineWidth   = 1
        ctx.stroke()
        ctx.restore()

        // ── Hex fill ──────────────────────────────────────────────────────
        hexPath(ctx, x, y, HEX_R * pulse)
        const fill = ctx.createRadialGradient(x, y, 0, x, y, HEX_R)
        fill.addColorStop(0,   rgba(col, 0.14))
        fill.addColorStop(0.6, rgba(col, 0.07))
        fill.addColorStop(1,   rgba(col, 0.02))
        ctx.fillStyle = fill
        ctx.fill()

        // ── Hex border ────────────────────────────────────────────────────
        ctx.save()
        ctx.shadowColor = rgba(col, 0.6)
        ctx.shadowBlur  = 10
        hexPath(ctx, x, y, HEX_R * pulse)
        ctx.strokeStyle = rgba(col, alpha)
        ctx.lineWidth   = 1.5
        ctx.stroke()
        ctx.restore()

        // ── Corner accent dots ────────────────────────────────────────────
        for (let v = 0; v < 6; v++) {
          const a  = (Math.PI / 3) * v + Math.PI / 6
          const vx = x + HEX_R * pulse * Math.cos(a)
          const vy = y + HEX_R * pulse * Math.sin(a)
          ctx.fillStyle = rgba(col, 0.7)
          ctx.beginPath()
          ctx.arc(vx, vy, 2, 0, Math.PI * 2)
          ctx.fill()
        }

        // ── Inner divider line ────────────────────────────────────────────
        ctx.beginPath()
        ctx.moveTo(x - HEX_R * 0.55, y - 6)
        ctx.lineTo(x + HEX_R * 0.55, y - 6)
        ctx.strokeStyle = rgba(col, 0.18)
        ctx.lineWidth   = 0.8
        ctx.stroke()

        // ── Text content ──────────────────────────────────────────────────
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'

        // Node name
        ctx.fillStyle = rgba(C_WHITE, 0.92)
        ctx.font      = '600 11px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(node.name, x, y - 17)

        // Role badge (leader only)
        if (node.role === 'leader') {
          ctx.fillStyle = rgba(col, 0.22)
          ctx.beginPath()
          ctx.roundRect(x - 18, y - 9, 36, 13, 3)
          ctx.fill()
          ctx.fillStyle = rgba(col, 0.85)
          ctx.font      = '7px "JetBrains Mono", ui-monospace, monospace'
          ctx.fillText('LEADER', x, y - 2)
        }

        // Clients stat
        ctx.fillStyle = rgba(C_WHITE, 0.5)
        ctx.font      = '9px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(`${node.clients} clients`, x, y + 8)

        // Msgs/s stat
        ctx.fillStyle = rgba(col, 0.8)
        ctx.font      = '600 10px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(`${node.inMsgs}/s`, x, y + 22)

        // Health indicator dot at bottom of hex
        ctx.fillStyle = rgba(col, 0.9)
        ctx.beginPath()
        ctx.arc(x, y + 33, 3.5, 0, Math.PI * 2)
        ctx.fill()

        ctx.textBaseline = 'alphabetic'
      }

      // ── Empty state ───────────────────────────────────────────────────────
      if (ns.length === 0) {
        ctx.textAlign  = 'center'
        ctx.fillStyle  = rgba(C_CYAN, 0.25)
        ctx.font       = '12px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText('No nodes connected', W / 2, H / 2)
      }

      ctx.restore()
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); observer.disconnect() }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset:    0,
        width:    '100%',
        height:   '100%',
        display:  'block',
        background: BG,
      }}
    />
  )
}
