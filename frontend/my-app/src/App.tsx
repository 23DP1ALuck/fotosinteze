import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { NavigationShortcuts } from '@/components/navigation/NavigationShortcuts'
import { GuestRoute, ProtectedRoute } from '@/components/auth/AuthGate'
import { AuthProvider } from '@/features/auth/auth-context'
import HomePage from '@/pages/HomePage'
import LandingPage from '@/pages/LandingPage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import { QueryProvider } from '@/lib/QueryProvider'

function App() {
  return (
    <QueryProvider><AuthProvider>
      <BrowserRouter>
        <NavigationShortcuts />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<HomePage />} />
          </Route>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider></QueryProvider>
  )
}

export default App
