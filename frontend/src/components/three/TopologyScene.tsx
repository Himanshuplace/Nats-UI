/**
 * TopologyScene — "Orbital Mesh" visualization.
 *
 * Each NATS node is an atom: a glowing nucleus with electrons orbiting
 * on tilted ellipses (simulated 3D projection). Connections are animated
 * bezier channels. Messages are comets with fading light trails.
 * Arrival at a node triggers an expanding ripple ring.
 *
 * Pure Canvas 2D — no Three.js, no WebGL, no external deps.
 */
import { useEffect, useRef } from 'react'
import type { NodeInfo } from '@/types'

export interface TopologySceneProps {
  nodes: NodeInfo[]
  totalThroughput: number
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Electron {
  angle: number
  speedSign: number   // +1 or -1 — direction
  orbitalSpeed: number
  a: number           // semi-major axis
  b: number           // semi-minor axis
  tilt: number        // ellipse rotation in radians
  dotSize: number
}

interface NodeState {
  electrons: Electron[]
  phase: number       // heartbeat oscillator
  ripple: number      // expanding ring radius (0 = idle)
  rippleAlpha: number
}

interface Comet {
  from: number
  to: number
  t: number
  speed: number
  trail: Array<[number, number]>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function healthRGB(health: string): [number, number, number] {
  if (health === 'critical') return [255,  64,  64]
  if (health === 'degraded') return [255, 204,   0]
  return [168, 255, 60]
}

function rgb(c: [number, number, number], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

// Point on a tilted ellipse (3D-projected orbital)
function orbitPos(
  cx: number, cy: number,
  a: number, b: number,
  tilt: number, angle: number,
): [number, number] {
  const ex = a * Math.cos(angle)
  const ey = b * Math.sin(angle)
  return [
    cx + ex * Math.cos(tilt) - ey * Math.sin(tilt),
    cy + ex * Math.sin(tilt) + ey * Math.cos(tilt),
  ]
}

// Quadratic bezier point
function qbez(
  x0: number, y0: number,
  cpx: number, cpy: number,
  x1: number, y1: number,
  t: number,
): [number, number] {
  const m = 1 - t
  return [
    m * m * x0 + 2 * m * t * cpx + t * t * x1,
    m * m * y0 + 2 * m * t * cpy + t * t * y1,
  ]
}

// Rounded rectangle path helper (cross-browser)
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y,     x + w, y + r,     r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x,     y + h, x,     y + h - r, r)
  ctx.lineTo(x,     y + r)
  ctx.arcTo(x,     y,     x + r, y,         r)
  ctx.closePath()
}

// Place nodes in a circle; single node is centered
function layoutNodes(n: number, w: number, h: number): [number, number][] {
  if (n === 0) return []
  if (n === 1) return [[w / 2, h / 2]]
  const r = Math.min(w, h) * 0.28
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return [w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r]
  })
}

function makeElectrons(): Electron[] {
  // Fixed 3-electron structure; speed + opacity scale with throughput at draw time
  return [
    { angle: 0,              speedSign:  1, orbitalSpeed: 1.8, a: 22, b: 9,  tilt: 0.3,  dotSize: 3.0 },
    { angle: Math.PI * 0.6,  speedSign: -1, orbitalSpeed: 1.2, a: 30, b: 12, tilt: 1.4,  dotSize: 2.4 },
    { angle: Math.PI * 1.3,  speedSign:  1, orbitalSpeed: 0.9, a: 38, b: 14, tilt: 2.3,  dotSize: 1.8 },
  ]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TopologyScene({ nodes, totalThroughput }: TopologySceneProps) {
  const canvasRef      = useRef<HTMLCanvasElement>(null)
  const throughputRef  = useRef(totalThroughput)
  const nodesRef       = useRef(nodes)
  const nodeStates     = useRef<NodeState[]>([])
  const comets         = useRef<Comet[]>([])
  const dashOffset     = useRef(0)
  const lastTs         = useRef(0)

  // Keep refs current on every render (no effect re-run needed)
  throughputRef.current = totalThroughput
  nodesRef.current      = nodes

  // Re-init only when the number of nodes changes
  useEffect(() => {
    nodeStates.current = nodes.map(() => ({
      electrons:   makeElectrons(),
      phase:       Math.random() * Math.PI * 2,
      ripple:      0,
      rippleAlpha: 0,
    }))

    const spawnComets = (n: NodeInfo[]) => {
      if (n.length < 2) { comets.current = []; return }
      const base = 4
      comets.current = Array.from({ length: base }, (_, i) => {
        const from = i % n.length
        const to   = (i + 1) % n.length
        return { from, to, t: i / base, speed: 0.35 + Math.random() * 0.3, trail: [] }
      })
    }
    spawnComets(nodes)
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
      const dt   = Math.min((ts - (lastTs.current || ts)) / 1000, 0.05)
      lastTs.current = ts

      const W    = canvas.offsetWidth
      const H    = canvas.offsetHeight
      const dpr  = devicePixelRatio
      const ns_  = nodesRef.current
      const tp   = Math.max(throughputRef.current, 0)

      // Dynamic comet count based on throughput
      const targetCometCount = ns_.length < 2 ? 0 : Math.min(Math.max(Math.floor(tp / 8) + 3, 3), 18)
      while (comets.current.length < targetCometCount && ns_.length >= 2) {
        const from = Math.floor(Math.random() * ns_.length)
        let   to   = Math.floor(Math.random() * ns_.length)
        while (to === from) to = Math.floor(Math.random() * ns_.length)
        comets.current.push({ from, to, t: Math.random(), speed: 0.35 + Math.random() * 0.35, trail: [] })
      }
      if (comets.current.length > targetCometCount) {
        comets.current.length = targetCometCount
      }

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      const positions = layoutNodes(ns_.length, W, H)
      dashOffset.current -= dt * 55

      // ── Dot-grid background ───────────────────────────────────────────────
      const gs = 30
      ctx.fillStyle = 'rgba(255,255,255,0.02)'
      for (let x = gs / 2; x < W; x += gs) {
        for (let y = gs / 2; y < H; y += gs) {
          ctx.beginPath()
          ctx.arc(x, y, 1, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ── Connections ───────────────────────────────────────────────────────
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const [x1, y1] = positions[i]
          const [x2, y2] = positions[j]
          const dx = x2 - x1, dy = y2 - y1
          const len = Math.sqrt(dx * dx + dy * dy) || 1
          const cpx = (x1 + x2) / 2 - (dy / len) * 35
          const cpy = (y1 + y2) / 2 + (dx / len) * 35

          const cA = healthRGB(ns_[i].health)
          const cB = healthRGB(ns_[j].health)

          // Soft glow beneath the line
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.quadraticCurveTo(cpx, cpy, x2, y2)
          ctx.strokeStyle = rgb(cA, 0.07)
          ctx.lineWidth = 10
          ctx.setLineDash([])
          ctx.stroke()

          // Animated flowing dashes — the "data channel"
          const grad = ctx.createLinearGradient(x1, y1, x2, y2)
          grad.addColorStop(0, rgb(cA, 0.55))
          grad.addColorStop(1, rgb(cB, 0.55))
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.quadraticCurveTo(cpx, cpy, x2, y2)
          ctx.strokeStyle = grad
          ctx.lineWidth = 1.2
          ctx.setLineDash([5, 12])
          ctx.lineDashOffset = dashOffset.current
          ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // ── Comets (message packets) ──────────────────────────────────────────
      const cometSpeed = 1 + tp * 0.008   // faster with more throughput
      for (const c of comets.current) {
        c.t += c.speed * cometSpeed * dt
        if (c.t >= 1) {
          c.t = 0
          c.trail = []
          // Trigger arrival ripple
          const ns = nodeStates.current[c.to]
          if (ns) { ns.ripple = 15; ns.rippleAlpha = 0.8 }
          // Pick a new random destination
          const from = Math.floor(Math.random() * ns_.length)
          let   to   = Math.floor(Math.random() * ns_.length)
          while (to === from) to = Math.floor(Math.random() * ns_.length)
          c.from = from; c.to = to
        }

        const p0 = positions[c.from], p1 = positions[c.to]
        if (!p0 || !p1) continue

        const dx = p1[0] - p0[0], dy = p1[1] - p0[1]
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const cpx = (p0[0] + p1[0]) / 2 - (dy / len) * 35
        const cpy = (p0[1] + p1[1]) / 2 + (dx / len) * 35

        const [cx, cy] = qbez(p0[0], p0[1], cpx, cpy, p1[0], p1[1], c.t)
        c.trail.push([cx, cy])
        if (c.trail.length > 16) c.trail.shift()

        const colR = healthRGB(ns_[c.from]?.health ?? 'ok')

        // Light trail
        for (let k = 0; k < c.trail.length - 1; k++) {
          const a  = (k / c.trail.length) * 0.75
          const lw = 2.5 * (k / c.trail.length)
          ctx.beginPath()
          ctx.moveTo(c.trail[k][0], c.trail[k][1])
          ctx.lineTo(c.trail[k + 1][0], c.trail[k + 1][1])
          ctx.strokeStyle = rgb(colR, a)
          ctx.lineWidth = lw
          ctx.stroke()
        }

        // Comet head glow
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9)
        g.addColorStop(0, rgb(colR, 0.85))
        g.addColorStop(1, rgb(colR, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx, cy, 9, 0, Math.PI * 2)
        ctx.fill()

        // Bright core dot
        ctx.fillStyle = rgb([255, 255, 255], 0.95)
        ctx.beginPath()
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── Nodes ─────────────────────────────────────────────────────────────
      const speedMul = 1 + tp * 0.015   // electrons spin faster with throughput
      const minElectronAlpha = 0.4      // always at least slightly visible

      for (let i = 0; i < ns_.length; i++) {
        const node = ns_[i]
        const pos  = positions[i]
        const ns   = nodeStates.current[i]
        if (!pos || !ns) continue
        const [x, y] = pos
        const col = healthRGB(node.health)

        // Animate state
        ns.phase += dt * 2.8
        if (ns.ripple > 0) {
          ns.ripple      += dt * 90
          ns.rippleAlpha -= dt * 2.2
          if (ns.rippleAlpha <= 0) { ns.ripple = 0; ns.rippleAlpha = 0 }
        }

        // Arrival ripple
        if (ns.ripple > 0) {
          ctx.beginPath()
          ctx.arc(x, y, ns.ripple, 0, Math.PI * 2)
          ctx.strokeStyle = rgb(col, ns.rippleAlpha * 0.8)
          ctx.lineWidth = 1.5
          ctx.stroke()
        }

        // Ambient node glow
        const glowR = 65
        const glow  = ctx.createRadialGradient(x, y, 0, x, y, glowR)
        glow.addColorStop(0,   rgb(col, 0.14))
        glow.addColorStop(0.5, rgb(col, 0.05))
        glow.addColorStop(1,   rgb(col, 0))
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(x, y, glowR, 0, Math.PI * 2)
        ctx.fill()

        // Orbital track guidelines + electrons
        ns.electrons.forEach((e, ei) => {
          e.angle += e.speedSign * e.orbitalSpeed * speedMul * dt

          // Track guideline (faint ellipse)
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(e.tilt)
          ctx.strokeStyle = rgb(col, 0.07 + ei * 0.01)
          ctx.lineWidth = 0.5
          ctx.beginPath()
          ctx.ellipse(0, 0, e.a, e.b, 0, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()

          // Electron trail (backward angle steps)
          const TRAIL = 10
          for (let k = TRAIL; k >= 0; k--) {
            const pastAngle = e.angle - e.speedSign * e.orbitalSpeed * speedMul * dt * k * 1.6
            const [ex, ey]  = orbitPos(x, y, e.a, e.b, e.tilt, pastAngle)
            const alpha = (1 - k / TRAIL) * (minElectronAlpha + tp * 0.005)
            const size  = e.dotSize * (1 - k / TRAIL * 0.6)
            ctx.fillStyle = rgb(col, alpha)
            ctx.beginPath()
            ctx.arc(ex, ey, size, 0, Math.PI * 2)
            ctx.fill()
          }

          // Electron head: glow + bright core
          const [ex, ey] = orbitPos(x, y, e.a, e.b, e.tilt, e.angle)
          const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, e.dotSize * 3)
          eg.addColorStop(0, rgb(col, 0.9))
          eg.addColorStop(1, rgb(col, 0))
          ctx.fillStyle = eg
          ctx.beginPath()
          ctx.arc(ex, ey, e.dotSize * 3, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = 'rgba(255,255,255,0.95)'
          ctx.beginPath()
          ctx.arc(ex, ey, e.dotSize * 0.65, 0, Math.PI * 2)
          ctx.fill()
        })

        // Pulsing nucleus
        const pulse   = 1 + Math.sin(ns.phase) * 0.1
        const coreRad = 13 * pulse
        const coreG   = ctx.createRadialGradient(x, y, 0, x, y, coreRad)
        coreG.addColorStop(0,   'rgba(255,255,255,0.98)')
        coreG.addColorStop(0.35, rgb(col, 0.9))
        coreG.addColorStop(1,    rgb(col, 0.25))
        ctx.fillStyle = coreG
        ctx.beginPath()
        ctx.arc(x, y, coreRad, 0, Math.PI * 2)
        ctx.fill()

        // Nucleus center dot
        ctx.fillStyle = 'rgba(255,255,255,1)'
        ctx.beginPath()
        ctx.arc(x, y, 3.5, 0, Math.PI * 2)
        ctx.fill()

        // Leader: outer halo ring
        if (node.role === 'leader') {
          ctx.beginPath()
          ctx.arc(x, y, 52 * pulse, 0, Math.PI * 2)
          ctx.strokeStyle = rgb(col, 0.25)
          ctx.lineWidth = 1
          ctx.setLineDash([3, 8])
          ctx.stroke()
          ctx.setLineDash([])
        }

        // ── Labels ────────────────────────────────────────────────────────

        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'

        // Node name
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.font      = '600 11px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(node.name, x, y - 68)

        // Version tag (subtle)
        if (node.version) {
          ctx.fillStyle = 'rgba(161,161,170,0.5)'
          ctx.font      = '9px "JetBrains Mono", ui-monospace, monospace'
          ctx.fillText(`v${node.version}`, x, y - 56)
        }

        // Stats row
        ctx.fillStyle = rgb(col, 0.65)
        ctx.font      = '9px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(`${node.clients} cli  ·  ${node.inMsgs}/s`, x, y + 68)

        // Health pill
        const bw = 54
        const bh = 15
        const bx = x - bw / 2
        const by = y + 75
        roundRect(ctx, bx, by, bw, bh, 4)
        ctx.fillStyle = rgb(col, 0.13)
        ctx.fill()
        roundRect(ctx, bx, by, bw, bh, 4)
        ctx.strokeStyle = rgb(col, 0.25)
        ctx.lineWidth   = 0.8
        ctx.stroke()
        ctx.fillStyle = rgb(col, 0.8)
        ctx.font      = '8px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(node.health.toUpperCase(), x, by + bh / 2)

        ctx.textBaseline = 'alphabetic'
      }

      // ── Empty state ───────────────────────────────────────────────────────
      if (ns_.length === 0) {
        ctx.textAlign  = 'center'
        ctx.fillStyle  = 'rgba(161,161,170,0.4)'
        ctx.font       = '13px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText('No nodes', W / 2, H / 2)
      }

      ctx.restore()
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, []) // canvas lifecycle only — reads live data via refs

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        background: '#09090b',
      }}
    />
  )
}
