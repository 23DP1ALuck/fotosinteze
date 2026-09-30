import { Link } from 'react-router-dom'

import { useAuth } from '@/features/auth/auth-context'

function HomePage() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-svh flex-col bg-[#f9f9f6]">
      <header className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-4">
        <div className="flex items-center gap-2 text-[#1a3c34]">
          <span
            className="inline-block size-4 rounded-full border border-[#1a3c34]/80 bg-[linear-gradient(180deg,#fff_50%,#1a3c34_50%)]"
            aria-hidden
          />
          <span className="font-medium">finance manager</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[#6b7280] sm:inline">
            {user?.displayName}
          </span>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-[#d1d5db] bg-white px-3 py-1.5 text-sm font-medium text-[#1a3c34] hover:bg-[#f3f4f6]"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16 text-left">
        <h1 className="text-3xl font-semibold tracking-tight text-[#1a2e2a]">
          Welcome back, {user?.displayName}.
        </h1>
        <p className="mt-3 text-[#6b7280]">
          You are signed in as {user?.email}. Protected app screens can be added
          here next.
        </p>
        <p className="mt-8 text-sm text-[#6b7280]">
          Need another account?{' '}
          <Link className="font-medium text-[#1a3c34] hover:underline" to="/register">
            Create one
          </Link>
        </p>
      </main>
    </div>
  )
}

export default HomePage
