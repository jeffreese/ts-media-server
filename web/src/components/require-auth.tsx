import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '~/hooks/use-auth'

export function RequireAuth() {
  const { user, authEnabled, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground-faint border-t-accent" />
      </div>
    )
  }

  if (authEnabled && !user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
