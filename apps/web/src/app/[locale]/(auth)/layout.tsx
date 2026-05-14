'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { TopBar } from '@/components/layout/TopBar'
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
  CreditCard,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Lock,
} from 'lucide-react'
import type { Route } from 'next'
import type { SaasPlan } from '@lineup/shared'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal, UpgradeModalProvider } from '@/contexts/UpgradeModalContext'

// ─── nav config ───────────────────────────────────────────────────────────────

type NavItem = { href: string; labelKey: string; icon: React.ElementType; minPlan?: SaasPlan }

type NavSection = { labelKey: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'sectionSchedule',
    items: [
      { href: '/sessions',  labelKey: 'sessions',  icon: CalendarDays },
      { href: '/bookings',  labelKey: 'bookings',  icon: ClipboardList },
      { href: '/events',    labelKey: 'events',    icon: CalendarRange, minPlan: 'club' },
      { href: '/coaching',  labelKey: 'coaching',  icon: GraduationCap, minPlan: 'coach' },
    ],
  },
  {
    labelKey: 'sectionPeople',
    items: [
      { href: '/contacts', labelKey: 'contacts', icon: Users },
    ],
  },
  {
    labelKey: 'sectionEngage',
    items: [
      { href: '/gamification', labelKey: 'gamification', icon: Trophy, minPlan: 'club' },
    ],
  },
  {
    labelKey: 'sectionConfigure',
    items: [
      { href: '/activities',    labelKey: 'activities', icon: Zap },
      { href: '/team/portal',   labelKey: 'portal',     icon: Globe },
    ],
  },
  {
    labelKey: 'sectionTeam',
    items: [
      { href: '/team/managers', labelKey: 'managers', icon: UserCog },
      { href: '/team/settings', labelKey: 'settings', icon: Settings },
      { href: '/billing',       labelKey: 'billing',  icon: CreditCard },
    ],
  },
]

// ─── nav link ─────────────────────────────────────────────────────────────────

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
  const { isAtLeast } = usePlan()
  const { openUpgradeModal } = useUpgradeModal()
  const Icon = item.icon

  const isLocked = !!item.minPlan && !isAtLeast(item.minPlan)

  const isActive =
    !isLocked &&
    (item.href === '/dashboard'
      ? pathname === item.href
      : pathname.startsWith(item.href))

  if (isLocked) {
    return (
      <button
        type="button"
        onClick={() => { openUpgradeModal({ minPlan: item.minPlan }); onClick?.() }}
        title={collapsed ? t(item.labelKey as Parameters<typeof t>[0]) : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-accent/50 transition-all ${
          collapsed ? 'justify-center px-2' : ''
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{t(item.labelKey as Parameters<typeof t>[0])}</span>
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground/30" />
          </>
        )}
      </button>
    )
  }

  return (
    <Link
      href={item.href as Route}
      onClick={onClick}
      title={collapsed ? t(item.labelKey as Parameters<typeof t>[0]) : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        isActive
          ? 'bg-primary/10 text-primary font-semibold'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      } ${collapsed ? 'justify-center px-2' : ''}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
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
        {!collapsed && (
          <Link href={'/dashboard' as Route} className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity">
            Lineup
          </Link>
        )}
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
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {/* Dashboard — standalone above sections */}
        <NavLink
          item={{ href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard }}
          collapsed={collapsed}
          onClick={onLinkClick}
        />

        {NAV_SECTIONS.map((section) => (
          <div key={section.labelKey} className="mt-3">
            {collapsed ? (
              <div className="border-t mx-1 mb-1" />
            ) : (
              <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 pb-1">
                {t(section.labelKey as Parameters<typeof t>[0])}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} collapsed={collapsed} onClick={onLinkClick} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Sign out at bottom */}
      <div className="border-t py-2 px-2 shrink-0">
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
    <UpgradeModalProvider>
      <div className="flex min-h-screen bg-background">
        {/* Desktop sidebar */}
        <aside
          className={`hidden md:flex flex-col border-r bg-sidebar shrink-0 transition-[width] duration-200 ${
            collapsed ? 'w-14' : 'w-60'
          }`}
        >
          <SidebarContent collapsed={collapsed} onToggleCollapse={handleToggleCollapse} />
        </aside>

        {/* Mobile sheet drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0 w-64">
            <SidebarContent collapsed={false} onLinkClick={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main column: topbar always visible + content */}
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar onMobileMenu={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </UpgradeModalProvider>
  )
}
