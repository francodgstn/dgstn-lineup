'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Zap,
  CalendarRange,
  ClipboardList,
  GraduationCap,
  Trophy,
  UserCog,
  Globe,
  Settings,
  LogOut,
  Menu,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import type { Route } from 'next'

// ─── nav config ───────────────────────────────────────────────────────────────

type NavItem = { href: string; labelKey: string; icon: React.ElementType }

const MAIN_NAV: NavItem[] = [
  { href: '/dashboard',    labelKey: 'dashboard',    icon: LayoutDashboard },
  { href: '/contacts',     labelKey: 'contacts',     icon: Users },
  { href: '/sessions',     labelKey: 'sessions',     icon: CalendarDays },
  { href: '/activities',   labelKey: 'activities',   icon: Zap },
  { href: '/events',       labelKey: 'events',       icon: CalendarRange },
  { href: '/bookings',     labelKey: 'bookings',     icon: ClipboardList },
  { href: '/coaching',     labelKey: 'coaching',     icon: GraduationCap },
  { href: '/gamification', labelKey: 'gamification', icon: Trophy },
]

const TEAM_NAV: NavItem[] = [
  { href: '/team/members',  labelKey: 'members',  icon: UserCog },
  { href: '/team/portal',   labelKey: 'portal',   icon: Globe },
  { href: '/team/settings', labelKey: 'settings', icon: Settings },
]

// ─── nav item ─────────────────────────────────────────────────────────────────

function NavLink({
  item,
  collapsed,
  onClick,
}: {
  item: NavItem
  collapsed: boolean
  onClick?: () => void
}) {
  const pathname = usePathname()
  const t = useTranslations('Nav')
  const Icon = item.icon

  const isActive =
    item.href === '/dashboard'
      ? pathname === item.href
      : pathname.startsWith(item.href)

  return (
    <Link
      href={item.href as Route}
      onClick={onClick}
      title={collapsed ? t(item.labelKey as Parameters<typeof t>[0]) : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      } ${collapsed ? 'justify-center px-2' : ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{t(item.labelKey as Parameters<typeof t>[0])}</span>}
    </Link>
  )
}

// ─── sidebar content ──────────────────────────────────────────────────────────

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onLinkClick,
}: {
  collapsed: boolean
  onToggleCollapse?: () => void
  onLinkClick?: () => void
}) {
  const t = useTranslations('Nav')
  const router = useRouter()

  async function handleSignOut() {
    const { signOut } = await import('@/lib/auth')
    await signOut()
    router.push('/login')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo + collapse toggle */}
      <div className={`flex items-center border-b h-14 shrink-0 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        {!collapsed && <span className="text-lg font-bold tracking-tight">Lineup</span>}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {!collapsed && (
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">
            {t('sectionMain')}
          </p>
        )}
        {MAIN_NAV.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onClick={onLinkClick} />
        ))}

        <div className={`${collapsed ? 'my-2 border-t mx-1' : 'pt-4'}`} />

        {!collapsed && (
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">
            {t('sectionTeam')}
          </p>
        )}
        {TEAM_NAV.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onClick={onLinkClick} />
        ))}
      </nav>

      {/* Sign out */}
      <div className={`border-t py-2 px-2 shrink-0`}>
        <button
          onClick={handleSignOut}
          title={collapsed ? t('signOut') : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${
            collapsed ? 'justify-center px-2' : ''
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{t('signOut')}</span>}
        </button>
      </div>
    </div>
  )
}

// ─── layout ───────────────────────────────────────────────────────────────────

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed')
    if (stored === 'true') setCollapsed(true)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

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

  const handleToggleCollapse = () => {
    setCollapsed((v) => {
      localStorage.setItem('sidebar-collapsed', String(!v))
      return !v
    })
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r bg-card shrink-0 transition-[width] duration-200 ${
          collapsed ? 'w-14' : 'w-60'
        }`}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={handleToggleCollapse} />
      </aside>

      {/* Mobile: top bar + sheet drawer */}
      <div className="flex flex-col flex-1 min-w-0">
        <header className="md:hidden flex items-center gap-3 h-14 px-4 border-b bg-card shrink-0">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64">
              <SidebarContent
                collapsed={false}
                onLinkClick={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <span className="text-lg font-bold tracking-tight">Lineup</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
