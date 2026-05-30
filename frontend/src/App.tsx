import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/components/auth/LoginPage'
import { ConnectionSetup } from '@/components/auth/ConnectionSetup'
import { useWebSocketBridge } from '@/hooks/useWebSocket'
import { useUIStore } from '@/store'
import { api, setUnauthorizedHandler } from '@/lib/api'
import { Spinner } from '@/components/ui'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 3_000,
      refetchOnWindowFocus: false,
    },
  },
})

// Shown while checking for existing connections after login.
function LoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg-base">
      <Spinner size="md" />
    </div>
  )
}

function AppInner() {
  useWebSocketBridge()

  const setActiveCluster = useUIStore(s => s.setActiveCluster)
  const [loading, setLoading] = useState(true)
  const [hasConnections, setHasConnections] = useState(false)

  useEffect(() => {
    api.connections.list()
      .then(conns => {
        conns.forEach(c => setActiveCluster(c.id))
        setHasConnections(conns.length > 0)
      })
      .catch(() => setHasConnections(false))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingScreen />

  if (!hasConnections) {
    return (
      <ConnectionSetup
        onConnected={(id) => {
          setActiveCluster(id)
          setHasConnections(true)
        }}
      />
    )
  }

  return <AppShell />
}

export default function App() {
  const isAuthenticated = useUIStore(s => s.isAuthenticated)
  const clearAuth = useUIStore(s => s.clearAuth)

  // Wire global 401 handler: clears auth state so LoginPage is shown.
  useEffect(() => {
    setUnauthorizedHandler(clearAuth)
  }, [clearAuth])

  return (
    <QueryClientProvider client={queryClient}>
      {isAuthenticated ? <AppInner /> : <LoginPage />}
    </QueryClientProvider>
  )
}
