'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`)
    }
  }, [user, loading, router, pathname])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</div>
      </main>
    </div>
  )
}

function Sidebar() {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/contacts', label: 'Contacts' },
    { href: '/sessions', label: 'Sessions' },
    { href: '/activities', label: 'Activities' },
    { href: '/events', label: 'Events' },
    { href: '/bookings', label: 'Bookings' },
    { href: '/coaching', label: 'Coaching' },
    { href: '/gamification', label: 'Gamification' },
  ]

  const teamItems = [
    { href: '/team/members', label: 'Members' },
    { href: '/team/portal', label: 'Portal' },
    { href: '/team/settings', label: 'Settings' },
  ]

  return (
    <aside className="w-60 flex-shrink-0 border-r bg-card flex flex-col">
      <div className="p-6 border-b">
        <span className="text-xl font-bold tracking-tight">Lineup</span>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1">Main</p>
        {navItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname === item.href
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {item.label}
          </a>
        ))}

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1 pt-4">Team</p>
        {teamItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname.startsWith(item.href)
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="p-4 border-t">
        <SignOutButton />
      </div>
    </aside>
  )
}

function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const { signOut } = await import('@/lib/auth')
    await signOut()
    router.push('/login')
  }

  return (
    <button
      onClick={handleSignOut}
      className="w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors text-left"
    >
      Sign out
    </button>
  )
}
