import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // ── Border radius: Midnight Violet rounded scale ───────────────────────
    // One scale, used everywhere. chips/badges→sm, buttons/inputs→md/lg,
    // cards/panels→xl, modals→2xl, dots/pills→full.
    borderRadius: {
      'none': '0',
      'sm':   '6px',
      DEFAULT:'8px',
      'md':   '8px',
      'lg':   '10px',
      'xl':   '14px',
      '2xl':  '18px',
      '3xl':  '24px',
      'full': '9999px',
    },
    extend: {
      colors: {
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
        accent: {
          // Primary interactive — electric lime (dark) / deeper lime (light)
          primary:       'var(--accent-primary)',
          'primary-dim': 'var(--accent-primary-dim)',

          // Semantic data colors
          cyan:         '#06B6D4',
          'cyan-dim':   '#0891B2',
          green:        '#22c55e',
          'green-dim':  '#16a34a',
          red:          '#ff4040',
          'red-dim':    '#cc3030',
          yellow:       '#ffcc00',
          'yellow-dim': '#ccaa00',
          purple:       '#a855f7',
          'purple-dim': '#9333ea',
          orange:       '#f97316',
          blue:         '#3b82f6',
        },
        nats: {
          primary: '#27AAE1',
          dim:     '#1A6FA8',
        },
      },

      fontFamily: {
        // Space Grotesk — humanist precision feel, unlike any AI-default font
        sans: ['Space Grotesk', 'system-ui', '-apple-system', 'sans-serif'],
        // JetBrains Mono — for all data values, subjects, code, numbers
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },

      animation: {
        'pulse-slow':    'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':       'fadeIn 120ms ease-out',
        'slide-up':      'slideUp 150ms ease-out',
        'slide-in-l':    'slideInL 150ms ease-out',
        'blink':         'blink 1.2s step-start infinite',
        'spin-slow':     'spin 3s linear infinite',
        'lime-pulse':    'limePulse 2s ease-in-out infinite',
        'scanline':      'scanline 8s linear infinite',
      },

      keyframes: {
        fadeIn:    { from: { opacity: '0' },                                to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(4px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideInL:  { from: { opacity: '0', transform: 'translateX(-6px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        blink:     { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        limePulse: {
          '0%, 100%': { boxShadow: '0 0 8px 0 rgba(168, 255, 60, 0.2)' },
          '50%':      { boxShadow: '0 0 20px 2px rgba(168, 255, 60, 0.4)' },
        },
        scanline: {
          '0%':   { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '0 100vh' },
        },
      },

      boxShadow: {
        'card':    '0 1px 0 0 var(--surface-border)',
        'popover': '0 4px 24px -4px rgba(0,0,0,0.5), 0 0 0 1px var(--surface-border)',
        'glass':   '0 1px 0 0 var(--surface-border)',
        'signal':  '0 0 20px -4px rgba(168, 255, 60, 0.4)',
        // Legacy
        'glass-light':  'none',
        'glow-cyan':    '0 0 12px 0 rgba(6,182,212,0.15)',
        'glow-green':   '0 0 12px 0 rgba(34,197,94,0.15)',
        'glow-red':     '0 0 12px 0 rgba(255,64,64,0.2)',
        'glow-purple':  '0 0 12px 0 rgba(168,85,247,0.15)',
        'inner-glow':   'inset 0 1px 0 0 rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
} satisfies Config
