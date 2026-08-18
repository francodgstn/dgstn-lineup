'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useLocale, useTranslations, useMessages } from 'next-intl'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useTrackNavigationDepth } from '@/hooks/useBackNavigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { MobileHeader } from '@/components/layout/MobileHeader'
import { AnnouncementBar } from '@/components/layout/AnnouncementBar'
import { UserMenu } from '@/components/layout/UserMenu'
import { TeamQrButton } from '@/components/layout/TeamQrButton'
import {
  LayoutDashboard,
  Users,
  Calendar,
  ClipboardList,
  ClipboardCheck,
  Trophy,
  Globe,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Lock,
  Puzzle,
  Monitor,
  Building2,
  Gift,
  GraduationCap,
  FolderTree,
  Settings,
  HelpCircle,
  X,
  Workflow,
  Zap,
  Package,
  IdCard,
  FileText,
  ShoppingBag,
  DoorOpen,
  UserCog,
  Star,
  Activity,
  Tag,
  TrendingUp,
  Search,
  Calculator,
  Ticket,
  MapPin,
  LayoutTemplate,
} from 'lucide-react'
import { Eraser } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Route } from 'next'
import { pluginAccessForPlan, type PluginAccess, type SaasPlan } from '@linyup/shared'
import { usePlan } from '@/hooks/usePlan'
import { usePlanName } from '@/hooks/usePlanName'
import { useCapabilities } from '@/hooks/useCapabilities'
import { useUpgradeModal, UpgradeModalProvider } from '@/contexts/UpgradeModalContext'
import { NavPinsProvider, useNavPins } from '@/contexts/NavPinsContext'
import { OpenTabsProvider, useOpenTabs } from '@/contexts/OpenTabsContext'
import { OpenTabsStrip } from '@/components/layout/OpenTabsStrip'
import { SETTINGS_ITEMS, type SettingsNavItem } from '@/lib/settings-nav'
import { useOrgLinks } from '@/hooks/useOrgLinks'
import { useActiveContacts } from '@/hooks/useActiveContacts'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { useActivities } from '@/hooks/useActivities'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useHasByoGateway } from '@/hooks/useConnect'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/Logo'
import { ProductTour } from '@/components/onboarding/ProductTour'
import { FreeDowngradeBanner } from '@/components/onboarding/FreeDowngradeBanner'
import AssistantLauncher from '@/plugins/ai-assistant/AssistantPanel'
import FeedbackLauncher from '@/components/feedback/FeedbackLauncher'
import { FloatingDock } from '@/components/layout/FloatingDock'

// Icons referenced by string name in plugin manifest navContributions
const PLUGIN_NAV_ICONS: Record<string, LucideIcon> = {
  Calculator,
  GraduationCap,
  Gift,
  Puzzle,
  Trophy,
  FolderTree,
  Globe,
  FileText,
  ClipboardList,
  Monitor,
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
// Plugin catalogue. Was a text link at the FOOT of the features group, which put
// discovery of most of the product below everything already installed — the one
// place a new studio, whose nav is nearly empty, is least likely to look. Now an
// icon button in the utility row at the top, first of the three.
const EXPLORE_PLUGINS_ITEM: NavItem = {
  id: 'explorePlugins',
  href: '/settings/plugins',
  labelKey: 'explorePlugins',
  icon: Puzzle,
  exact: true,
}
const ALL_SETTINGS_ITEM: NavItem = {
  id: 'allSettings',
  href: '/settings',
  labelKey: 'allSettings',
  icon: Settings, // cog — the settings hub
  exact: true,
}
// How-to — high-level product guides + onboarding workflow. A general utility
// destination like Settings; always visible, no plan gate.
const HOW_TO_ITEM: NavItem = {
  id: 'howTo',
  href: '/how-to',
  labelKey: 'howTo',
  icon: HelpCircle, // question mark — help
}

// Action-oriented sidebar sections for high-frequency destinations. Lower-frequency
// configuration lives behind "All settings" (the /settings hub) + whatever the user
// pins to the Pinned block — see src/lib/settings-nav.ts.
//
// ORDER WITHIN A SECTION IS FREQUENCY OF USE, MOST-USED FIRST, and it is the
// order that renders — see the render in SidebarContent, which deliberately does
// NOT sort. It was sorted alphabetically by translated label for one day
// (6d94638f); the effect was that Schedule — the destination a studio opens every
// single session — fell to the BOTTOM of Run, behind every row used less often,
// and in German/French/Italian it landed somewhere else again, so nothing about
// the list could be learned once (UX-29). Alphabetical is the right answer
// only for a list nobody can rank; these are ranked, so declaration order wins.
// Plugin-contributed rows still sort alphabetically: they arrive from a registry
// in an order the studio did not author and cannot be ranked here.
const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'sectionRun',
    icon: Activity,
    items: [
      { id: 'calendar', href: '/schedule', labelKey: 'calendar', icon: Calendar },
      // The printable day sheet — what a coach carries to the door. Sits next
      // to the calendar because it answers the same question ("what's on
      // today?") for the one context the calendar can't serve: paper.
      { id: 'manifest', href: '/manifest', labelKey: 'manifest', icon: ClipboardCheck },
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
      // Places — the studio's locations and rooms. A SCHEDULING reference, not a
      // preference: it is read by the session/event forms' place picker and by the
      // website's places section, and it is edited when the schedule needs a room
      // that doesn't exist yet. It sat in Settings → Scheduling, which meant
      // leaving the calendar entirely to add one (UX-67). LAST in Run: everything
      // above it is opened during a working day, this is opened while setting one
      // up. The page is a sibling of the calendar at /schedule/places, beside
      // /schedule/availability.
      { id: 'places', href: '/schedule/places', labelKey: 'places', icon: MapPin },
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
      // Unified read-only pricing surface — persona price preview + "what you
      // sell" summary + cross-entity health checks. No plugin gate: it reads
      // whatever's already configured (classes/appointments/plans/courses/products).
      { id: 'pricing', href: '/offer/pricing', labelKey: 'pricing', icon: Calculator },
      // Promo codes — a plugin as of Wave 3.5, so the item appears only once
      // installed, exactly like Courses and Products above and below it. The
      // plan requirement lives in the manifest (`minPlan: 'studio'`) and the
      // marketplace card is where a studio discovers it, which is why hiding
      // the nav item here no longer hides the feature's existence.
      //
      // The server gate is assertPluginInstalled on createPromoCode ONLY, so a
      // studio that uninstalls keeps its live codes redeemable and manageable.
      {
        id: 'promoCodes',
        href: '/offer/promo-codes',
        labelKey: 'promoCodes',
        icon: Ticket,
        requiresPlugin: 'promo-codes',
      },
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
      // Documents is a DEFAULT FEATURE on every plan — no `requiresPlugin`, no
      // `minPlan`. It was never monetised (the retired manifest declared
      // minPlan 'free' with no add-on), and its install gate was actively
      // harmful under a waiver gate: deactivating it deleted every public
      // document mirror the team had.
      {
        id: 'documents',
        href: '/documents',
        labelKey: 'documents',
        icon: FileText,
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
    // (section: 'engage').
    labelKey: 'sectionGrow',
    icon: TrendingUp,
    items: [
      // THE MAP OF EVERYTHING PUBLIC, first in the section. The public surfaces
      // are managed from route prefixes that have nothing in common — bio-link
      // under /team, website/kiosk/forms under /plugins, shop and space under
      // /public-page, the booking page under /settings, signup under /offer,
      // documents at its own root — and nobody holds that spread in their head.
      // The one page that does hold it (its `surfaces` array is the census) was
      // reachable only from the Settings rail (UX-28). Same id as the Settings
      // row, deliberately: ONE destination, one shortcut star, one search result.
      // Listing it here is what makes it findable from where public surfaces are
      // actually worked on.
      { id: 'publicPages', href: '/public-page', labelKey: 'publicPage', icon: LayoutTemplate, exact: true },
      { id: 'bioLink', href: '/team/bio-link', labelKey: 'bioLink', icon: Globe },
      // Space is the contacts' personal portal (membership, bookings, profile, their
      // courses) — a base surface, not tied to the online-courses plugin.
      { id: 'space', href: '/public-page/space', labelKey: 'space', icon: DoorOpen },
    ],
  },
]

// ─── nav link ─────────────────────────────────────────────────────────────────

// Small hover-reveal "always show" control on the right of a shortcut-able nav
// row (needs a `group` ancestor). Clicking adds/removes the destination from the
// always-shown half of Shortcuts without navigating. Turning it back OFF is
// managed from the Shortcuts group only: menu rows and search results pass
// `addOnly`, which hides the button once the destination is already always
// shown instead of offering a remove toggle there.
//
// A STAR, not a pin: "pin" is reserved for the open-tabs strip, which is a
// different mechanism (see THE NAV-MEMORY CENSUS in contexts/NavPinsContext.tsx).
function ShortcutButton({ id, addOnly }: { id: string; addOnly?: boolean }) {
  const t = useTranslations('Nav')
  const { isAlwaysShown, toggleAlwaysShown } = useNavPins()
  const shown = isAlwaysShown(id)
  if (addOnly && shown) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleAlwaysShown(id)
      }}
      title={shown ? t('shortcutStopAlwaysShowing') : t('shortcutAlwaysShow')}
      aria-pressed={shown}
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 transition-all ${
        shown
          ? 'text-muted-foreground/50 opacity-100 hover:bg-muted hover:text-foreground'
          : 'text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
      }`}
    >
      {/* Filled while ON — a star that only changes opacity reads as "hovered",
          not as "this is switched on", which is the state that matters here. */}
      <Star className={`h-3.5 w-3.5 ${shown ? 'fill-current' : ''}`} />
    </button>
  )
}

function NavLink({
  item,
  collapsed,
  onClick,
  shortcutId,
}: {
  item: NavItem
  collapsed: boolean
  onClick?: () => void
  // When set (and the sidebar is expanded), a hover "always show" toggle is
  // shown that adds this destination to the Shortcuts group.
  shortcutId?: string
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
      } ${collapsed ? 'justify-center px-2' : ''} ${shortcutId && !collapsed ? 'pr-8' : ''}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
      {!collapsed && <span>{label}</span>}
    </Link>
  )

  if (shortcutId && !collapsed) {
    return (
      <div className="group relative">
        {link}
        <ShortcutButton id={shortcutId} addOnly />
      </div>
    )
  }
  return link
}

// A compact icon-only link for the utility destinations (plugins, settings,
// how-to) that sit in their own row under the search bar rather than in the nav
// list. Always shows its label as a tooltip, since there's no text beside the
// icon.
function UtilityIconLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const pathname = usePathname()
  const t = useTranslations('Nav')
  const Icon = item.icon
  const label = t(item.labelKey as Parameters<typeof t>[0])
  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
  return (
    <Link
      href={item.href as Route}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
    </Link>
  )
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
  // Suggestions only — what the hover card needs to make the suggestion
  // EVALUABLE (UX-65): what the plugin does, and what it would cost here.
  descriptionKey?: string
  access?: PluginAccess
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

// Which Features section is expanded — accordion, so at most one is open at a
// time. Persisted per-browser; `null` = all collapsed. Defaults to the Run
// section (the most-used operational area) so the sidebar isn't all headers.
const NAV_OPEN_SECTION_KEY = 'linyup_nav_open_section'

function useAccordionSection() {
  const [open, setOpen] = useState<string | null>('sectionRun')
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_OPEN_SECTION_KEY)
      if (raw !== null) setOpen(raw === '' ? null : raw)
    } catch {
      /* ignore malformed storage */
    }
  }, [])
  const toggle = (key: string) => {
    setOpen((prev) => {
      // Opening a section closes any other; clicking the open one collapses it.
      const next = prev === key ? null : key
      try {
        localStorage.setItem(NAV_OPEN_SECTION_KEY, next ?? '')
      } catch {
        /* ignore */
      }
      return next
    })
  }
  return { open, toggle }
}

// HOW MANY SUGGESTIONS THE SIDEBAR MAY SHOW AT ONCE (UX-65).
//
// The muted discovery rows are opt-in advertising inside the studio's own menu,
// and the flag that produces them (`recommended` in a manifest) is set by us, not
// earned by anything the studio did. Uncapped, that stacked up: seven manifests
// carry the flag today and four of them contribute nav, three of those into a
// single section — so a new studio's "Grow" section was half real destinations
// and half things to buy, and the ratio got worse with every plugin shipped.
//
// So the cap is structural rather than a rule anyone has to remember:
//   • at most ONE per section — no section can ever read as a shop shelf;
//   • at most TWO in the whole sidebar.
// Dismissing one (the × on hover) promotes the next in line, so nothing becomes
// undiscoverable — it becomes SEQUENTIAL. The full catalogue stays one click away
// at the top of the sidebar (EXPLORE_PLUGINS_ITEM) and on the dashboard's Discover
// panel, which is the surface `recommended` mainly exists to feed: promo-codes was
// flagged for that panel and contributes no nav entry at all, so the flag's active
// use is untouched by this cap.
const MAX_NAV_SUGGESTIONS = 2
const MAX_NAV_SUGGESTIONS_PER_SECTION = 1

/** All plugin nav entries: installed (real links) + recommended-not-installed
 *  (muted discovery nudges, minus any the user has hidden), plus a `dismiss` to
 *  hide a suggestion. Installed sort before muted. */
function usePluginNavEntries(): { entries: PluginNavEntry[]; dismiss: (id: string) => void } {
  const { plugins, isInstalled, isLoading } = useInstalledPlugins()
  const { hidden, dismiss } = useHiddenSuggestions()
  const { plan } = usePlan()

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

  // Candidates, best-first: something the current plan can actually run before
  // something that needs an upgrade (a locked row the studio can't act on is the
  // least useful thing to spend one of the two slots on), then registry order —
  // authored, stable, and not a ranking the studio would have to re-learn.
  // `coming_soon` never appears: there is nothing to install.
  const accessRank = (a: PluginAccess) => (a.kind === 'upgrade' ? 1 : 0)
  const candidates = isLoading
    ? []
    : PLUGIN_REGISTRY.filter(
        (m) =>
          m.recommended &&
          m.status !== 'coming_soon' &&
          (m.navContributions?.length ?? 0) > 0 &&
          !isInstalled(m.id) &&
          !hidden.includes(m.id)
      )
        .map((m) => ({ m, access: pluginAccessForPlan(m, plan) }))
        .sort((a, b) => accessRank(a.access) - accessRank(b.access))

  // Apply the caps on the PLUGIN, not on its nav rows: a plugin contributing two
  // rows would otherwise spend both slots advertising itself.
  const perSection = new Map<string, number>()
  const discovery: PluginNavEntry[] = []
  for (const { m, access } of candidates) {
    if (discovery.length >= MAX_NAV_SUGGESTIONS) break
    const rows = (m.navContributions ?? []).map((nav) => ({
      ...nav,
      section: nav.section ?? (m.category === 'engagement' ? 'engage' : undefined),
      pluginId: m.id,
      category: m.category,
      installed: false,
      descriptionKey: m.descriptionKey,
      access,
    }))
    // A plugin lands in exactly one place, so one row decides its section.
    const sectionKey = rows[0]?.section ?? '_unsectioned'
    if ((perSection.get(sectionKey) ?? 0) >= MAX_NAV_SUGGESTIONS_PER_SECTION) continue
    perSection.set(sectionKey, (perSection.get(sectionKey) ?? 0) + 1)
    discovery.push(...rows.slice(0, 1))
  }

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
  const planName = usePlanName()
  const Icon = PLUGIN_NAV_ICONS[nav.icon] ?? Puzzle
  const linkLabel = t(nav.labelKey as Parameters<typeof t>[0])

  // Recommended but not installed → muted discovery item. Clicking opens the
  // plugin's detail modal on the marketplace (deep-linked via ?plugin=). Hover
  // reveals a × to hide the suggestion (browser-only).
  //
  // A SUGGESTION HAS TO BE EVALUABLE FROM WHERE IT SITS (UX-65). It used to say
  // only "Recommended — add this plugin", which asks the studio to judge a word
  // it has no way to interpret: recommended by whom, on what evidence, and at
  // what price? Three of those four are answerable for free — what the plugin
  // does (its own one-line description), what it would cost on THIS plan, and
  // the honest provenance of the flag: it is a manifest boolean we set, not
  // anything derived from the studio's data. Saying so is the difference between
  // a suggestion and an advert that won't admit what it is.
  if (!nav.installed) {
    const access = nav.access
    const accessLine =
      access?.kind === 'included'
        ? t('suggestionIncluded')
        : access?.kind === 'addon'
          ? t('addonPrice', { price: access.priceMonthly })
          : access?.kind === 'upgrade'
            ? t('suggestionNeedsPlan', { plan: planName(access.minPlan) })
            : null
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
            <TooltipContent side="right" className="max-w-64 flex-col items-start gap-1 text-left">
              {nav.descriptionKey && (
                // Clamped: a manifest description is written for a marketplace
                // card, and a few of them run to three sentences.
                <span className="line-clamp-3 block">
                  {t(nav.descriptionKey as Parameters<typeof t>[0])}
                </span>
              )}
              {accessLine && <span className="block font-medium">{accessLine}</span>}
              <span className="block opacity-70">{t('recommendedWhy')}</span>
              {/* Replaces the old `discoverTooltip` ("Recommended — add this
                  plugin"), which said the word "Recommended" a second time right
                  under the line that finally explains it, and promised an install
                  the click doesn't perform — it opens the catalogue entry. */}
              <span className="block opacity-70">{t('suggestionOpenCatalogue')}</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* Marks the row as a suggestion rather than a destination, in the same
            vocabulary the marketplace uses for `recommended` (an amber star).
            Swaps to the × on hover — one slot, two states. */}
        {!collapsed && (
          <Star className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 fill-amber-500/30 text-amber-500/50 transition-opacity group-hover/suggestion:opacity-0" />
        )}
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
  const shortcutId = `plugin:${nav.pluginId}:${nav.href}`
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
      <ShortcutButton id={shortcutId} addOnly />
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
      {/* Remove from Shortcuts entirely — the star only promotes/demotes
          (turning "always show" off keeps the row listed as a recent). */}
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
      <ShortcutButton id={entry.id} />
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

// Expanded-sidebar wrapper for the Shortcuts group — marked by a 2px brand-violet
// accent down the left edge that fades out towards the bottom, rather than a
// filled panel. Same "this section is different" signal with far less surface
// area: a tinted block competes with the rows inside it, while an edge just
// brackets them. (The icon rail keeps the plain hairline divider instead.)
//
// Drawn as a pseudo-element rather than a border: `border-color` takes no
// gradient. Uses Tailwind's own `from-primary/55` utilities so the colour comes
// from the design token — `--primary` is an oklch() value, so hand-rolling
// `hsl(var(--primary)/…)` would not resolve.
//
// Wraps the ROWS ONLY, not the group label: the label stays at the same indent
// as General/Features so the three macro headings line up, and the rule brackets
// what's specific to this group.
const SHORTCUTS_RULE =
  'relative pl-3 pt-0.5 pb-1.5 ' +
  'before:absolute before:left-0 before:top-1 before:bottom-2 before:w-0.5 before:rounded-full ' +
  'before:bg-gradient-to-b before:from-primary/55 before:via-primary/20 before:to-transparent'

// How many recently-visited items the Shortcuts group keeps, in addition to the
// always-shown ones.
const MAX_RECENT_SHORTCUTS = 5
// Rows shown before "Show more" — always-shown rows are never truncated, so the
// effective cap is max(this, always-shown count).
const SHORTCUTS_VISIBLE_MIN = 5

// The "Shortcuts" macro group — Firebase-style: a rolling history of the user's
// recently-opened destinations, with the always-shown ones promoted to the top
// and kept permanently. The star on each row promotes a recent to always-shown
// (and back — turning it off keeps the row listed as a recent); the X removes it
// from the group; drag a row to reorder (manual placement makes it always shown).
// A destination can also be added from the menu rows and the search dropdown.
// Hidden entirely when there's nothing to show. Per-browser (NavPinsContext) —
// one of the mechanisms enumerated in THE NAV-MEMORY CENSUS there.
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
  const { alwaysShownIds, setShortcutOrder, clearShortcuts } = useNavPins()
  const [expanded, setExpanded] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  // Insertion index (in the displayed list) the dragged row would drop into.
  const [dropAt, setDropAt] = useState<number | null>(null)

  // Keep the group visible even when empty (expanded sidebar only) — a short
  // muted hint explains how it fills up. The icon rail just skips it.
  if (entries.length === 0) {
    if (collapsed) return null
    return (
      <div data-tour="nav-shortcuts" className="mt-3">
        <GroupLabel>{t('navGroupShortcuts')}</GroupLabel>
        <div className={SHORTCUTS_RULE}>
          <p className="py-1 pr-2 text-xs leading-relaxed text-muted-foreground/60">
            {t('navShortcutsEmpty')}
          </p>
        </div>
      </div>
    )
  }

  const alwaysShownCount = entries.filter((e) => alwaysShownIds.includes(e.id)).length
  const visibleCount = Math.max(SHORTCUTS_VISIBLE_MIN, alwaysShownCount)
  const shown = expanded ? entries : entries.slice(0, visibleCount)
  const hasMore = entries.length > visibleCount

  // Drop = manual curation: the dragged row becomes (or stays) always shown, and
  // the stored order becomes the displayed order filtered to always-shown rows.
  // Untouched recents keep flowing chronologically below them.
  const commitDrop = () => {
    if (dragId != null && dropAt != null) {
      const ids = entries.map((e) => e.id)
      const from = ids.indexOf(dragId)
      if (from !== -1) {
        const next = ids.filter((id) => id !== dragId)
        next.splice(dropAt > from ? dropAt - 1 : dropAt, 0, dragId)
        const shownSet = new Set([...alwaysShownIds, dragId])
        setShortcutOrder(next.filter((id) => shownSet.has(id)))
      }
    }
    setDragId(null)
    setDropAt(null)
  }

  const dropLine = <div className="mx-2 my-0.5 h-0.5 rounded bg-primary/60" />

  return (
    <div data-tour="nav-shortcuts" className={collapsed ? 'mt-3 pt-3' : 'mt-3'}>
      {/* Header row: the group label, with "clear all" pushed to the right.
          Confirmed, because the always-shown rows are hand-curated and
          drag-ordered — rebuilding them is minutes of fiddling, and there is no
          undo. */}
      {!collapsed && (
        <div className="flex items-center pb-1">
          <p className="flex-1 px-2 text-[11px] font-medium text-muted-foreground/50">
            {t('navGroupShortcuts')}
          </p>
          <button
            type="button"
            onClick={() => setClearOpen(true)}
            title={t('navShortcutsClear')}
            aria-label={t('navShortcutsClear')}
            className="mr-1 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {!collapsed && (
        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('navShortcutsClearTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('navShortcutsClearExplain')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('navShortcutsClearCancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  clearShortcuts()
                  setClearOpen(false)
                }}
              >
                {t('navShortcutsClear')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <div className={collapsed ? 'space-y-0.5' : `${SHORTCUTS_RULE} space-y-0.5`}>
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
        {/* Inside the rule: Show more belongs to this group's content, so it
            shares the rows' indent rather than hanging off the edge. */}
        {!collapsed && hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
            <span>{expanded ? t('navShowLess') : t('navShowMore')}</span>
          </button>
        )}
      </div>
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

// What a result IS. A studio looks up two different kinds of thing by name —
// where to go (a page, a settings screen) and a record it works on (a person, a
// plan, an activity) — and a flat list of both reads as neither. The kind picks
// the group heading; it is also why settings destinations are no longer listed
// as ordinary pages (UX-90).
type SearchKind = 'page' | 'settings' | 'contact' | 'subscription' | 'activity'

// A searchable destination: the localized label plus curated keyword synonyms
// from the `Nav.searchKeywords` i18n map (what a user might type instead of the
// label — "members" for Contacts — maintained per locale). Entity results share
// the shape (no keywords, never shortcut-able) so ONE flattened list still
// drives the keyboard selection.
type SearchEntry = ResolvedNavEntry & {
  keywords: string
  canShortcut: boolean
  kind: SearchKind
  // Second line on an entity row — an email, a price, a level. Never matched
  // against blindly: only the fields the provider chose to search are.
  sublabel?: string
}

// ⌘ on Apple, Ctrl elsewhere. Deliberately NOT translated — these are key CAPS,
// the same glyph on a German keyboard as on an English one. Guards `navigator`
// so it is safe during SSR, where it resolves to the Ctrl form and is corrected
// on hydration (the hint is decorative; the handler accepts either modifier).
function modKeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+'
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+'
}

// Sidebar quick-search (Firebase-style). It searches nav destinations AND the
// three things a studio looks up by name all day — a contact, a subscription
// type, an activity (UX-90) — each in its own group.
//
// HOW THE ENTITY LISTS ARE FETCHED, deliberately: not per keystroke. Firestore
// has no substring search, so a query-per-keystroke design would cost a read
// round-trip per letter and STILL only match prefixes. Instead each list is
// pulled ONCE per panel session through the SAME hook its own page uses — so
// the cache is shared, and the contacts list keeps its (lastname, firstname)
// ordering, which is the composite index a real project requires — and filtered
// in memory, exactly like every list page's search field. It arms on the second
// typed character, so opening the panel by accident (or with ⌘K and closing
// again) reads nothing; closing disarms it, so the next session sees anything
// created meanwhile.
function NavSearch({
  entries,
  onNavigate,
  collapsed,
}: {
  entries: SearchEntry[]
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const t = useTranslations('Nav')
  const router = useRouter()
  const { openInNewTab, enabled: tabsEnabled } = useOpenTabs()
  const { isAlwaysShown, toggleAlwaysShown } = useNavPins()
  const { currentTeamId, user } = useAuth()
  const { ownScoped } = useCapabilities()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Where the panel opens: measured from the trigger at click time, so it grows
  // out of the control the user actually pressed rather than appearing in the
  // corner of the window. Falls back to the sidebar's top-left for ⌘K, which
  // has no click to measure.
  const [anchor, setAnchor] = useState<{ left: number; top: number }>({ left: 8, top: 8 })

  const openPanel = () => {
    const r = triggerRef.current?.getBoundingClientRect()
    // Offset right of the trigger on desktop so the panel is visibly detached
    // from the window edge rather than pinned to it. Not on narrow viewports,
    // where every pixel of width counts more than the gap.
    const nudge = typeof window !== 'undefined' && window.innerWidth >= 768 ? 8 : 0
    if (r) setAnchor({ left: r.left + nudge, top: r.top })
    setExpanded(true)
  }

  const q = normalizeSearch(query.trim())

  // Armed = the entity lists may be fetched. Latched: once a real query has been
  // typed it stays armed for the rest of the panel session, so deleting back to
  // one character and typing again does not re-run three queries.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (expanded && q.length >= 2) setArmed(true)
  }, [expanded, q])

  // Own-scoped members (coaches) may only READ their assigned contacts — the
  // broad roster query is denied for them by the rules — so the search runs the
  // same scoped variant the contacts page does rather than a query that would
  // fail silently and make search look empty for a whole role.
  const scopeUid = ownScoped ? (user?.uid ?? null) : null
  const entityTeamId = armed ? currentTeamId : null
  const { data: contacts = [], isFetching: contactsFetching } = useActiveContacts(
    entityTeamId,
    scopeUid
  )
  const { data: subscriptionTypes = [], isFetching: subsFetching } =
    useSubscriptionTypes(entityTeamId)
  const { data: activities = [], isFetching: activitiesFetching } = useActivities(entityTeamId)
  const entitiesFetching = contactsFetching || subsFetching || activitiesFetching

  const matches = (...fields: (string | null | undefined)[]) =>
    fields.some((f) => f && normalizeSearch(f).includes(q))

  const navResults = (kind: SearchKind, limit: number) =>
    q
      ? entries
          .filter((e) => e.kind === kind)
          .filter((e) => matches(e.label, e.keywords))
          .slice(0, limit)
      : []

  const entityRow = (
    id: string,
    href: string,
    label: string,
    icon: React.ElementType,
    kind: SearchKind,
    sublabel?: string
  ): SearchEntry => ({ id, href, label, icon, keywords: '', canShortcut: false, kind, sublabel })

  // A contact has a record of its own to open. A subscription type and an
  // activity do not — they are edited in a dialog on the page that lists them —
  // so those results land on that page rather than inventing a route.
  const contactResults: SearchEntry[] = q
    ? contacts
        .filter((c) => matches(`${c.firstname ?? ''} ${c.lastname ?? ''}`, c.email, c.phone))
        .slice(0, 6)
        .map((c) =>
          entityRow(
            `contact:${c.id}`,
            `/contacts/${c.id}`,
            `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim() || (c.email ?? c.id),
            Users,
            'contact',
            c.email ?? undefined
          )
        )
    : []
  const subscriptionResults: SearchEntry[] = q
    ? subscriptionTypes
        .filter((st) => matches(st.name, st.description))
        .slice(0, 4)
        .map((st) => entityRow(`subscription:${st.id}`, '/offer/plans', st.name, IdCard, 'subscription'))
    : []
  const activityResults: SearchEntry[] = q
    ? activities
        .filter((a) => matches(a.name, a.description))
        .slice(0, 4)
        .map((a) => entityRow(`activity:${a.id}`, '/offer/activities', a.name, Zap, 'activity'))
    : []

  // Order = how a studio reads the panel: where-to-go first (few, precise
  // matches), then the records, contacts first because they are the volume case.
  const groups: { key: string; label: string; results: SearchEntry[] }[] = [
    { key: 'pages', label: t('navSearchGroupPages'), results: navResults('page', 8) },
    { key: 'settings', label: t('navSearchGroupSettings'), results: navResults('settings', 5) },
    { key: 'contacts', label: t('navSearchGroupContacts'), results: contactResults },
    {
      key: 'subscriptions',
      label: t('navSearchGroupSubscriptions'),
      results: subscriptionResults,
    },
    { key: 'activities', label: t('navSearchGroupActivities'), results: activityResults },
  ]
  // Two different things, no longer fused: the PANEL is open because the user
  // asked for it, and the RESULT LIST appears once there is something to match.
  const showResults = expanded && q.length > 0
  const open = showResults

  // Keyboard selection indexes the FLATTENED result order, so it keeps working
  // when later providers append their own groups — the visual grouping and the
  // arrow-key order must not diverge.
  const flat = groups.flatMap((g) => g.results)
  const active = flat[activeIndex]

  // A new query is a new result set; an index carried over from the old one
  // would highlight an unrelated row (or nothing).
  useEffect(() => {
    setActiveIndex(0)
  }, [q])

  // Keep the highlighted row visible in the scrollable dropdown.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  // Close when clicking anywhere outside the panel. Keyed on `expanded`, not on
  // `open`: the panel is dismissible while it is still empty, which is exactly
  // when a user who opened it by accident wants out.
  useEffect(() => {
    if (!expanded) return
    const onDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [expanded])

  // ⌘K / Ctrl+K. Behind an icon, search loses the discoverability a permanent
  // field had; the shortcut is the standard compensation, and the placeholder
  // spells it out for anyone who opens the panel by mouse.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'k' || ev.key === 'K')) {
        ev.preventDefault()
        openPanel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const close = () => {
    setQuery('')
    setExpanded(false)
    setActiveIndex(0)
    // Disarm: the next panel session re-reads the entity lists, so a contact
    // added a minute ago is findable without a page reload.
    setArmed(false)
  }

  const openEntry = (entry: SearchEntry) => {
    router.push(entry.href as Route)
    close()
    onNavigate?.()
  }

  // Background tab, matching the ctrl/⌘/middle-click convention OpenTabsContext
  // already documents. With the strip switched off (Settings → General) there is
  // nowhere to put a tab, so fall back to opening normally rather than no-op —
  // a shortcut that silently does nothing reads as broken.
  const openEntryAsTab = (entry: SearchEntry) => {
    if (!tabsEnabled) return openEntry(entry)
    openInNewTab(entry.href, entry.label)
    close()
  }

  // The trigger — a MINI-INPUT, not a bare icon.
  //
  // It reads as a field (icon + placeholder + a rule under it) so it still says
  // "you can search here", while costing a share of one row instead of a whole
  // one — which is what freed the space the studio name now uses in the header.
  // Clicking it opens the real input in an overlay; because the two look alike,
  // that reads as the field growing rather than a different thing appearing.
  //
  // It takes the row's spare width (`flex-1`) and pushes the true icon buttons
  // right, which is also what keeps THEM reading as secondary.
  //
  // Collapsed sidebar: no room for text, so it falls back to the icon alone.
  // The trigger stays MOUNTED while the panel is open. Unmounting it collapsed
  // the row and slid the icons beside it left — and, because the panel anchors
  // to the trigger's measured position, an unmounted trigger also loses the ref
  // any reposition would need.
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        data-tour="nav-search"
        onClick={openPanel}
        title={`${t('navSearchPlaceholder')} (${modKeyLabel()}K)`}
        aria-label={t('navSearchPlaceholder')}
        className={
          collapsed
            ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            : 'group/search flex h-8 min-w-0 flex-1 items-center gap-1.5 border-b border-transparent px-1 text-muted-foreground transition-colors hover:border-border hover:text-foreground'
        }
      >
        <Search className="h-4 w-4 shrink-0" />
        {/* Placeholder only — no ⌘K badge. The shortcut still works and is in
            the tooltip; printed in the row it was visual noise on a control
            whose whole job is to stay quiet until wanted. */}
        {!collapsed && <span className="truncate text-xs">{t('navSearchPlaceholder')}</span>}
      </button>

      {/* PORTALLED TO document.body. `fixed` is only viewport-relative while no
          ancestor creates a containing block, and the sidebar sits inside a
          sticky/width-transitioning tree — on the settings page the overlay
          rendered BEHIND the page content because of it. A portal removes the
          whole class of bug rather than chasing z-index. */}
      {expanded &&
        createPortal(
    <>
      {/* Dim the page behind the panel — enough to actually read as a mode the
          app is in, not a translucent box floating over live content. */}
      <div aria-hidden className="fixed inset-0 z-40 animate-in fade-in-0 duration-150 bg-background/80" />
      <div
        ref={wrapRef}
        data-tour="nav-search"
        // Grows out of the trigger, spilling a little into the content area.
        // Capped so it never runs off a narrow viewport.
        style={{ left: anchor.left, top: anchor.top }}
        // Grows out of the trigger: fades and scales up from 95%, sliding a few
        // pixels right so it reads as the mini-input opening rather than a
        // separate panel blinking into existence on top of it.
        className="fixed z-50 w-[min(22rem,calc(100vw-1rem))] origin-top-left animate-in fade-in-0 zoom-in-95 slide-in-from-left-2 duration-150 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
      >
      <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        // autoFocus, NOT a ref: the shared Input is a plain function component
        // with no forwardRef, so a ref on it is silently null and the panel
        // opened with nothing focused. The input mounts with the panel, so
        // autoFocus is both correct and simpler.
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        role="combobox"
        aria-expanded={open}
        aria-controls="nav-search-results"
        aria-activedescendant={open && active ? `nav-search-opt-${active.id}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return close()
          if (!open || flat.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((i) => (i + 1) % flat.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((i) => (i - 1 + flat.length) % flat.length)
            // Home/End are deliberately NOT bound: this is a text input the
            // visitor is still typing in, and there they move the caret. Arrows
            // are the list-navigation convention precisely because they are the
            // keys a text field does not need.
          } else if (e.key === 'Enter' && active) {
            e.preventDefault()
            if (e.metaKey || e.ctrlKey) openEntryAsTab(active)
            else openEntry(active)
          } else if ((e.key === 's' || e.key === 'S') && e.altKey && active?.canShortcut) {
            // Alt rather than ⌘/Ctrl: ⌘S is Save in every browser.
            e.preventDefault()
            toggleAlwaysShown(active.id)
          }
        }}
        placeholder={t('navSearchPlaceholder')}
        aria-label={t('navSearchPlaceholder')}
        className="h-8 pl-8 text-sm"
      />
      </div>
      {/* Before anything is typed the panel would otherwise be a bare field with
          a void under it, which reads as broken rather than ready. One quiet row,
          shaped like the result rows it will be replaced by. */}
      {!showResults && (
        <div className="mt-1.5 flex items-center gap-2 rounded-md px-2 py-3 text-sm text-muted-foreground">
          {/* No icon — the field above already has one, and repeating it made
              the row read as a result rather than a prompt. The shortcut IS
              here, though: this is the moment the user is looking at the panel
              and can learn how to reach it without the mouse next time. */}
          <span className="min-w-0 leading-snug">{t('navSearchPromptAll')}</span>
          <kbd className="ml-auto shrink-0 rounded border px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground/70">
            {modKeyLabel()}K
          </kbd>
        </div>
      )}
      {showResults && (
        <div
          ref={listRef}
          id="nav-search-results"
          role="listbox"
          className="mt-1.5 max-h-[60vh] overflow-y-auto"
        >
          {flat.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {/* Nav destinations match instantly; the entity lists may still be
                  in flight, and "no results" shown over a pending fetch is a
                  wrong answer stated confidently. Same for the FIRST character:
                  the entity lists arm at two, so a one-letter query has not
                  looked at a single contact yet and must not claim it has
                  (UX-21 — this panel is now the way to reach a person). */}
              {q.length < 2
                ? t('navSearchKeepTyping')
                : entitiesFetching
                  ? t('navSearchSearching')
                  : t('navSearchNoMatches')}
            </p>
          ) : (
            <>
              {groups.map((group) =>
                group.results.length === 0 ? null : (
                  <div key={group.key}>
                    <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium text-muted-foreground/50">
                      {group.label}
                    </p>
                    <div className="space-y-0.5">
                      {group.results.map((entry) => {
                        const Icon = entry.icon
                        const isActive = active?.id === entry.id
                        const row = (
                          <Link
                            href={entry.href as Route}
                            id={`nav-search-opt-${entry.id}`}
                            role="option"
                            aria-selected={isActive}
                            data-active={isActive}
                            // Pointer and keyboard drive ONE selection, so hovering
                            // moves the highlight instead of fighting it.
                            onMouseEnter={() => setActiveIndex(flat.indexOf(entry))}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey) {
                                e.preventDefault()
                                openEntryAsTab(entry)
                                return
                              }
                              close()
                              onNavigate?.()
                            }}
                            className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-foreground ${
                              isActive ? 'bg-accent text-foreground' : 'text-muted-foreground'
                            } ${entry.canShortcut ? 'pr-8' : ''}`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{entry.label}</span>
                            {entry.sublabel && (
                              <span className="truncate text-xs font-normal text-muted-foreground/70">
                                {entry.sublabel}
                              </span>
                            )}
                            {isAlwaysShown(entry.id) && (
                              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                                {t('navSearchInShortcuts')}
                              </span>
                            )}
                          </Link>
                        )
                        if (!entry.canShortcut) return <div key={entry.id}>{row}</div>
                        return (
                          <div key={entry.id} className="group relative">
                            {row}
                            <ShortcutButton id={entry.id} addOnly />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              )}
              {/* Shortcuts are invisible without a hint, and an undiscoverable
                  shortcut is the same as an absent one. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t px-2 pb-0.5 pt-1.5 text-[10px] text-muted-foreground/70">
                <span>
                  <kbd className="font-sans">↑↓</kbd> {t('navSearchHintNavigate')}
                </span>
                <span>
                  <kbd className="font-sans">↵</kbd> {t('navSearchHintOpen')}
                </span>
                {tabsEnabled && (
                  <span>
                    <kbd className="font-sans">{modKeyLabel()}↵</kbd> {t('navSearchHintTab')}
                  </span>
                )}
                {active?.canShortcut && (
                  <span>
                    <kbd className="font-sans">Alt+S</kbd> {t('navSearchHintShortcut')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
      </div>
    </>,
          document.body
        )}
    </>
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
  const { isAtLeast } = usePlan()
  // The owner-only settings destinations (see SettingsGate in lib/settings-nav).
  const canEditTeamSettings = useCapabilities().can('team.settings')
  const { alwaysShownIds, recentIds, recordVisit } = useNavPins()
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
  const locale = useLocale()
  const { open: openSection, toggle: toggleSection } = useAccordionSection()

  // Whether a main-nav item passes its plan/plugin/org/shop gates — shared by the
  // section render and the shortcut-able catalogue so the two never disagree.
  const mainItemVisible = (item: NavItem) =>
    (!item.requiresOrg || inOrg) &&
    (!item.requiresConnect || connectOn) &&
    (!item.requiresShop || shopAvailable) &&
    (!item.requiresPlugin || isInstalled(item.requiresPlugin)) &&
    (!item.requiresPlan || isAtLeast(item.requiresPlan))

  // Mirrors SettingsRail's gateOk — the sidebar's shortcut-able catalogue and the rail
  // must never disagree about what exists.
  const settingsItemVisible = (item: SettingsNavItem) => {
    if (item.gate === 'ownerOnly') return canEditTeamSettings
    if (item.gate === 'customFields') return isInstalled('custom-fields')
    return true
  }

  // Resolve every currently-visible shortcut-able destination by id (main nav +
  // settings + installed plugin items), then pick the always-shown ones in their
  // stored order. Ids that aren't currently available (gated off) are skipped.
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
  // Shortcuts = always shown (permanent, stored order) + recently visited
  // (rolling history, newest first, minus anything already always shown).
  const alwaysShownEntries = alwaysShownIds
    .map((id) => catalogue.get(id))
    .filter((e): e is ResolvedNavEntry => !!e)
  const recentEntries = recentIds
    .filter((id) => !alwaysShownIds.includes(id))
    .map((id) => catalogue.get(id))
    .filter((e): e is ResolvedNavEntry => !!e)
    .slice(0, MAX_RECENT_SHORTCUTS)
  const shortcutEntries = [...alwaysShownEntries, ...recentEntries]

  // The search index: everything in the catalogue plus the three fixed General
  // items (searchable but not shortcut-able — they're always visible anyway).
  // A settings destination is tagged as such rather than listed among ordinary
  // pages (UX-90) — including the /settings hub itself, which IS the settings
  // answer to "where do I change this".
  const settingsIds = new Set(SETTINGS_ITEMS.map((i) => i.id))
  const searchEntries: SearchEntry[] = [
    ...[DASHBOARD_ITEM, ALL_SETTINGS_ITEM, HOW_TO_ITEM].map((item) => ({
      id: item.id,
      href: item.href,
      label: t(item.labelKey as Parameters<typeof t>[0]),
      icon: item.icon,
      exact: item.exact,
      keywords: kwOf(item.id),
      canShortcut: false,
      kind: (item.id === ALL_SETTINGS_ITEM.id ? 'settings' : 'page') as SearchKind,
    })),
    ...Array.from(catalogue.values()).map((e) => ({
      ...e,
      keywords: kwOf(e.id),
      canShortcut: true,
      kind: (settingsIds.has(e.id) ? 'settings' : 'page') as SearchKind,
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
      {/* Logo + collapse toggle. The PRODUCT's identity, and nothing else — the
          studio's name gets its own row below rather than sitting under the
          Linyup mark, where the two read as one lockup. */}
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

      {/* WHICH STUDIO — its own row, with the QR beside it. The QR belongs here
          rather than with the utility icons: it encodes THIS studio's public
          links, so it is a property of the name it sits next to, not another
          place to navigate to. (It used to live beside the user avatar, inside
          the account cluster, which was the wrong grouping in a third way.)

          Orientation, not a control: there is no team switcher — a user's
          `currentTeam` is a single value on their profile. Hidden when collapsed,
          like every other piece of text in the sidebar. */}
      {!collapsed && team?.name && (
        <div className="mx-2 flex shrink-0 items-center gap-1 border-b py-1.5">
          <Link
            href={'/dashboard' as Route}
            onClick={onLinkClick}
            className="min-w-0 flex-1 truncate rounded px-1 text-xs font-medium transition-colors hover:text-primary"
          >
            {team.name}
          </Link>
          <TeamQrButton />
        </div>
      )}

      {/* Utility row — search, then plugins / settings / how-to. Occasional,
          deliberate destinations, so icons rather than rows competing with the
          working areas below.

          Search is a mini-input rather than the full-width field it used to be a
          row above: the field cost a whole row for something used in bursts, and
          collapsing it is what freed the space the studio name now has. It opens
          as an overlay anchored to itself, and ⌘K/Ctrl+K opens it too — behind an
          icon it would otherwise lose the discoverability a permanent field had.

          Closed by a rule that separates it from Dashboard, the first working
          row. In icon-only mode they stack as centred icons. */}
      <div
        // No bottom rule: the row already reads as part of the header block
        // above it, and a second line so close to the studio row's was clutter.
        // The padding stays, so the spacing below is unchanged.
        className={`mx-2 pt-2 pb-2 shrink-0 flex gap-1 ${
          collapsed ? 'flex-col items-center' : 'items-center'
        }`}
      >
        <NavSearch entries={searchEntries} onNavigate={onLinkClick} collapsed={collapsed} />
        {collapsed && <TeamQrButton collapsed />}
        <UtilityIconLink item={EXPLORE_PLUGINS_ITEM} onClick={onLinkClick} />
        <UtilityIconLink item={ALL_SETTINGS_ITEM} onClick={onLinkClick} />
        <UtilityIconLink item={HOW_TO_ITEM} onClick={onLinkClick} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {/* Dashboard — a full menu row of its own, directly under the utility
            icons. It used to share the toolbar with them and wear their quiet
            active style; it is a working destination people return to daily, not
            a utility, so it now reads like every other nav row. */}
        <NavLink item={DASHBOARD_ITEM} collapsed={collapsed} onClick={onLinkClick} />

        {/* Shortcuts — pinned + recently visited (hidden when empty) */}
        <ShortcutsNav entries={shortcutEntries} collapsed={collapsed} onLinkClick={onLinkClick} />

        {/* Features — the Run / Offer / Grow working areas. Extra top margin on
            the sections: unlike the other macro groups, the first thing here is
            another (section) header, which otherwise sits too close to the label. */}
        <div className="mt-3 pt-3" data-tour="nav-features">
          {!collapsed && <GroupLabel>{t('navGroupFeatures')}</GroupLabel>}
          <div className={collapsed ? 'space-y-1' : 'mt-2 space-y-3'}>
            {NAV_SECTIONS.map((section) => {
              // DECLARATION ORDER — which is frequency of use, most-used first
              // (see NAV_SECTIONS). Deliberately NOT sorted: alphabetical by
              // translated label put Schedule last in Run, behind five items a
              // studio opens far less often, and put it somewhere different again
              // in each locale (UX-29).
              const byLabel = (a: string, b: string) => a.localeCompare(b, locale)
              const items = section.items.filter(mainItemVisible)
              // Plugin rows keep the alphabetical sort: they come from a registry
              // in an order the studio did not author, so there is no ranking to
              // preserve — only a stable, readable one to impose.
              const secPlugins = sectionedEntries
                .filter((e) => PLUGIN_SECTION_TO_LABEL_KEY[e.section!] === section.labelKey)
                .slice()
                .sort((a, b) =>
                  byLabel(
                    tp(a.labelKey as Parameters<typeof tp>[0]),
                    tp(b.labelKey as Parameters<typeof tp>[0])
                  )
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
                      shortcutId={item.id}
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

              const secCollapsed = openSection !== section.labelKey
              const header = (
                <button
                  type="button"
                  onClick={() => toggleSection(section.labelKey)}
                  className="flex w-full items-center justify-between rounded px-2 pb-1 text-xs font-bold uppercase tracking-wider text-foreground/75 transition-colors hover:text-foreground"
                >
                  <span>{label}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${secCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              )

              // Wide sidebar: an inline accordion panel that animates open/closed
              // (grid-rows 0fr→1fr, so no fixed height needed). Accordion — only
              // one section is open at a time.
              return (
                <div key={section.labelKey}>
                  {header}
                  <div
                    aria-hidden={secCollapsed}
                    className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                      secCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="space-y-0.5 pt-0.5">{rows}</div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* The plugin-catalogue link that used to sit here moved to the
                utility icon row at the top (EXPLORE_PLUGINS_ITEM). At the foot of
                the features group it was below everything already installed —
                the least visible spot for the thing that reveals the rest of the
                product. */}
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
  // Counts client-side navigations so detail pages' "Back" can step back
  // through history instead of jumping to a hardcoded parent list. Must be
  // mounted exactly once, above every page that uses `useBack`.
  useTrackNavigationDepth()
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
        <OpenTabsProvider>
        <ProductTour />
        {/* Owns every floating control's position — page FABs and shell overlays
            declare a lane instead of hardcoding a corner (see FloatingDock). */}
        <FloatingDock>
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
            <OpenTabsStrip />
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
          {/* In-app feedback — self-gates on the ops-controlled global flag. */}
          <FeedbackLauncher />
        </div>
        </FloatingDock>
        </OpenTabsProvider>
      </UpgradeModalProvider>
    </NavPinsProvider>
  )
}
