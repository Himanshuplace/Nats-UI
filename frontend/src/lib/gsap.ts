/**
 * GSAP setup and utilities for Signal UI.
 * Import from here rather than directly from 'gsap' so config is always applied.
 */
import gsap from 'gsap'

// ── Global configuration ──────────────────────────────────────────────────────

gsap.config({
  autoSleep: 60,         // Pause ticker after 60s of inactivity
  force3D: true,         // Always use translate3d for GPU layers
  nullTargetWarn: false, // Don't warn when target is null (common in cleanup)
})

// Consistent easing curves used throughout the app
export const ease = {
  out:      'power2.out',
  in:       'power2.in',
  inOut:    'power2.inOut',
  spring:   'back.out(1.4)',
  sharp:    'expo.out',
  bounce:   'elastic.out(1, 0.4)',
} as const

// ── Page transition ───────────────────────────────────────────────────────────

/**
 * Animate a view container in.
 * Call this in a useLayoutEffect when the active view changes.
 */
export function animateViewIn(el: HTMLElement | null): gsap.core.Tween | null {
  if (!el) return null
  return gsap.fromTo(
    el,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.22, ease: ease.out, clearProps: 'transform,opacity' },
  )
}

// ── Number counter ────────────────────────────────────────────────────────────

/**
 * Animate a numeric value displayed in a DOM element.
 * Stores the current value in a data attribute for accurate delta calculation.
 */
export function animateCounter(
  el: HTMLElement | null,
  to: number,
  format: (n: number) => string,
  duration = 0.5,
): void {
  if (!el) return
  const from = parseFloat(el.dataset.gsapValue ?? '0') || 0
  if (from === to) return
  const obj = { value: from }
  gsap.to(obj, {
    value: to,
    duration,
    ease: ease.out,
    onUpdate() {
      el.textContent = format(Math.round(obj.value))
    },
    onComplete() {
      el.dataset.gsapValue = String(to)
    },
  })
}

// ── Stagger list ──────────────────────────────────────────────────────────────

/**
 * Animate a list of elements in with stagger.
 * Use for initial render of tables, cards, etc.
 */
export function staggerIn(els: NodeListOf<Element> | Element[], delay = 0): gsap.core.Tween {
  return gsap.fromTo(
    Array.from(els),
    { opacity: 0, y: 4 },
    {
      opacity: 1,
      y: 0,
      duration: 0.18,
      ease: ease.out,
      stagger: 0.03,
      delay,
      clearProps: 'transform,opacity',
    },
  )
}

// ── Indicator slide ───────────────────────────────────────────────────────────

/**
 * Slide the sidebar active indicator to a new position.
 * Pass the indicator element and the target button element.
 */
export function slideIndicator(
  indicator: HTMLElement | null,
  target: HTMLElement | null,
  container: HTMLElement | null,
): void {
  if (!indicator || !target || !container) return
  const targetRect    = target.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  gsap.to(indicator, {
    y:        targetRect.top - containerRect.top,
    height:   targetRect.height,
    duration: 0.2,
    ease:     ease.sharp,
  })
}

// ── Flash ─────────────────────────────────────────────────────────────────────

/**
 * Flash an element with the lime accent — used for new messages, send confirmation.
 */
export function flashLime(el: HTMLElement | null): void {
  if (!el) return
  gsap.timeline()
    .to(el,  { backgroundColor: 'rgba(168, 255, 60, 0.15)', duration: 0.08, ease: 'none' })
    .to(el,  { backgroundColor: 'transparent',              duration: 0.4,  ease: ease.out })
}

// Re-export GSAP itself for cases where a component needs direct access
export { gsap }
