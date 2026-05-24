import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/components/layout/AppShell'
import { useWebSocketBridge } from '@/hooks/useWebSocket'
import { useUIStore } from '@/store'
import { api } from '@/lib/api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 3_000,
      refetchOnWindowFocus: false,
    },
  },
})

function AppInner() {
  useWebSocketBridge()

  const setActiveCluster = useUIStore(s => s.setActiveCluster)

  // Bootstrap: the backend may already be connected to NATS (via NATS_URL env var
  // set in docker-compose or locally). Fetch existing connections and mark them active
  // so all cluster-dependent queries (streams, consumers, topology) are enabled
  // immediately on load — without the user having to click "Connect" manually.
  useEffect(() => {
    api.connections.list()
      .then(conns => conns.forEach(conn => setActiveCluster(conn.id)))
      .catch(() => { /* backend not yet ready — WS topology event is the fallback */ })
  }, [])

  return <AppShell />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  )
}
