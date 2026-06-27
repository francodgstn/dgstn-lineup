'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { MobileHeader } from '@/components/layout/MobileHeader'
import { AnnouncementBar } from '@/components/layout/AnnouncementBar'
import { UserMenu } from '@/components/layout/UserMenu'
import {
  LayoutDashboard,
  Users,
  Calendar,
  ClipboardList,
  Trophy,
  Globe,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Lock,
  Puzzle,
  Building2,
  Gift,
  GraduationCap,
  FolderTree,
  SlidersHorizontal,
  X,
  Workflow,
  Zap,
  Tag,
  Package,
  IdCard,
  LayoutTemplate,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Route } from 'next'
import type { SaasPlan } from '@linyup/shared'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal, UpgradeModalProvider } from '@/contexts/UpgradeModalContext'
import { SettingsPinsProvider, useSettingsPins } from '@/contexts/SettingsPinsContext'
import { SETTINGS_ITEMS } from '@/lib/settings-nav'
import { useOrgLinks } from '@/hooks/useOrgLinks'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useHasByoGateway } from '@/hooks/useConnect'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Logo } from '@/components/Logo'
import { ProductTour } from '@/components/onboarding/ProductTour'
import { FreeDowngradeBanner } from '@/components/onboarding/FreeDowngradeBanner'

// Icons referenced by string name in plugin manifest navContributions
const PLUGIN_NAV_ICONS: Record<string, LucideIcon> = {
  GraduationCap,
  Gift,
  Puzzle,
  Trophy,
  FolderTree,
  Globe,
}

// ─── nav config ───────────────────────────────────────────────────────────────

type NavItem = {
  href: string
  labelKey: string
  icon: React.ElementType
  minPlan?: SaasPlan
  requiresOrg?: boolean
  // Only shown when the team has the Stripe Connect feature flag enabled.
  requiresConnect?: boolean
  // Only shown when the named plugin is installed (e.g. online-courses, products).
  requiresPlugin?: string
  // Hidden entirely unless the team's plan is at least this tier. Distinct from
  // minPlan, which keeps the item visible but locked with an upgrade prompt.
  requiresPlan?: SaasPlan
  // Active only on an exact path match (not prefix) — for hub routes like
  // /plugins whose children (/plugins/website, …) have their own nav items.
  exact?: boolean
}

type NavSection = { labelKey: string; items: NavItem[] }

const DASHBOARD_ITEM: NavItem = { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard }

// Two action-oriented sidebar sections for high-frequency destinations. All
// lower-frequency configuration lives behind the Settings group (pinned shortcuts
// + the /settings hub) — see SettingsNavGroup + src/lib/settings-nav.ts.
const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'sectionRun',
    items: [
      { href: '/schedule', labelKey: 'calendar', icon: Calendar },
      { href: '/bookings', labelKey: 'bookings', icon: ClipboardList },
      { href: '/contacts', labelKey: 'contacts', icon: Users },
      { href: '/payments', labelKey: 'payments', icon: Wallet, requiresConnect: true },
      // Automations is operational (workflows acting on contacts/bookings), so it
      // lives in Run rather than Grow.
      { href: '/automations', labelKey: 'automations', icon: Workflow },
    ],
  },
  {
    // What the studio sells — pulled out of Settings into its own section. Courses
    // and products only appear once their plugin is installed (requiresPlugin).
    labelKey: 'sectionOffer',
    items: [
      { href: '/offer/activities', labelKey: 'activities', icon: Zap },
      { href: '/offer/subscriptions', labelKey: 'subscriptions', icon: Tag },
      {
        href: '/offer/online-courses',
        labelKey: 'onlineCourses',
        icon: GraduationCap,
        requiresPlugin: 'online-courses',
      },
      { href: '/offer/products', labelKey: 'products', icon: Package, requiresPlugin: 'products' },
      // Affiliations (club membership / federation licence). Studio tier and up.
      { href: '/offer/affiliations', labelKey: 'affiliations', icon: IdCard, requiresPlan: 'studio' },
    ],
  },
  {
    labelKey: 'sectionGrow',
    items: [
      // Orientation hub for everything customer-facing; bio-link stays as its own
      // deep editor (the hub links into it).
      { href: '/public-page', labelKey: 'publicPage', icon: LayoutTemplate },
      { href: '/team/bio-link', labelKey: 'bioLink', icon: Globe },
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
  const label = t(item.labelKey as Parameters<typeof t>[0])

  const isLocked = !!item.minPlan && !isAtLeast(item.minPlan)

  const isActive =
    !isLocked &&
    (item.href === '/dashboard' || item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href))

  if (isLocked) {
    return (
      <button
        type="button"
        data-tour={`nav-${item.labelKey}`}
        onClick={() => {
          openUpgradeModal({ minPlan: item.minPlan })
          onClick?.()
        }}
        title={collapsed ? label : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-accent/50 transition-all ${
          collapsed ? 'justify-center px-2' : ''
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{label}</span>
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
      data-tour={`nav-${item.labelKey}`}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        isActive
          ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      } ${collapsed ? 'justify-center px-2' : ''}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}

// ─── sidebar content ──────────────────────────────────────────────────────────

function OrgLinks({ collapsed, onLinkClick }: { collapsed: boolean; onLinkClick?: () => void }) {
  const pathname = usePathname()
  const { data: orgs } = useOrgLinks()
  if (!orgs || orgs.length === 0) return null

  return (
    <div className="mt-3">
      {collapsed ? (
        <div className="border-t mx-1 mb-1" />
      ) : (
        <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 pb-1">
          Organizations
        </p>
      )}
      <div className="space-y-0.5">
        {orgs.map((org) => {
          const href = `/org/${org.id}/teams`
          const isActive = pathname.includes(`/org/${org.id}`)
          return (
            <Link
              key={org.id}
              href={href as Route}
              onClick={onLinkClick}
              title={collapsed ? org.name : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
                  : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
              } ${collapsed ? 'justify-center px-2' : ''}`}
            >
              <Building2 className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
              {!collapsed && <span className="truncate">{org.name}</span>}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// A plugin nav entry. Installed plugins render as real links; recommended-but-
// not-installed ones render muted with an install tooltip (discovery nudge).
type PluginNavEntry = {
  href: string
  labelKey: string
  icon: string
  pluginId: string
  category: string
  installed: boolean
  section?: string
}

// Maps PluginNavContribution.section values to built-in NAV_SECTIONS labelKeys.
// 'configure'/'team' no longer have a sidebar section — those plugin entries fall
// through to the bottom "Plugins" group (unsectioned). Feature-surface plugins
// (engagement category → 'engage') render under Grow.
const PLUGIN_SECTION_TO_LABEL_KEY: Record<string, string> = {
  operations: 'sectionRun',
  engage: 'sectionGrow',
}

// Suggestion (muted nudge) dismissals, persisted in the browser only. Affects
// ONLY the discovery suggestions — an installed plugin always renders its real
// nav item regardless of this list.
const HIDDEN_SUGGESTIONS_KEY = 'linyup_hidden_plugin_suggestions'

function useHiddenSuggestions() {
  const [hidden, setHidden] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_SUGGESTIONS_KEY)
      if (raw) setHidden(JSON.parse(raw) as string[])
    } catch {
      /* ignore malformed storage */
    }
  }, [])
  const dismiss = (id: string) => {
    setHidden((prev) => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      try {
        localStorage.setItem(HIDDEN_SUGGESTIONS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  return { hidden, dismiss }
}

// Per-section collapse state for the sidebar nav, persisted in the browser.
const NAV_COLLAPSED_KEY = 'linyup_nav_collapsed_sections'

function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_COLLAPSED_KEY)
      if (raw) setCollapsed(JSON.parse(raw) as string[])
    } catch {
      /* ignore malformed storage */
    }
  }, [])
  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  return { collapsed, toggle }
}

/** All plugin nav entries: installed (real links) + recommended-not-installed
 *  (muted discovery nudges, minus any the user has hidden), plus a `dismiss` to
 *  hide a suggestion. Installed sort before muted. */
function usePluginNavEntries(): { entries: PluginNavEntry[]; dismiss: (id: string) => void } {
  const { plugins, isInstalled, isLoading } = useInstalledPlugins()
  const { hidden, dismiss } = useHiddenSuggestions()

  // Engagement-category plugins default into the "Engage" section unless the
  // manifest pins an explicit section.
  const installed: PluginNavEntry[] = plugins.flatMap((p) =>
    (p.manifest.navContributions ?? []).map((nav) => ({
      ...nav,
      section: nav.section ?? (p.manifest.category === 'engagement' ? 'engage' : undefined),
      pluginId: p.manifest.id,
      category: p.manifest.category,
      installed: true,
    }))
  )

  const discovery: PluginNavEntry[] = isLoading
    ? []
    : PLUGIN_REGISTRY.filter(
        (m) =>
          m.recommended &&
          (m.navContributions?.length ?? 0) > 0 &&
          !isInstalled(m.id) &&
          !hidden.includes(m.id)
      ).flatMap((m) =>
        (m.navContributions ?? []).map((nav) => ({
          ...nav,
          section: nav.section ?? (m.category === 'engagement' ? 'engage' : undefined),
          pluginId: m.id,
          category: m.category,
          installed: false,
        }))
      )

  return { entries: [...installed, ...discovery], dismiss }
}

function PluginNavItem({
  nav,
  collapsed,
  onLinkClick,
  onDismiss,
}: {
  nav: PluginNavEntry
  collapsed: boolean
  onLinkClick?: () => void
  onDismiss?: (id: string) => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('Plugins')
  const Icon = PLUGIN_NAV_ICONS[nav.icon] ?? Puzzle
  const linkLabel = t(nav.labelKey as Parameters<typeof t>[0])

  // Recommended but not installed → muted discovery item. Clicking opens the
  // plugin's detail modal on the marketplace (deep-linked via ?plugin=). Hover
  // reveals a × to hide the suggestion (browser-only).
  if (!nav.installed) {
    return (
      <div className="group/suggestion relative">
        <TooltipProvider delay={300}>
          <Tooltip>
            <TooltipTrigger
              onClick={() => {
                router.push(`/settings/plugins?plugin=${nav.pluginId}` as Route)
                onLinkClick?.()
              }}
              title={collapsed ? linkLabel : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-accent/50 transition-all ${collapsed ? 'justify-center px-2' : 'pr-8'}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{linkLabel}</span>}
            </TooltipTrigger>
            <TooltipContent side="right">{t('discoverTooltip')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {!collapsed && onDismiss && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss(nav.pluginId)
            }}
            title={t('hideSuggestion')}
            aria-label={t('hideSuggestion')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/suggestion:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  const isActive = pathname.startsWith(nav.href)
  return (
    <Link
      href={nav.href as Route}
      onClick={onLinkClick}
      title={collapsed ? linkLabel : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        isActive
          ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      } ${collapsed ? 'justify-center px-2' : ''}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
      {!collapsed && <span>{linkLabel}</span>}
    </Link>
  )
}

function PluginNavGroup({
  label,
  entries,
  collapsed,
  onLinkClick,
  onDismiss,
}: {
  label: string
  entries: PluginNavEntry[]
  collapsed: boolean
  onLinkClick?: () => void
  onDismiss?: (id: string) => void
}) {
  if (entries.length === 0) return null

  return (
    <div className="mt-3">
      {collapsed ? (
        <div className="border-t mx-1 mb-1" />
      ) : (
        <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 pb-1">
          {label}
        </p>
      )}
      <div className="space-y-0.5">
        {entries.map((nav) => (
          <PluginNavItem
            key={nav.pluginId + nav.href}
            nav={nav}
            collapsed={collapsed}
            onLinkClick={onLinkClick}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  )
}

// Fallback group for plugin nav links that don't target a built-in sidebar
// section. Engagement plugins now render in the built-in "Engage" section (see
// usePluginNavEntries / SidebarContent), so they're excluded here.
function PluginNavLinks({
  entries,
  collapsed,
  onLinkClick,
  onDismiss,
}: {
  entries: PluginNavEntry[]
  collapsed: boolean
  onLinkClick?: () => void
  onDismiss?: (id: string) => void
}) {
  const t = useTranslations('Plugins')
  if (entries.length === 0) return null

  return (
    <PluginNavGroup
      label={t('navSectionPlugins')}
      entries={entries}
      collapsed={collapsed}
      onLinkClick={onLinkClick}
      onDismiss={onDismiss}
    />
  )
}

// Settings group: the user's pinned shortcuts + a lightweight gateway to the full
// /settings hub. Pins are per-browser (SettingsPinsContext); defaults cover the
// items that matter most while setting up (activities, subscriptions, plugins).
function SettingsNavGroup({
  collapsed,
  onLinkClick,
  sectionCollapsed,
  onToggleSection,
}: {
  collapsed: boolean
  onLinkClick?: () => void
  sectionCollapsed: boolean
  onToggleSection: () => void
}) {
  const t = useTranslations('Nav')
  const { isPinned } = useSettingsPins()
  const pinned = SETTINGS_ITEMS.filter((i) => isPinned(i.id))

  return (
    <div className="mt-3">
      {collapsed ? (
        <div className="border-t mx-1 mb-1" />
      ) : (
        <button
          type="button"
          onClick={onToggleSection}
          className="flex w-full items-center justify-between rounded px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          <span>{t('sectionSettings')}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform ${sectionCollapsed ? '-rotate-90' : ''}`}
          />
        </button>
      )}
      {!sectionCollapsed && (
        <div className="space-y-0.5">
          {/* All settings — the gateway to the full hub: first, and a normal nav row
              (not a muted footnote) so it reads as the primary entry point. */}
          <NavLink
            item={{ href: '/settings', labelKey: 'allSettings', icon: SlidersHorizontal, exact: true }}
            collapsed={collapsed}
            onClick={onLinkClick}
          />
          {pinned.map((item) => (
            <NavLink
              key={item.id}
              item={{ href: item.href, labelKey: item.labelKey, icon: item.icon, exact: item.exact }}
              collapsed={collapsed}
              onClick={onLinkClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

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
  const { team, currentTeamId } = useAuth()
  const { isInstalled } = useInstalledPlugins()
  const { isAtLeast } = usePlan()
  const inOrg = !!team?.org_id
  // Show the Payments dashboard once a team has started Connect onboarding (an
  // account exists, not operator-disabled) OR has any BYO gateway configured —
  // both rails record into the unified payments view.
  const { data: hasByoGateway = false } = useHasByoGateway(currentTeamId ?? null)
  const connectOn =
    (!!team?.payments?.connectAccountId && team?.payments?.connectEnabled !== false) ||
    hasByoGateway

  // Plugin nav entries: those targeting a built-in section render inside it;
  // the rest fall back to the default "Plugins" group below.
  const { entries: pluginEntries, dismiss: dismissSuggestion } = usePluginNavEntries()
  const sectionedEntries = pluginEntries.filter(
    (e) => e.section && PLUGIN_SECTION_TO_LABEL_KEY[e.section]
  )
  const unsectionedEntries = pluginEntries.filter(
    (e) => !(e.section && PLUGIN_SECTION_TO_LABEL_KEY[e.section])
  )
  const { collapsed: collapsedSections, toggle: toggleSection } = useCollapsedSections()

  return (
    <div className="flex flex-col h-full">
      {/* Logo + collapse toggle */}
      <div
        className={`flex items-center border-b h-14 shrink-0 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}
      >
        {!collapsed && (
          <Link href={'/dashboard' as Route} className="hover:opacity-80 transition-opacity">
            <Logo size={22} />
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
        {/* Dashboard — standalone, no section header */}
        <div className="mb-1 space-y-0.5">
          <NavLink item={DASHBOARD_ITEM} collapsed={collapsed} onClick={onLinkClick} />
        </div>
        {NAV_SECTIONS.map((section) => {
          // Section collapse only applies in the expanded sidebar; icon-only
          // mode always shows items (under hairline dividers).
          const secCollapsed = !collapsed && collapsedSections.includes(section.labelKey)
          return (
            <div key={section.labelKey} className="mt-3">
              {collapsed ? (
                <div className="border-t mx-1 mb-1" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleSection(section.labelKey)}
                  className="flex w-full items-center justify-between rounded px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                >
                  <span>{t(section.labelKey as Parameters<typeof t>[0])}</span>
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 transition-transform ${secCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              )}
              {!secCollapsed && (
                <div className="space-y-0.5">
                  {section.items
                    .filter(
                      (item) =>
                        (!item.requiresOrg || inOrg) &&
                        (!item.requiresConnect || connectOn) &&
                        (!item.requiresPlugin || isInstalled(item.requiresPlugin)) &&
                        (!item.requiresPlan || isAtLeast(item.requiresPlan)),
                    )
                    .map((item) => (
                      <NavLink
                        key={item.href}
                        item={item}
                        collapsed={collapsed}
                        onClick={onLinkClick}
                      />
                    ))}
                  {sectionedEntries
                    .filter((e) => PLUGIN_SECTION_TO_LABEL_KEY[e.section!] === section.labelKey)
                    .map((nav) => (
                      <PluginNavItem
                        key={nav.pluginId + nav.href}
                        nav={nav}
                        collapsed={collapsed}
                        onLinkClick={onLinkClick}
                        onDismiss={dismissSuggestion}
                      />
                    ))}
                </div>
              )}
            </div>
          )
        })}
        <PluginNavLinks
          entries={unsectionedEntries}
          collapsed={collapsed}
          onLinkClick={onLinkClick}
          onDismiss={dismissSuggestion}
        />
        <SettingsNavGroup
          collapsed={collapsed}
          onLinkClick={onLinkClick}
          sectionCollapsed={!collapsed && collapsedSections.includes('sectionSettings')}
          onToggleSection={() => toggleSection('sectionSettings')}
        />
        <OrgLinks collapsed={collapsed} onLinkClick={onLinkClick} />
      </nav>

      {/* User account + QR at bottom */}
      <div className="border-t py-2 px-2 shrink-0">
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  )
}

// ─── layout ───────────────────────────────────────────────────────────────────

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('Nav')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Settings detail pages now live under the /settings/* shell, which owns its rail
  // (desktop) + back-link (mobile). Only standalone settings items that stay outside
  // that shell (e.g. /plugins) still get the hub back-link injected here.
  const onSettingsPage =
    !pathname.startsWith('/settings') && SETTINGS_ITEMS.some((i) => i.href === pathname)

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
    <SettingsPinsProvider>
      <UpgradeModalProvider>
        <ProductTour />
      <div className="flex bg-background">
        {/* Desktop sidebar — fixed to viewport height, nav scrolls internally */}
        <aside
          className={`hidden md:flex flex-col border-r bg-sidebar shrink-0 sticky top-0 h-screen transition-[width] duration-200 ${
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

        {/* Main column: mobile header + scrollable content (no top bar on desktop) */}
        <div className="flex flex-col flex-1 min-w-0 min-h-screen">
          <AnnouncementBar />
          <MobileHeader onMobileMenu={() => setMobileOpen(true)} />
          <main className="flex-1">
            <div className="max-w-5xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">
              <FreeDowngradeBanner />
              {onSettingsPage && (
                <Link
                  href={'/settings' as Route}
                  className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('settingsHubTitle')}
                </Link>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
      </UpgradeModalProvider>
    </SettingsPinsProvider>
  )
}
