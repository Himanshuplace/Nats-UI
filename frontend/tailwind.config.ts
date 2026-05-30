import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Semantic surfaces (CSS-var backed, switch with theme) ──────────
        bg: {
          base:            'rgb(var(--c-bg-base) / <alpha-value>)',
          elevated:        'rgb(var(--c-bg-elevated) / <alpha-value>)',
          surface:         'rgb(var(--c-bg-surface) / <alpha-value>)',
          hover:           'rgb(var(--c-bg-hover) / <alpha-value>)',
          active:          'rgb(var(--c-bg-active) / <alpha-value>)',
          border:          'rgb(var(--c-bg-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--c-bg-border-strong) / <alpha-value>)',
        },
        text: {
          primary:   'rgb(var(--c-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          muted:     'rgb(var(--c-text-muted) / <alpha-value>)',
          disabled:  'rgb(var(--c-text-disabled) / <alpha-value>)',
          inverse:   'rgb(var(--c-text-inverse) / <alpha-value>)',
        },
        // ── Accent: indigo as primary interactive, semantic colors for data ─
        accent: {
          // Primary interactive — buttons, active nav, focus rings
          primary:       '#6366f1',   // indigo-500
          'primary-dim': '#4f46e5',   // indigo-600
          'primary-fg':  '#e0e7ff',   // indigo-100

          // Semantic status — keep these semantically correct
          cyan:         '#06B6D4',    // live / streaming / data-in-motion
          'cyan-dim':   '#0891B2',
          green:        '#22c55e',    // healthy / connected / success
          'green-dim':  '#16a34a',
          red:          '#ef4444',    // error / critical / danger
          'red-dim':    '#dc2626',
          yellow:       '#eab308',    // warning / degraded / slow
          'yellow-dim': '#ca8a04',
          purple:       '#a855f7',    // JetStream / special
          'purple-dim': '#9333ea',
          orange:       '#f97316',
          blue:         '#3b82f6',
        },
        // ── NATS brand ────────────────────────────────────────────────────
        nats: {
          primary: '#27AAE1',
          dim:     '#1A6FA8',
          dark:    '#0D3A5C',
        },
      },

      fontFamily: {
        // Primary UI font — Inter is the gold standard for developer dashboards
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // Monospace — for data values, subjects, code, timestamps ONLY
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },

      letterSpacing: {
        'data': '0.01em',   // subtle tracking for monospace data
      },

      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 120ms ease-out',
        'slide-up':   'slideUp 160ms ease-out',
        'slide-in-l': 'slideInL 160ms ease-out',
        'blink':      'blink 1.2s step-start infinite',
        'spin-slow':  'spin 3s linear infinite',
      },

      keyframes: {
        fadeIn:   { from: { opacity: '0' },                                to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(4px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideInL: { from: { opacity: '0', transform: 'translateX(-6px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        blink:    { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },

      boxShadow: {
        // Used for real elevation in light mode, not decorative in dark
        'card':   '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'popover':'0 4px 16px -2px rgba(0,0,0,0.12), 0 2px 6px -1px rgba(0,0,0,0.06)',
        // Legacy aliases for components that still reference these
        'glass':       '0 1px 3px 0 rgba(0,0,0,0.08)',
        'glass-light': '0 1px 3px 0 rgba(0,0,0,0.06)',
        'glow-cyan':   '0 0 12px 0 rgba(6,182,212,0.15)',
        'glow-green':  '0 0 12px 0 rgba(34,197,94,0.15)',
        'glow-red':    '0 0 12px 0 rgba(239,68,68,0.15)',
        'glow-purple': '0 0 12px 0 rgba(168,85,247,0.15)',
        'inner-glow':  'inset 0 1px 0 0 rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
} satisfies Config
