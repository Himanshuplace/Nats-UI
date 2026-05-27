import type { Config } from 'tailwindcss'

// All bg/text colors reference CSS custom properties so the entire
// palette flips for free when `.dark` is toggled on <html>.
// Accent colors stay as hex — they read well in both modes.

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
        // ── Accents — same in dark & light ────────────────────────────────
        accent: {
          cyan:         '#06B6D4',
          'cyan-dim':   '#0891B2',
          green:        '#10B981',
          'green-dim':  '#059669',
          red:          '#EF4444',
          'red-dim':    '#DC2626',
          yellow:       '#F59E0B',
          'yellow-dim': '#D97706',
          purple:       '#A855F7',
          'purple-dim': '#9333EA',
          orange:       '#F97316',
          blue:         '#3B82F6',
        },
        // ── NATS brand ────────────────────────────────────────────────────
        nats: {
          primary: '#27AAE1',
          dim:     '#1A6FA8',
          dark:    '#0D3A5C',
        },
      },

      fontFamily: {
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },

      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 150ms ease-out',
        'slide-up':   'slideUp 200ms ease-out',
        'slide-in-l': 'slideInL 200ms ease-out',
        'blink':      'blink 1.2s step-start infinite',
        'spin-slow':  'spin 3s linear infinite',
      },

      keyframes: {
        fadeIn:   { from: { opacity: '0' },                                to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(6px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideInL: { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        blink:    { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },

      boxShadow: {
        'glass':       '0 4px 32px -4px rgba(0,0,0,0.3), inset 0 1px 0 0 rgba(255,255,255,0.06)',
        'glass-light': '0 4px 32px -4px rgba(0,0,0,0.08), inset 0 1px 0 0 rgba(255,255,255,0.9)',
        'glow-cyan':   '0 0 20px 0 rgba(6,182,212,0.2)',
        'glow-green':  '0 0 20px 0 rgba(16,185,129,0.2)',
        'glow-red':    '0 0 20px 0 rgba(239,68,68,0.2)',
        'glow-purple': '0 0 20px 0 rgba(168,85,247,0.2)',
        'inner-glow':  'inset 0 1px 0 0 rgba(255,255,255,0.05)',
      },
    },
  },
  plugins: [],
} satisfies Config
