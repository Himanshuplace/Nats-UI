import { type ReactNode, type HTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Parameters<typeof clsx>): string {
  return twMerge(clsx(inputs))
}

// ── Badge ─────────────────────────────────────────────────────────────────────

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'green' | 'yellow' | 'red' | 'purple' | 'cyan' | 'ghost'
  size?: 'xs' | 'sm'
}

export function Badge({ variant = 'default', size = 'sm', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-mono font-medium rounded border',
        size === 'xs' ? 'px-1 py-0 text-2xs' : 'px-1.5 py-0.5 text-xs',
        {
          'bg-bg-surface border-bg-border text-text-secondary': variant === 'default',
          'bg-accent-green/10 border-accent-green/20 text-accent-green': variant === 'green',
          'bg-accent-yellow/10 border-accent-yellow/20 text-accent-yellow': variant === 'yellow',
          'bg-accent-red/10 border-accent-red/20 text-accent-red': variant === 'red',
          'bg-accent-purple/10 border-accent-purple/20 text-accent-purple': variant === 'purple',
          'bg-accent-cyan/10 border-accent-cyan/20 text-accent-cyan': variant === 'cyan',
          'bg-transparent border-transparent text-text-muted': variant === 'ghost',
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
  const color = health === 'ok' ? 'bg-accent-green'
    : health === 'degraded' || health === 'slow' || health === 'lagging' ? 'bg-accent-yellow'
    : health === 'critical' || health === 'dead' ? 'bg-accent-red animate-pulse'
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
          'inline-flex items-center gap-1.5 font-mono font-medium rounded border transition-colors focus:outline-none focus:ring-1 focus:ring-accent-cyan/50',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
          size === 'xs' ? 'px-2 py-0.5 text-2xs' : size === 'md' ? 'px-4 py-2 text-sm' : 'px-2.5 py-1 text-xs',
          {
            'bg-accent-cyan text-bg-base border-accent-cyan hover:bg-accent-cyan/90': variant === 'primary',
            'bg-bg-surface border-bg-border-strong text-text-secondary hover:bg-bg-hover hover:text-text-primary': variant === 'secondary',
            'bg-transparent border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary': variant === 'ghost',
            'bg-accent-red/10 border-accent-red/20 text-accent-red hover:bg-accent-red/20': variant === 'danger',
            'bg-transparent border-transparent text-text-muted hover:bg-bg-hover hover:text-text-primary p-1 rounded': variant === 'icon',
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

// ── Kbd ───────────────────────────────────────────────────────────────────────

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-bg-border-strong bg-bg-surface text-text-muted font-mono text-2xs leading-none">
      {children}
    </kbd>
  )
}

// ── Separator ─────────────────────────────────────────────────────────────────

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px bg-bg-border', className)} />
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-50">
        <div className="bg-bg-elevated border border-bg-border-strong text-text-primary text-xs font-mono px-2 py-1 rounded whitespace-nowrap shadow-lg">
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
          <span className="text-2xs font-mono text-text-muted bg-bg-surface border border-bg-border px-1 rounded">
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
  color?: 'default' | 'green' | 'yellow' | 'red' | 'cyan' | 'purple'
}) {
  const valueColor = {
    default: 'text-text-primary',
    green:   'text-accent-green',
    yellow:  'text-accent-yellow',
    red:     'text-accent-red',
    cyan:    'text-accent-cyan',
    purple:  'text-accent-purple',
  }[color]

  return (
    <div className="bg-bg-elevated border border-bg-border rounded-md p-3 shadow-inner-glow">
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
    <div className={cn('animate-spin rounded-full border-2 border-bg-border border-t-accent-cyan', sz)} />
  )
}
