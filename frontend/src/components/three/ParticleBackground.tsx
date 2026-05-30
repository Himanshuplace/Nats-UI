/**
 * ParticleBackground — Canvas 2D particle field.
 *
 * Renders tiny phosphor-lime particles drifting across the screen.
 * Reacts to NATS throughput: more traffic = more/faster particles.
 *
 * No Three.js — pure Canvas 2D for minimal bundle cost.
 * Runs at ~60fps but each frame is < 0.3ms CPU.
 */
import { useEffect, useRef, useCallback } from 'react'
import { useDataStore } from '@/store'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  opacity: number
  size: number
  life: number      // 0–1, fades in at birth and out at death
  maxLife: number   // total lifespan in frames
}

const BASE_COUNT  = 80
const MAX_COUNT   = 200
const BASE_SPEED  = 0.4
const LIME_R = 168, LIME_G = 255, LIME_B = 60

function createParticle(w: number, h: number, speedMul: number): Particle {
  return {
    x:       Math.random() * w,
    y:       Math.random() * h,
    vx:      (Math.random() * 0.6 + 0.2) * BASE_SPEED * speedMul * (Math.random() > 0.5 ? 1 : -0.3),
    vy:      (Math.random() - 0.5) * 0.15 * speedMul,
    opacity: 0,
    size:    Math.random() * 1.2 + 0.3,
    life:    0,
    maxLife: Math.floor(Math.random() * 400 + 200),
  }
}

export function ParticleBackground() {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number>(0)
  const stateRef   = useRef({
    particles:  [] as Particle[],
    targetCount: BASE_COUNT,
    speedMul:   1,
    w: 0,
    h: 0,
  })

  // Subscribe to throughput — map to particle density + speed
  const updateFromThroughput = useCallback((msgs: number) => {
    const t = Math.min(msgs / 50, 1)   // Normalize: 50 msg/s = full density
    stateRef.current.targetCount = Math.floor(BASE_COUNT + t * (MAX_COUNT - BASE_COUNT))
    stateRef.current.speedMul    = 1 + t * 1.5
  }, [])

  useEffect(() => {
    // Subscribe to Zustand store throughput without re-rendering
    const unsub = useDataStore.subscribe(s => {
      const total = Object.values(s.throughput).reduce((sum, pts) => {
        const last = pts[pts.length - 1]
        return sum + (last?.inMsgs ?? 0) + (last?.outMsgs ?? 0)
      }, 0)
      updateFromThroughput(total)
    })
    return unsub
  }, [updateFromThroughput])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })!
    const state = stateRef.current

    function resize() {
      state.w = canvas!.width  = window.innerWidth
      state.h = canvas!.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Seed initial particles
    for (let i = 0; i < BASE_COUNT; i++) {
      const p = createParticle(state.w, state.h, 1)
      p.life = Math.floor(Math.random() * p.maxLife)  // Stagger births
      state.particles.push(p)
    }

    function tick() {
      ctx.clearRect(0, 0, state.w, state.h)

      const { particles, targetCount, speedMul } = state

      // Spawn or cull to reach target count
      while (particles.length < targetCount) {
        particles.push(createParticle(state.w, state.h, speedMul))
      }
      if (particles.length > targetCount + 20) {
        particles.splice(targetCount, particles.length - targetCount)
      }

      ctx.save()

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life++

        // Life-based opacity (fade in, sustain, fade out)
        const lifeRatio = p.life / p.maxLife
        const alpha =
          lifeRatio < 0.1  ? lifeRatio / 0.1 :
          lifeRatio > 0.85 ? 1 - (lifeRatio - 0.85) / 0.15 :
          1

        p.opacity = alpha * 0.12  // Max 12% opacity — subtle

        // Move
        p.x += p.vx * speedMul
        p.y += p.vy * speedMul

        // Respawn when dead or out-of-bounds
        if (p.life >= p.maxLife || p.x > state.w + 10 || p.x < -10) {
          particles[i] = createParticle(state.w, state.h, speedMul)
          continue
        }

        // Draw — tiny square (not circle, matches Signal sharp aesthetic)
        ctx.fillStyle = `rgba(${LIME_R},${LIME_G},${LIME_B},${p.opacity})`
        ctx.fillRect(p.x, p.y, p.size, p.size)
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
        mixBlendMode: 'screen',  // Particles blend through surfaces
      }}
    />
  )
}
