import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Core surfaces — OLED-friendly near-black base
        bg: {
          base:     '#070A0D',
          elevated: '#0D1117',
          surface:  '#111827',
          hover:    '#1A2332',
          active:   '#1E293B',
          border:   '#1E2A3A',
          'border-strong': '#2D3B4E',
        },
        // Text hierarchy
        text: {
          primary:   '#E2E8F0',
          secondary: '#94A3B8',
          muted:     '#4B5563',
          disabled:  '#1F2937',
          inverse:   '#0A0F1A',
        },
        // Semantic accent colors
        accent: {
          cyan:   '#06B6D4',
          'cyan-dim': '#0891B2',
          green:  '#10B981',
          'green-dim': '#059669',
          red:    '#EF4444',
          'red-dim': '#DC2626',
          yellow: '#F59E0B',
          'yellow-dim': '#D97706',
          purple: '#A855F7',
          'purple-dim': '#9333EA',
          orange: '#F97316',
          blue:   '#3B82F6',
        },
        // NATS brand
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
        'blink':      'blink 1.2s step-start infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        blink:   { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
      boxShadow: {
        'glow-cyan':   '0 0 12px 0 rgba(6,182,212,0.25)',
        'glow-green':  '0 0 12px 0 rgba(16,185,129,0.25)',
        'glow-red':    '0 0 12px 0 rgba(239,68,68,0.25)',
        'glow-purple': '0 0 12px 0 rgba(168,85,247,0.25)',
        'inner-glow':  'inset 0 1px 0 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
      },
      backgroundSize: {
        'grid': '24px 24px',
      },
    },
  },
  plugins: [],
} satisfies Config
