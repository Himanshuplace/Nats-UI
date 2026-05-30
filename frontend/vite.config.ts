import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Force Vite to always use the single hoisted copy of these packages.
    // Without this, @react-three/fiber's nested scheduler@0.21.0 conflicts
    // with React 18's scheduler@0.23.x causing "doesn't provide export" crashes.
    dedupe: ['react', 'react-dom', 'scheduler', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:  ['react', 'react-dom'],
          three:   ['three', '@react-three/fiber', '@react-three/drei'],
          gsap:    ['gsap'],
          editor:  ['@monaco-editor/react'],
          charts:  ['recharts'],
          flow:    ['reactflow'],
        },
      },
    },
  },
  optimizeDeps: {
    // Pre-bundle R3F packages so Vite's resolver can deduplicate the nested
    // scheduler@0.21.0 inside @react-three/fiber. Excluding them causes raw-ESM
    // serving which bypasses deduplication and triggers the scheduler crash:
    //   "doesn't provide an export named 'unstable_IdlePriority'"
    include: ['gsap', '@react-three/fiber', '@react-three/drei', 'three'],
  },
})
