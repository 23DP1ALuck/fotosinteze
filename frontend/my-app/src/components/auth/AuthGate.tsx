import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/features/auth/auth-context'

function AuthLoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-[#f9f9f6] text-[#6b7280]">
      Loading…
    </div>
  )
}

function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <AuthLoadingScreen />
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}

function GuestRoute() {
  const { status } = useAuth()

  if (status === 'loading') {
    return <AuthLoadingScreen />
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export { GuestRoute, ProtectedRoute }
