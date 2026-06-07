import { type ReactNode, type HTMLAttributes, forwardRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Parameters<typeof clsx>): string {
  return twMerge(clsx(inputs))
}

// ── Badge ─────────────────────────────────────────────────────────────────────

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'green' | 'yellow' | 'red' | 'purple' | 'cyan' | 'violet' | 'ghost'
  size?: 'xs' | 'sm'
}

export function Badge({ variant = 'default', size = 'sm', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-mono font-medium rounded border',
        size === 'xs' ? 'px-1 py-0 text-2xs' : 'px-1.5 py-0.5 text-xs',
        {
          'bg-bg-surface/80 border-bg-border text-text-secondary':                    variant === 'default',
          'bg-accent-green/10 border-accent-green/20 text-accent-green':              variant === 'green',
          'bg-accent-yellow/10 border-accent-yellow/20 text-accent-yellow':           variant === 'yellow',
          'bg-accent-red/10 border-accent-red/20 text-accent-red':                    variant === 'red',
          'bg-accent-purple/10 border-accent-purple/20 text-accent-purple':           variant === 'purple',
          'bg-accent-cyan/10 border-accent-cyan/20 text-accent-cyan':                 variant === 'cyan',
          'bg-accent-primary/10 border-accent-primary/25 text-accent-primary':        variant === 'violet',
          'bg-transparent border-transparent text-text-muted':                        variant === 'ghost',
        },
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

// ── Health dot ────────────────────────────────────────────────────────────────

interface HealthDotProps {
  health: string
  size?: 'xs' | 'sm' | 'md'
}

export function HealthDot({ health, size = 'sm' }: HealthDotProps) {
  const color = health === 'ok'
    ? 'bg-accent-green'
    : health === 'degraded' || health === 'slow' || health === 'lagging'
    ? 'bg-accent-yellow'
    : health === 'critical' || health === 'dead'
    ? 'bg-accent-red animate-pulse'
    : 'bg-text-muted'

  const sz = size === 'xs' ? 'w-1.5 h-1.5' : size === 'md' ? 'w-3 h-3' : 'w-2 h-2'

  return <span className={cn('rounded-full flex-shrink-0', color, sz)} />
}

// ── Button ────────────────────────────────────────────────────────────────────

interface ButtonProps extends HTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'
  size?: 'xs' | 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'sm', className, children, disabled, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 font-mono font-medium rounded-lg border select-none',
          'transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-accent-primary/40',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none active:scale-100',
          size === 'xs' ? 'px-2 py-0.5 text-2xs' : size === 'md' ? 'px-4 py-2 text-sm' : 'px-2.5 py-1 text-xs',
          {
            // Primary — violet brand accent (single interactive accent across the app)
            'bg-accent-primary text-text-inverse border-accent-primary hover:bg-accent-primary-dim hover:border-accent-primary-dim accent-glow':
              variant === 'primary',
            'glass-sm border-bg-border text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary hover:border-bg-border-strong':
              variant === 'secondary',
            'bg-transparent border-transparent text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary':
              variant === 'ghost',
            'bg-accent-red/10 border-accent-red/20 text-accent-red hover:bg-accent-red/20':
              variant === 'danger',
            'bg-transparent border-transparent text-text-muted hover:bg-bg-hover/60 hover:text-text-primary p-1':
              variant === 'icon',
          },
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

// ── Stepper (numeric +/- control) ──────────────────────────────────────────────
// Unified increment/decrement control. Replaces the hand-rolled +/- buttons
// scattered across publisher/consumer/stream views.

interface StepperProps {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  size?: 'sm' | 'md'
  suffix?: string
  className?: string
  label?: string
}

export function Stepper({
  value, onChange, min = -Infinity, max = Infinity, step = 1,
  size = 'sm', suffix, className, label,
}: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const box  = size === 'md' ? 'h-8 w-8' : 'h-6 w-7'
  const text = size === 'md' ? 'text-sm px-2.5 min-w-[3.25rem]' : 'text-xs px-2 min-w-[2.75rem]'
  const ico  = size === 'md' ? 15 : 13

  const btn =
    'flex items-center justify-center text-text-muted transition-colors ' +
    'hover:text-accent-primary hover:bg-bg-hover/60 active:bg-bg-active/60 ' +
    'disabled:opacity-30 disabled:pointer-events-none'

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex items-stretch rounded-lg border border-bg-border bg-bg-surface/50 overflow-hidden',
        className,
      )}
    >
      <button type="button" aria-label="Decrease" onClick={() => onChange(clamp(value - step))}
        disabled={value <= min} className={cn(btn, box)}>
        <Minus size={ico} strokeWidth={2.5} />
      </button>
      <div className={cn('flex items-center justify-center font-mono tabular-nums text-text-primary border-x border-bg-border', text)}>
        {value}{suffix && <span className="text-text-muted ml-0.5">{suffix}</span>}
      </div>
      <button type="button" aria-label="Increase" onClick={() => onChange(clamp(value + step))}
        disabled={value >= max} className={cn(btn, box)}>
        <Plus size={ico} strokeWidth={2.5} />
      </button>
    </div>
  )
}

// ── Kbd ───────────────────────────────────────────────────────────────────────

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-bg-border glass-sm text-text-muted font-mono text-2xs leading-none">
      {children}
    </kbd>
  )
}

// ── Separator ─────────────────────────────────────────────────────────────────

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px bg-bg-border/50', className)} />
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  if (!content) return <>{children}</>

  const posClass = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left:   'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side]

  return (
    <div className="group relative inline-flex w-full">
      {children}
      <div className={cn('pointer-events-none absolute hidden group-hover:block z-50', posClass)}>
        <div className="glass rounded-lg text-text-primary text-xs font-mono px-2 py-1 whitespace-nowrap shadow-glass">
          {content}
        </div>
      </div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label: string
  count?: number
  action?: ReactNode
  className?: string
}

export function SectionHeader({ label, count, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between px-3 py-1.5', className)}>
      <div className="flex items-center gap-2">
        <span className="text-2xs font-mono font-semibold text-text-muted uppercase tracking-widest">
          {label}
        </span>
        {count !== undefined && (
          <span className="text-2xs font-mono text-text-muted glass-sm border border-bg-border px-1 rounded">
            {count}
          </span>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description }: {
  icon?: ReactNode
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <div className="text-text-muted mb-3">{icon}</div>}
      <p className="text-sm font-mono text-text-secondary">{title}</p>
      {description && (
        <p className="text-xs font-mono text-text-muted mt-1">{description}</p>
      )}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

export function StatCard({ label, value, sub, color = 'default' }: {
  label: string
  value: string | number
  sub?: string
  color?: 'default' | 'green' | 'yellow' | 'red' | 'cyan' | 'purple' | 'violet'
}) {
  const valueColor = {
    default: 'text-text-primary',
    green:   'text-accent-green',
    yellow:  'text-accent-yellow',
    red:     'text-accent-red',
    cyan:    'text-accent-cyan',
    purple:  'text-accent-purple',
    violet:  'text-accent-primary',
  }[color]

  return (
    <div className="glass rounded-xl p-3 shadow-glass">
      <p className="text-2xs font-mono text-text-muted uppercase tracking-widest mb-1">{label}</p>
      <p className={cn('text-lg font-mono font-semibold leading-none', valueColor)}>{value}</p>
      {sub && <p className="text-2xs font-mono text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

// ── Mono text ─────────────────────────────────────────────────────────────────

export function MonoText({ children, className, dim }: {
  children: ReactNode
  className?: string
  dim?: boolean
}) {
  return (
    <span className={cn('font-mono text-xs', dim ? 'text-text-muted' : 'text-text-secondary', className)}>
      {children}
    </span>
  )
}

// ── Loading spinner ───────────────────────────────────────────────────────────

export function Spinner({ size = 'sm' }: { size?: 'xs' | 'sm' | 'md' }) {
  const sz = size === 'xs' ? 'w-3 h-3' : size === 'md' ? 'w-6 h-6' : 'w-4 h-4'
  return (
    <div className={cn('animate-spin rounded-full border-2 border-bg-border border-t-accent-primary', sz)} />
  )
}
