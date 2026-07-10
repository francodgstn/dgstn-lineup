'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations, useMessages } from 'next-intl'
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
  Package,
  IdCard,
  FileText,
  ShoppingBag,
  DoorOpen,
  UserCog,
  Pin,
  Activity,
  Tag,
  TrendingUp,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Route } from 'next'
import { planSupportsAffiliations, type SaasPlan } from '@linyup/shared'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal, UpgradeModalProvider } from '@/contexts/UpgradeModalContext'
import { NavPinsProvider, useNavPins } from '@/contexts/NavPinsContext'
import { SETTINGS_ITEMS, type SettingsNavItem } from '@/lib/settings-nav'
import { useOrgLinks } from '@/hooks/useOrgLinks'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useHasByoGateway } from '@/hooks/useConnect'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/Logo'
import { ProductTour } from '@/components/onboarding/ProductTour'
import { FreeDowngradeBanner } from '@/components/onboarding/FreeDowngradeBanner'
import AssistantLauncher from '@/plugins/ai-assistant/AssistantPanel'

// Icons referenced by string name in plugin manifest navContributions
const PLUGIN_NAV_ICONS: Record<string, LucideIcon> = {
  GraduationCap,
  Gift,
  Puzzle,
  Trophy,
  FolderTree,
  Globe,
  FileText,
  ClipboardList,
}

// ─── nav config ───────────────────────────────────────────────────────────────

type NavItem = {
  // Stable id used for pinning (distinct from href, which can carry query params).
  id: string
  href: string
  labelKey: string
  icon: React.ElementType
  minPlan?: SaasPlan
  requiresOrg?: boolean
  // Only shown when the team has the Stripe Connect feature flag enabled.
  requiresConnect?: boolean
  // Only shown when the team has any sellable channel (products/online-courses
  // plugin, or Stripe Connect) — i.e. a public shop makes sense.
  requiresShop?: boolean
  // Only shown when the named plugin is installed (e.g. online-courses, products).
  requiresPlugin?: string
  // Hidden entirely unless the team's plan is at least this tier. Distinct from
  // minPlan, which keeps the item visible but locked with an upgrade prompt.
  requiresPlan?: SaasPlan
  // Active only on an exact path match (not prefix) — for hub routes like
  // /plugins whose children (/plugins/website, …) have their own nav items.
  exact?: boolean
}

type NavSection = { labelKey: string; icon: React.ElementType; items: NavItem[] }

const DASHBOARD_ITEM: NavItem = {
  id: 'dashboard',
  href: '/dashboard',
  labelKey: 'dashboard',
  icon: LayoutDashboard,
}
const ALL_SETTINGS_ITEM: NavItem = {
  id: 'allSettings',
  href: '/settings',
  labelKey: 'allSettings',
  icon: SlidersHorizontal,
  exact: true,
}

// Action-oriented sidebar sections for high-frequency destinations. Lower-frequency
// configuration lives behind "All settings" (the /settings hub) + whatever the user
// pins to the Pinned block — see src/lib/settings-nav.ts.
const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'sectionRun',
    icon: Activity,
    items: [
      { id: 'calendar', href: '/schedule', labelKey: 'calendar', icon: Calendar },
      { id: 'bookings', href: '/bookings', labelKey: 'bookings', icon: ClipboardList },
      { id: 'contacts', href: '/contacts', labelKey: 'contacts', icon: Users },
      // Coaches (team staff) — studio/org only; the coach plan is single-person.
      {
        id: 'coaches',
        href: '/coaches',
        labelKey: 'coaches',
        icon: UserCog,
        requiresPlan: 'studio',
      },
      // Core manager surface: cash/manual payments work with no gateway at all,
      // so Payments is always available (record + assign + Connect/BYO management).
      { id: 'payments', href: '/payments', labelKey: 'payments', icon: Wallet },
      // Automations is operational (workflows acting on contacts/bookings), so it
      // lives in Run rather than Grow.
      { id: 'automations', href: '/automations', labelKey: 'automations', icon: Workflow },
    ],
  },
  {
    // What the studio sells — pulled out of Settings into its own section. Courses
    // and products only appear once their plugin is installed (requiresPlugin).
    labelKey: 'sectionOffer',
    icon: Tag,
    items: [
      { id: 'activities', href: '/offer/activities', labelKey: 'activities', icon: Zap },
      // "Plans & affiliations" is an umbrella grouping Subscriptions + Affiliations as tabs.
      // Subscriptions is on every plan, so the item is always shown; the Affiliations
      // tab self-gates to Studio+ with an upsell.
      { id: 'plans', href: '/offer/plans', labelKey: 'plans', icon: IdCard },
      {
        id: 'onlineCourses',
        href: '/offer/online-courses',
        labelKey: 'onlineCourses',
        icon: GraduationCap,
        requiresPlugin: 'online-courses',
      },
      {
        id: 'products',
        href: '/offer/products',
        labelKey: 'products',
        icon: Package,
        requiresPlugin: 'products',
      },
      {
        id: 'documents',
        href: '/plugins/documents',
        labelKey: 'documents',
        icon: FileText,
        requiresPlugin: 'documents',
      },
      // The public storefront that aggregates subscriptions, products and courses.
      // Managed at its /public-page/shop detail page; shown once a sellable channel
      // exists. Also surfaced on the Public pages hub (as a public URL + status).
      {
        id: 'shop',
        href: '/public-page/shop',
        labelKey: 'shop',
        icon: ShoppingBag,
        requiresShop: true,
      },
    ],
  },
  {
    // Audience + engagement surfaces. Bio-link is the acquisition funnel; Space is
    // the members' area where contacts stay engaged (needs the online-courses
    // plugin); Website + Forms + Gamification join as engagement plugins
    // (section: 'engage'). The public-surface overview hub now lives under Settings
    // ("Public pages"), so individual surfaces live in their natural sections.
    labelKey: 'sectionGrow',
    icon: TrendingUp,
    items: [
      { id: 'bioLink', href: '/team/bio-link', labelKey: 'bioLink', icon: Globe },
      // Space is the contacts' personal portal (membership, bookings, profile, their
      // courses) — a base surface, not tied to the online-courses plugin.
      { id: 'space', href: '/public-page/space', labelKey: 'space', icon: DoorOpen },
    ],
  },
]

// ─── nav link ─────────────────────────────────────────────────────────────────

// Small hover-reveal pin control on the right of a pinnable nav row (needs a
// `group` ancestor). Clicking pins/unpins without navigating. Unpinning is
// managed from the Shortcuts group only: menu rows and search results use
// `pinOnly`, which hides the button once the item is pinned instead of offering
// an unpin toggle there.
function PinButton({ id, pinOnly }: { id: string; pinOnly?: boolean }) {
  const t = useTranslations('Nav')
  const { isPinned, togglePin } = useNavPins()
  const pinned = isPinned(id)
  if (pinOnly && pinned) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        togglePin(id)
      }}
      title={pinned ? t('unpinFromSidebar') : t('pinToSidebar')}
      aria-pressed={pinned}
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 transition-all ${
        pinned
          ? 'text-primary opacity-100'
          : 'text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
      }`}
    >
      <Pin className={`h-3.5 w-3.5 ${pinned ? 'fill-current' : ''}`} />
    </button>
  )
}

function NavLink({
  item,
  collapsed,
  onClick,
  pinId,
}: {
  item: NavItem
  collapsed: boolean
  onClick?: () => void
  // When set (and the sidebar is expanded), a hover pin toggle is shown that
  // pins/unpins this destination under Dashboard.
  pinId?: string
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

  const link = (
    <Link
      href={item.href as Route}
      onClick={onClick}
      data-tour={`nav-${item.labelKey}`}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        isActive
          ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      } ${collapsed ? 'justify-center px-2' : ''} ${pinId && !collapsed ? 'pr-8' : ''}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
      {!collapsed && <span>{label}</span>}
    </Link>
  )

  if (pinId && !collapsed) {
    return (
      <div className="group relative">
        {link}
        <PinButton id={pinId} pinOnly />
      </div>
    )
  }
  return link
}

// ─── flyout submenu ───────────────────────────────────────────────────────────

// Hover-triggered submenu used when a section is collapsed (either the whole
// sidebar is in icon mode, or a single section's chevron is collapsed). The panel
// is portalled to <body> and fixed-positioned next to the trigger so it escapes
// the sidebar's scroll clipping — a pure-CSS group-hover panel would be clipped by
// the nav's overflow. Mouse-first (keyboard/focus flyout support can follow).
function NavFlyout({
  label,
  trigger,
  children,
}: {
  label?: string
  trigger: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    const el = wrapRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setCoords({ top: r.top, left: r.right + 4 })
    }
    setOpen(true)
  }
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 90)
  }

  return (
    <div ref={wrapRef} onMouseEnter={show} onMouseLeave={hide} className="relative">
      {trigger}
      {open &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{ position: 'fixed', top: coords.top, left: coords.left }}
            onMouseEnter={show}
            onMouseLeave={hide}
            className="z-50 min-w-52 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-md"
          >
            {label && (
              <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {label}
              </p>
            )}
            <div className="space-y-0.5">{children}</div>
          </div>,
          document.body
        )}
    </div>
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
// 'configure'/'team' have no dedicated sidebar section — those plugin entries
// fall through to the bottom "Plugins" group (unsectioned). Engagement-surface
// plugins (Forms, Gamification → 'engage') render under Grow.
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
  const pinId = `plugin:${nav.pluginId}:${nav.href}`
  const link = (
    <Link
      href={nav.href as Route}
      onClick={onLinkClick}
      title={collapsed ? linkLabel : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        isActive
          ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      } ${collapsed ? 'justify-center px-2' : 'pr-8'}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
      {!collapsed && <span>{linkLabel}</span>}
    </Link>
  )
  if (collapsed) return link
  return (
    <div className="group relative">
      {link}
      <PinButton id={pinId} pinOnly />
    </div>
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

// A destination resolved against what's currently visible — used by Shortcuts and
// search (label pre-translated because entries come from more than one i18n
// namespace: main nav + settings are in `Nav`, plugin items in `Plugins`).
type ResolvedNavEntry = {
  id: string
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
}

// Native HTML5 drag-and-drop wiring passed down from ShortcutsNav (expanded
// sidebar only — no drag in the icon rail or on touch).
type ShortcutDragProps = {
  draggable: boolean
  onDragStart: React.DragEventHandler<HTMLDivElement>
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDrop: React.DragEventHandler<HTMLDivElement>
  onDragEnd: React.DragEventHandler<HTMLDivElement>
}

function ShortcutRow({
  entry,
  collapsed,
  onClick,
  dragging,
  dragProps,
}: {
  entry: ResolvedNavEntry
  collapsed: boolean
  onClick?: () => void
  // True while this row is the one being dragged (dims it).
  dragging?: boolean
  dragProps?: ShortcutDragProps
}) {
  const t = useTranslations('Nav')
  const pathname = usePathname()
  const { removeShortcut } = useNavPins()
  const path = entry.href.split('?')[0]
  const isActive = entry.exact ? pathname === path : pathname.startsWith(path)
  const Icon = entry.icon
  const link = (
    <Link
      href={entry.href as Route}
      onClick={onClick}
      draggable={false}
      title={collapsed ? entry.label : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        isActive
          ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      } ${collapsed ? 'justify-center px-2' : 'pr-14'}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
      {!collapsed && <span className="truncate">{entry.label}</span>}
    </Link>
  )
  if (collapsed) return link
  return (
    <div className={`group relative ${dragging ? 'opacity-40' : ''}`} {...dragProps}>
      {link}
      {/* Remove from Shortcuts entirely — the pin only promotes/demotes
          (Firebase-style: unpinning keeps the item listed as a recent). */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          removeShortcut(entry.id)
        }}
        title={t('navRemoveShortcut')}
        aria-label={t('navRemoveShortcut')}
        className="absolute right-7 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground/40 opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <PinButton id={entry.id} />
    </div>
  )
}

// A light macro-group heading (General / Shortcuts / Features) — Firebase-style:
// small, sentence-case, low-contrast — deliberately quieter than the uppercase
// section subheaders so it reads as a background label, not a heading. Hidden in
// the icon-only sidebar, where a hairline divider separates the macro groups.
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground/50">{children}</p>
}

// How many recently-visited (unpinned) items the Shortcuts group keeps, in
// addition to the pinned ones.
const MAX_RECENT_SHORTCUTS = 5
// Rows shown before "Show more" — pinned rows are never truncated, so the
// effective cap is max(this, pinned count).
const SHORTCUTS_VISIBLE_MIN = 5

// The "Shortcuts" macro group — Firebase-style: a rolling history of the user's
// recently-opened destinations, with pinned ones promoted to the top and kept
// permanently. The pin toggle on each row promotes a recent to pinned (and back —
// unpinning keeps it listed as a recent); the X removes it from the group; drag
// a row to reorder (manual placement pins it). Items can also be pinned from the
// menu rows and the search dropdown. Hidden entirely when there's nothing to
// show. Per-browser (NavPinsContext).
function ShortcutsNav({
  entries,
  collapsed,
  onLinkClick,
}: {
  entries: ResolvedNavEntry[]
  collapsed: boolean
  onLinkClick?: () => void
}) {
  const t = useTranslations('Nav')
  const { pinnedIds, setPinOrder } = useNavPins()
  const [expanded, setExpanded] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  // Insertion index (in the displayed list) the dragged row would drop into.
  const [dropAt, setDropAt] = useState<number | null>(null)

  // Keep the group visible even when empty (expanded sidebar only) — a short
  // muted hint explains how it fills up. The icon rail just skips it.
  if (entries.length === 0) {
    if (collapsed) return null
    return (
      <div className="mt-3 border-t pt-3">
        <GroupLabel>{t('navGroupShortcuts')}</GroupLabel>
        <p className="px-3 py-1 text-xs leading-relaxed text-muted-foreground/60">
          {t('navShortcutsEmpty')}
        </p>
      </div>
    )
  }

  const pinnedCount = entries.filter((e) => pinnedIds.includes(e.id)).length
  const visibleCount = Math.max(SHORTCUTS_VISIBLE_MIN, pinnedCount)
  const shown = expanded ? entries : entries.slice(0, visibleCount)
  const hasMore = entries.length > visibleCount

  // Drop = manual curation: the dragged row becomes (or stays) pinned, and the
  // pin order becomes the displayed order filtered to pinned rows. Untouched
  // recents keep flowing chronologically below the pins.
  const commitDrop = () => {
    if (dragId != null && dropAt != null) {
      const ids = entries.map((e) => e.id)
      const from = ids.indexOf(dragId)
      if (from !== -1) {
        const next = ids.filter((id) => id !== dragId)
        next.splice(dropAt > from ? dropAt - 1 : dropAt, 0, dragId)
        const pinnedSet = new Set([...pinnedIds, dragId])
        setPinOrder(next.filter((id) => pinnedSet.has(id)))
      }
    }
    setDragId(null)
    setDropAt(null)
  }

  const dropLine = <div className="mx-2 my-0.5 h-0.5 rounded bg-primary/60" />

  return (
    <div className="mt-3 border-t pt-3">
      {!collapsed && <GroupLabel>{t('navGroupShortcuts')}</GroupLabel>}
      <div className="space-y-0.5">
        {shown.map((entry, idx) => (
          <div key={entry.id}>
            {!collapsed && dragId != null && dropAt === idx && dropLine}
            <ShortcutRow
              entry={entry}
              collapsed={collapsed}
              onClick={onLinkClick}
              dragging={dragId === entry.id}
              dragProps={
                collapsed
                  ? undefined
                  : {
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(entry.id)
                      },
                      onDragOver: (e) => {
                        if (dragId == null) return
                        e.preventDefault()
                        const rect = e.currentTarget.getBoundingClientRect()
                        setDropAt(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1)
                      },
                      onDrop: (e) => {
                        e.preventDefault()
                        commitDrop()
                      },
                      onDragEnd: () => {
                        setDragId(null)
                        setDropAt(null)
                      },
                    }
              }
            />
          </div>
        ))}
        {!collapsed && dragId != null && dropAt === shown.length && dropLine}
      </div>
      {!collapsed && hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
          <span>{expanded ? t('navShowLess') : t('navShowMore')}</span>
        </button>
      )}
    </div>
  )
}

// ─── nav search ───────────────────────────────────────────────────────────────

// Strips case + diacritics so e.g. "seances" matches "Séances".
function normalizeSearch(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// A searchable destination: the localized label plus curated keyword synonyms
// from the `Nav.searchKeywords` i18n map (what a user might type instead of the
// label — "members" for Contacts — maintained per locale).
type SearchEntry = ResolvedNavEntry & { keywords: string; pinnable: boolean }

// Sidebar quick-search (Firebase-style). Phase 1 searches nav destinations only,
// but results are already grouped so later search providers (contacts, products,
// courses… — async, Zoho-Books-style) can append their own result groups.
function NavSearch({ entries, onNavigate }: { entries: SearchEntry[]; onNavigate?: () => void }) {
  const t = useTranslations('Nav')
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = normalizeSearch(query.trim())
  const results = q
    ? entries
        .filter(
          (e) => normalizeSearch(e.label).includes(q) || normalizeSearch(e.keywords).includes(q)
        )
        .slice(0, 8)
    : []
  // Future providers append their groups here (each may resolve asynchronously).
  const groups = [{ label: t('navSearchGroupPages'), results }]
  const open = focused && q.length > 0

  // Close when clicking anywhere outside the search box + dropdown.
  useEffect(() => {
    if (!open) return
    const onDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setQuery('')
    setFocused(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault()
            router.push(results[0].href as Route)
            close()
            onNavigate?.()
          }
        }}
        placeholder={t('navSearchPlaceholder')}
        aria-label={t('navSearchPlaceholder')}
        className="h-8 pl-8 text-sm"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-md">
          {results.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">{t('navSearchNoResults')}</p>
          ) : (
            groups.map((group) =>
              group.results.length === 0 ? null : (
                <div key={group.label}>
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium text-muted-foreground/50">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.results.map((entry) => {
                      const Icon = entry.icon
                      const row = (
                        <Link
                          href={entry.href as Route}
                          onClick={() => {
                            close()
                            onNavigate?.()
                          }}
                          className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
                            entry.pinnable ? 'pr-8' : ''
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{entry.label}</span>
                        </Link>
                      )
                      if (!entry.pinnable) return <div key={entry.id}>{row}</div>
                      return (
                        <div key={entry.id} className="group relative">
                          {row}
                          <PinButton id={entry.id} pinOnly />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            )
          )}
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
  const tp = useTranslations('Plugins')
  const pathname = usePathname()
  const { team, currentTeamId } = useAuth()
  const { isInstalled } = useInstalledPlugins()
  const { isAtLeast, plan } = usePlan()
  const { pinnedIds, recentIds, recordVisit } = useNavPins()
  // Raw message tree — used to read the per-locale `Nav.searchKeywords` synonym
  // map without a t() call per id (ids without keywords are simply label-only).
  const messages = useMessages() as unknown as {
    Nav?: { searchKeywords?: Record<string, string> }
  }
  const kwOf = (id: string) => messages.Nav?.searchKeywords?.[id] ?? ''
  const inOrg = !!team?.org_id
  // Show the Payments dashboard once a team has started Connect onboarding (an
  // account exists, not operator-disabled) OR has any BYO gateway configured —
  // both rails record into the unified payments view.
  const { data: hasByoGateway = false } = useHasByoGateway(currentTeamId ?? null)
  const connectOn =
    (!!team?.payments?.connectAccountId && team?.payments?.connectEnabled !== false) ||
    hasByoGateway
  // A public shop makes sense once there's something to sell OR a way to charge:
  // the products/online-courses plugin, or a payment channel (Connect/BYO).
  const shopAvailable = isInstalled('products') || isInstalled('online-courses') || connectOn

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

  // Whether a main-nav item passes its plan/plugin/org/shop gates — shared by the
  // section render and the pinnable catalogue so the two never disagree.
  const mainItemVisible = (item: NavItem) =>
    (!item.requiresOrg || inOrg) &&
    (!item.requiresConnect || connectOn) &&
    (!item.requiresShop || shopAvailable) &&
    (!item.requiresPlugin || isInstalled(item.requiresPlugin)) &&
    (!item.requiresPlan || isAtLeast(item.requiresPlan))

  const settingsItemVisible = (item: SettingsNavItem) => {
    if (item.gate === 'affiliations') return planSupportsAffiliations(plan)
    if (item.gate === 'customFields') return isInstalled('custom-fields')
    return true
  }

  // Resolve every currently-visible pinnable destination by id (main nav +
  // settings + installed plugin items), then pick the pinned ones in pin order.
  // Ids that aren't currently available (gated off) are silently skipped.
  const catalogue = new Map<string, ResolvedNavEntry>()
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!mainItemVisible(item)) continue
      catalogue.set(item.id, {
        id: item.id,
        href: item.href,
        label: t(item.labelKey as Parameters<typeof t>[0]),
        icon: item.icon,
        exact: item.exact,
      })
    }
  }
  for (const item of SETTINGS_ITEMS) {
    if (!settingsItemVisible(item)) continue
    catalogue.set(item.id, {
      id: item.id,
      href: item.href,
      label: t(item.labelKey as Parameters<typeof t>[0]),
      icon: item.icon,
      exact: item.exact,
    })
  }
  for (const nav of pluginEntries) {
    if (!nav.installed) continue
    const id = `plugin:${nav.pluginId}:${nav.href}`
    catalogue.set(id, {
      id,
      href: nav.href,
      label: tp(nav.labelKey as Parameters<typeof tp>[0]),
      icon: PLUGIN_NAV_ICONS[nav.icon] ?? Puzzle,
    })
  }
  // Shortcuts = pinned (permanent, pin order) + recently visited (rolling history,
  // newest first, excluding already-pinned) — Firebase-style.
  const pinnedEntries = pinnedIds
    .map((id) => catalogue.get(id))
    .filter((e): e is ResolvedNavEntry => !!e)
  const recentEntries = recentIds
    .filter((id) => !pinnedIds.includes(id))
    .map((id) => catalogue.get(id))
    .filter((e): e is ResolvedNavEntry => !!e)
    .slice(0, MAX_RECENT_SHORTCUTS)
  const shortcutEntries = [...pinnedEntries, ...recentEntries]

  // The search index: everything in the catalogue plus the two fixed General
  // items (searchable but not pinnable — they're always visible anyway).
  const searchEntries: SearchEntry[] = [
    ...[DASHBOARD_ITEM, ALL_SETTINGS_ITEM].map((item) => ({
      id: item.id,
      href: item.href,
      label: t(item.labelKey as Parameters<typeof t>[0]),
      icon: item.icon,
      exact: item.exact,
      keywords: kwOf(item.id),
      pinnable: false,
    })),
    ...Array.from(catalogue.values()).map((e) => ({
      ...e,
      keywords: kwOf(e.id),
      pinnable: true,
    })),
  ]

  // Record the current page into the recents half of Shortcuts. Longest matching
  // base path wins (so /contacts/123 records "contacts"); hrefs carrying a query
  // are deprioritised so /settings/team?tab=… variants don't shadow the base page.
  useEffect(() => {
    let best: ResolvedNavEntry | undefined
    let bestScore = -1
    for (const entry of catalogue.values()) {
      const base = entry.href.split('?')[0]
      if (pathname !== base && !pathname.startsWith(base + '/')) continue
      const score = base.length * 2 + (entry.href.includes('?') ? 0 : 1)
      if (score > bestScore) {
        bestScore = score
        best = entry
      }
    }
    if (best) recordVisit(best.id)
    // The catalogue is rebuilt every render; only the path matters for recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, recordVisit])

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

      {/* Quick search — pages now, entity providers later (hidden in icon mode) */}
      {!collapsed && (
        <div className="px-2 pt-2 shrink-0">
          <NavSearch entries={searchEntries} onNavigate={onLinkClick} />
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {/* General — Dashboard + the settings hub */}
        <div>
          {!collapsed && <GroupLabel>{t('navGroupGeneral')}</GroupLabel>}
          <div className="space-y-0.5">
            <NavLink item={DASHBOARD_ITEM} collapsed={collapsed} onClick={onLinkClick} />
            <NavLink item={ALL_SETTINGS_ITEM} collapsed={collapsed} onClick={onLinkClick} />
          </div>
        </div>

        {/* Shortcuts — pinned + recently visited (hidden when empty) */}
        <ShortcutsNav entries={shortcutEntries} collapsed={collapsed} onLinkClick={onLinkClick} />

        {/* Features — the Run / Offer / Grow working areas. Extra top margin on
            the sections: unlike the other macro groups, the first thing here is
            another (section) header, which otherwise sits too close to the label. */}
        <div className="mt-3 border-t pt-3">
          {!collapsed && <GroupLabel>{t('navGroupFeatures')}</GroupLabel>}
          <div className={collapsed ? 'space-y-1' : 'mt-2 space-y-3'}>
            {NAV_SECTIONS.map((section) => {
              const items = section.items.filter(mainItemVisible)
              const secPlugins = sectionedEntries.filter(
                (e) => PLUGIN_SECTION_TO_LABEL_KEY[e.section!] === section.labelKey
              )
              if (items.length === 0 && secPlugins.length === 0) return null
              const SectionIcon = section.icon
              const label = t(section.labelKey as Parameters<typeof t>[0])

              // The section's rows, always full-width — rendered inline when expanded,
              // and inside the flyout panel when the section is collapsed.
              const rows = (
                <>
                  {items.map((item) => (
                    <NavLink
                      key={item.id}
                      item={item}
                      collapsed={false}
                      onClick={onLinkClick}
                      pinId={item.id}
                    />
                  ))}
                  {secPlugins.map((nav) => (
                    <PluginNavItem
                      key={nav.pluginId + nav.href}
                      nav={nav}
                      collapsed={false}
                      onLinkClick={onLinkClick}
                      onDismiss={dismissSuggestion}
                    />
                  ))}
                </>
              )

              // Icon-only sidebar: one icon per section; hover pops a flyout of its rows.
              if (collapsed) {
                const sectionActive =
                  items.some((i) => pathname.startsWith(i.href)) ||
                  secPlugins.some((e) => pathname.startsWith(e.href))
                return (
                  <div key={section.labelKey}>
                    <NavFlyout
                      label={label}
                      trigger={
                        <button
                          type="button"
                          title={label}
                          className={`flex w-full items-center justify-center rounded-lg px-2 py-2 transition-colors ${
                            sectionActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          <SectionIcon className="h-4 w-4 shrink-0" />
                        </button>
                      }
                    >
                      {rows}
                    </NavFlyout>
                  </div>
                )
              }

              const secCollapsed = collapsedSections.includes(section.labelKey)
              const header = (
                <button
                  type="button"
                  onClick={() => toggleSection(section.labelKey)}
                  className="flex w-full items-center justify-between rounded px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                >
                  <span>{label}</span>
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 transition-transform ${secCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              )

              // Wide + chevron-collapsed: the header becomes a flyout trigger instead of
              // simply hiding the items.
              if (secCollapsed) {
                return (
                  <div key={section.labelKey}>
                    <NavFlyout label={label} trigger={header}>
                      {rows}
                    </NavFlyout>
                  </div>
                )
              }

              // Wide + expanded: inline list.
              return (
                <div key={section.labelKey}>
                  {header}
                  <div className="space-y-0.5">{rows}</div>
                </div>
              )
            })}
          </div>
        </div>

        <PluginNavLinks
          entries={unsectionedEntries}
          collapsed={collapsed}
          onLinkClick={onLinkClick}
          onDismiss={dismissSuggestion}
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
    <NavPinsProvider>
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
          {/* AI assistant — self-gates on the (locked) plugin being installed. */}
          <AssistantLauncher />
        </div>
      </UpgradeModalProvider>
    </NavPinsProvider>
  )
}
