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
import { TeamDeletionBanner } from '@/components/layout/TeamDeletionBanner'
import { UserMenu } from '@/components/layout/UserMenu'
import { TeamQrButton } from '@/components/layout/TeamQrButton'
import {
  LayoutDashboard,
  Users,
  Calendar,
  ClipboardList,
  ClipboardCheck,
  Globe,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Lock,
  Puzzle,
  GraduationCap,
  Settings,
  HelpCircle,
  X,
  Workflow,
  Zap,
  Package,
  IdCard,
  BadgeCheck,
  FileText,
  DoorOpen,
  UserCog,
  Star,
  Pin,
  Activity,
  Tag,
  TrendingUp,
  Search,
  Calculator,
  Ticket,
  MapPin,
  LayoutTemplate,
  Plus,
  Check,
  MoreHorizontal,
} from 'lucide-react'
import { Eraser } from 'lucide-react'
import type { Route } from 'next'
import { pluginAccessForPlan, type Contact, type PluginAccess, type SaasPlan } from '@linyup/shared'
import { usePlan } from '@/hooks/usePlan'
import { usePlanName } from '@/hooks/usePlanName'
import { useCapabilities } from '@/hooks/useCapabilities'
import { useUpgradeModal, UpgradeModalProvider } from '@/contexts/UpgradeModalContext'
import { NavPinsProvider, useNavPins } from '@/contexts/NavPinsContext'
import { useAffiliationTerm } from '@/hooks/useAffiliationTerm'
import { OpenTabsProvider, useOpenTabs } from '@/contexts/OpenTabsContext'
import { normalizeTabPath } from '@/lib/tab-routes'
import { RecentContactsProvider, useRecentContacts } from '@/contexts/RecentContactsContext'
import { OpenTabsStrip } from '@/components/layout/OpenTabsStrip'
import { SETTINGS_ITEMS, type SettingsNavItem } from '@/lib/settings-nav'
import { ORG_NAV_ITEMS, ORG_RAIL_ITEMS, orgHref } from '@/lib/org-nav'
import { ScopeProvider, useScope } from '@/contexts/ScopeContext'
import { ScopeFlip, ScopeFlipShortcut } from '@/components/layout/ScopeFlip'
import { useActiveContacts } from '@/hooks/useActiveContacts'
import { useArchivedContacts } from '@/hooks/useArchivedContacts'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { useActivities } from '@/hooks/useActivities'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useHasByoGateway } from '@/hooks/useConnect'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Logo } from '@/components/Logo'
import { FreeDowngradeBanner } from '@/components/onboarding/FreeDowngradeBanner'
import { VerifyEmailBanner } from '@/components/onboarding/VerifyEmailBanner'
import { SetupGuide } from '@/components/onboarding/SetupGuide'
import AssistantLauncher from '@/plugins/ai-assistant/AssistantPanel'
import FeedbackLauncher from '@/components/feedback/FeedbackLauncher'
import { FloatingDock } from '@/components/layout/FloatingDock'
import { PLUGIN_ICON_MAP } from '@/plugins/icons'

// Icons referenced by string name in plugin manifest navContributions resolve
// through the ONE map in @/plugins/icons — this file used to keep its own, and
// the three copies had already drifted (see that file's header).

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
  // Only shown when the named plugin is installed (e.g. online-courses, products).
  requiresPlugin?: string
  // Hidden entirely unless the team's plan is at least this tier. Distinct from
  // minPlan, which keeps the item visible but locked with an upgrade prompt.
  requiresPlan?: SaasPlan
  // Active only on an exact path match (not prefix) — for hub routes like
  // /plugins whose children (/plugins/website, …) have their own nav items.
  exact?: boolean
  /** Opt in to a label the STUDIO chose rather than one we translate. Only
   *  'affiliationTerm' today: an org configures what an affiliation is called
   *  ("Lizenz", "Membership"), the roster page already titles itself with that
   *  word, and a nav row reading "Affiliations" beside it would be the product
   *  disagreeing with itself. Resolved ONCE in SidebarContent and applied to
   *  both the row and the search catalogue, so the two cannot diverge. */
  dynamicLabel?: 'affiliationTerm'
}

type NavSection = { labelKey: string; icon: React.ElementType; items: NavItem[] }

// ── THE HEAD ROW ─────────────────────────────────────────────────────────────
// Two tiles at the top of the nav: Dashboard, then one destination the studio
// chooses (see `HeadTiles`). Giving the head of the nav a different shape from
// its body is what makes them findable without reading.
//
// Dashboard is the fixed one and is declared here because it is not a section
// row and never has been. SCHEDULE_ITEM is declared here too but is rendered
// FROM `NAV_SECTIONS` — it is Run's first item, and the head tile it fills by
// default reaches it the same way every other shortcut does, through the
// catalogue. Declaring it once here and referencing it there keeps one
// definition of the id, href and icon.
const DASHBOARD_ITEM: NavItem = {
  id: 'dashboard',
  href: '/dashboard',
  labelKey: 'dashboard',
  icon: LayoutDashboard,
  // `/dashboard` used to be special-cased BY HREF inside the active-state test,
  // so the second dashboard at /dashboard/preview could not light this row up.
  // That route is now a redirect and the rule belongs on the item, not in a
  // generic component that had one destination's path written into it.
  exact: true,
}
const SCHEDULE_ITEM: NavItem = {
  id: 'calendar',
  href: '/schedule',
  labelKey: 'calendar',
  icon: Calendar,
}

/**
 * Is this row the page we are on? Prefix match, so `/schedule/places` keeps the
 * Schedule row lit, unless the item asks for an exact one. Shared by the full
 * rows and the head tiles — two answers to "am I here" is how a nav ends up
 * highlighting two places at once.
 */
function navItemIsActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href)
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
      // Schedule KEEPS ITS HOME ROW even though it is also the default head
      // tile. A tile is a shortcut, and a shortcut has always been a duplicate
      // of a row that exists elsewhere — pinning Contacts shows it in Shortcuts
      // AND in Run. It briefly lived only as a tile, back when that tile was
      // fixed; now that a studio can swap it out, removing the tile would have
      // deleted the destination from the nav altogether and left it reachable
      // only through search.
      SCHEDULE_ITEM,
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
      // PAYMENTS AND SUBSCRIPTIONS ARE ONE DESTINATION. The member roster used
      // to be its own page and briefly its own nav row; it is a tab here now,
      // because "who is paying me" and "who holds a plan" are the same question
      // asked twice and a studio should not have to guess which screen answers
      // it (Franco, 2026-08-23). `/subscriptions` redirects in.
      {
        id: 'payments',
        href: '/payments',
        labelKey: 'paymentsAndSubscriptions',
        icon: Wallet,
      },
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
      // Subscriptions only. This was an umbrella ("Plans & Affiliations") whose
      // second tab held the affiliation TYPES while the roster below had no nav
      // item at all; the roster now owns both, so the umbrella is gone and the
      // route id stays `plans` only because the href does. On every plan, so
      // never gated.
      // "Subscriptions" named the wrong thing: it reads as the list of
      // subscriptions people HOLD, which is `/subscriptions` — a different page
      // entirely. This one is the catalogue of plans on sale.
      { id: 'plans', href: '/offer/plans', labelKey: 'subscriptionPlans', icon: IdCard },
      // The affiliation ROSTER — who is affiliated, at what status, expiring when.
      // It had no nav item at all: reachable only from a link inside the types
      // manager and one dashboard figure, which is the same shape UX-99 fixed
      // elsewhere. The types themselves are set-up and live behind "Manage
      // types" on this page rather than earning a second destination.
      {
        id: 'affiliations',
        href: '/affiliations',
        labelKey: 'affiliations',
        icon: BadgeCheck,
        dynamicLabel: 'affiliationTerm',
        // Affiliations are an ORG concept — the statuses live on the
        // organization and the roster refuses outright for a team without one
        // ("This team is not part of an organisation"). Showing the item to
        // every studio would put a nav row in front of a page whose whole
        // content is an explanation that it does not apply.
        requiresOrg: true,
      },
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
      {/* Filled while ON — an icon that only changes opacity reads as "hovered",
          not as "this is switched on", which is the state that matters here.
          A PIN, deliberately, and NOT the star used a few hundred lines below for
          "recommended by Linyup": one glyph cannot carry an endorsement and a
          personal choice. UX-23 moved away from "pin" when the word meant THREE
          things — shortcuts, open tabs, and a saved filter "pinned to the filter
          bar". That third is now "show in filter bar", so what remains is one
          mental model (keep this within reach) over two different objects on two
          different surfaces, which is what a pin means everywhere else. */}
      <Pin className={`h-3.5 w-3.5 ${shown ? 'fill-current' : ''}`} />
    </button>
  )
}

function NavLink({
  item,
  collapsed,
  onClick,
  shortcutId,
  label: labelOverride,
}: {
  item: NavItem
  collapsed: boolean
  onClick?: () => void
  // When set (and the sidebar is expanded), a hover "always show" toggle is
  // shown that adds this destination to the Shortcuts group.
  shortcutId?: string
  /** Pre-resolved label, for items whose name the STUDIO chose (see
   *  NavItem.dynamicLabel). Absent ⇒ translated from `labelKey` as usual. */
  label?: string
}) {
  const pathname = usePathname()
  const t = useTranslations('Nav')
  const { isAtLeast } = usePlan()
  const { openUpgradeModal } = useUpgradeModal()
  const Icon = item.icon
  const label = labelOverride ?? t(item.labelKey as Parameters<typeof t>[0])

  const isLocked = !!item.minPlan && !isAtLeast(item.minPlan)

  const isActive = !isLocked && navItemIsActive(item, pathname)

  if (isLocked) {
    return (
      <button
        type="button"
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

/**
 * The head-pair tile: icon over label, sized to sit two-across.
 *
 * Same active vocabulary as NavLink — `bg-primary/10 text-primary font-semibold`
 * — minus its 3px inset left bar. That bar marks a row in a list by its leading
 * edge; on a tile it reads as a stray rule down one side, and the tint alone
 * already carries the state.
 *
 * The icon steps up to `h-5 w-5`. At `h-4` it looks like a row icon that has
 * lost its label rather than the subject of the tile, which is the whole reason
 * this shape exists.
 *
 * NO LOCKED VARIANT, deliberately: neither of the two head items carries a
 * `minPlan`, and writing an upgrade path for a case that cannot occur is a
 * branch nothing would ever exercise. If a gated destination is ever promoted
 * up here, take NavLink's locked button and give it this geometry.
 */
function NavTile({
  href,
  label,
  icon: Icon,
  exact,
  onClick,
  children,
}: {
  href: string
  /** Already translated — a tile is fed either a NavItem's labelKey resolved by
   *  the caller, or a catalogue entry whose label was resolved when it was
   *  built (plugin rows use a different namespace, which is why the catalogue
   *  pre-translates). */
  label: string
  icon: React.ElementType
  exact?: boolean
  onClick?: () => void
  /** The edit affordance on an adjustable tile. Rendered as a sibling overlay so
   *  it is not inside the <Link> — a button inside an anchor is invalid, and
   *  clicking it must not navigate. */
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  const isActive = navItemIsActive({ href, exact } as NavItem, pathname)

  return (
    <div className="group/tile relative">
      <Link
        href={href as Route}
        onClick={onClick}
        title={label}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-3 text-center text-xs transition-all ${
          isActive
            ? 'bg-primary/10 text-primary font-semibold'
            : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
      >
        <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary' : ''}`} />
        <span className="w-full truncate leading-none">{label}</span>
      </Link>
      {children}
    </div>
  )
}

// A compact icon-only link for the utility destinations (plugins, settings,
// how-to) that sit in their own row under the search bar rather than in the nav
// list. Always shows its label as a tooltip, since there's no text beside the
// icon.
function UtilityIconLink({
  item,
  onClick,
  showLabel,
}: {
  item: NavItem
  onClick?: () => void
  /** Inside the utilities menu, where there is room for a name. A bare icon is
   *  right on a rail, where the tooltip is the contract; inside an opened menu
   *  it makes the reader hover four things to find one. */
  showLabel?: boolean
}) {
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
      className={`flex h-8 items-center rounded-lg transition-colors ${
        showLabel ? 'w-full gap-2 px-2 text-sm' : 'w-8 justify-center'
      } ${
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {showLabel && <span className="truncate">{label}</span>}
    </Link>
  )
}

/**
 * The occasional utilities — Plugins, Settings, How-to, plus the studio QR when
 * the sidebar is collapsed — behind ONE "⋯" control. Used in BOTH modes.
 *
 * WHY IT EXISTS: collapsed, the icons stack vertically and cost ~144px, which
 * put Dashboard 36% of the way down a 720px rail with five occasional
 * destinations above it — a hierarchy inversion produced by the collapse rather
 * than by any decision. Expanded, space was never the problem; attention was.
 * They sat permanently beside the search field, at the top of the pane, ahead of
 * the working areas a studio actually opens (see the utility row for the rest).
 *
 * ONE SHAPE IN BOTH MODES — a labelled column. The panel used to repeat the
 * expanded layout (a horizontal icon strip) because the expanded row WAS the
 * canonical form; now that the row is this control in both modes there is no
 * second form to mirror, and inside an opened menu a name beats a tooltip.
 *
 * Search is deliberately NOT in here: it is a primary action with a keyboard
 * shortcut, not an occasional destination.
 */
function UtilityFlyout({
  onLinkClick,
  includeQr,
}: {
  onLinkClick?: () => void
  /**
   * COLLAPSED ONLY. Expanded, the QR sits on the studio-name row above, because
   * it encodes THAT studio's links — listing it here as well would put one
   * control in two places on the same screen. Collapsed there is no studio row
   * (no text at w-14), so the menu is where it lives.
   */
  includeQr?: boolean
}) {
  const t = useTranslations('Nav')
  const label = t('utilities')
  // THE ROW FOLLOWS THE SCOPE. These three destinations were hardcoded studio
  // paths, so in org scope "All settings" and "Explore plugins" walked the
  // reader straight out of the organisation and into the studio's settings —
  // silently, because both screens look plausible on arrival. An organisation
  // has its own of each; How-to is the product's help and belongs to neither.
  //
  // The QR is studio-only for the same reason and is not swapped: it encodes a
  // STUDIO's public links, and there is no org equivalent to put in its place.
  const { current: scope } = useScope()
  const orgId = scope?.kind === 'org' ? scope.id : null
  const settingsItem: NavItem = orgId
    ? { ...ALL_SETTINGS_ITEM, href: orgHref(orgId, 'settings') }
    : ALL_SETTINGS_ITEM
  const pluginsItem: NavItem = orgId
    ? { ...EXPLORE_PLUGINS_ITEM, href: orgHref(orgId, 'plugins') }
    : EXPLORE_PLUGINS_ITEM
  return (
    <NavFlyout
      label={label}
      trigger={
        <button
          type="button"
          title={label}
          aria-label={label}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4 shrink-0" />
        </button>
      }
    >
      {/* A labelled column, not the icon strip this used to be: once the menu is
          open there is room for names, and the same shape serves both modes. */}
      <div className="flex min-w-40 flex-col gap-0.5">
        {includeQr && !orgId && <TeamQrButton showLabel />}
        <UtilityIconLink item={pluginsItem} onClick={onLinkClick} showLabel />
        <UtilityIconLink item={settingsItem} onClick={onLinkClick} showLabel />
        <UtilityIconLink item={HOW_TO_ITEM} onClick={onLinkClick} showLabel />
      </div>
    </NavFlyout>
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

/**
 * THE ORGANISATION'S OWN SIDEBAR ROWS, rendered INSTEAD of the studio's when the
 * URL is in org scope.
 *
 * This replaced an "Organizations" GROUP that listed each org as one more row
 * beside the studio's own sections. That was the ambiguity the scope model
 * exists to remove: an org has an Events, a Places, a Website, a Plugins, a
 * Members and a Settings, and so does a studio, so two rows carrying the same
 * word never stop needing a second look. Standing in one scope at a time means
 * the word is never ambiguous — you are somewhere, and the indicator says where.
 *
 * The catalogue is lib/org-nav.ts; the switcher is how you get here.
 */
function OrgNavRows({
  orgId,
  collapsed,
  onLinkClick,
}: {
  orgId: string
  collapsed: boolean
  onLinkClick?: () => void
}) {
  const t = useTranslations('Org')
  const pathname = usePathname()

  return (
    <div className="mt-3 pt-3">
      <div className={collapsed ? 'space-y-1' : 'space-y-0.5'}>
        {ORG_NAV_ITEMS.map((item) => {
          const href = orgHref(orgId, item.path)
          const isActive = pathname === href || pathname.startsWith(href + '/')
          const Icon = item.icon
          const label = t(item.labelKey as Parameters<typeof t>[0])
          return (
            <Link
              key={item.id}
              href={href as Route}
              onClick={onLinkClick}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_var(--color-primary)]'
                  : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
              } ${collapsed ? 'justify-center px-2' : ''}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
              {!collapsed && <span className="truncate">{label}</span>}
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
  const Icon = PLUGIN_ICON_MAP[nav.icon] ?? Puzzle
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

/**
 * THE HEAD ROW — Dashboard, and one tile the studio sets.
 *
 * ── IT IS ITS OWN SETTING, NOT THE TOP OF THE SHORTCUTS LIST ─────────────────
 * The tile was first built as "the first always-shown shortcut, promoted". That
 * stored nothing new, which is why it was tried, and it was wrong: pinning a
 * shortcut or dragging the pinned run reordered the head tile as a side effect.
 * A list you curate and a slot you set once are different controls, and fusing
 * them means the fixed part of the nav is not fixed. It now has its own single
 * value — census item 5 in `contexts/NavPinsContext.tsx`, which owns the storage
 * and the absent-vs-cleared rule.
 *
 * A destination may be both the head tile and a shortcut. That duplicate is
 * asked for twice and is not deduplicated: silently hiding a row because it
 * happens to match the tile would make the Shortcuts group lie about its
 * contents.
 *
 * ── WHY DASHBOARD IS NOT ADJUSTABLE ─────────────────────────────────────────
 * It is where the product starts, and a nav whose first tile can be swapped away
 * has no fixed point to navigate from.
 *
 * ── THE EMPTY SLOT IS A CONTROL, NOT A GAP ──────────────────────────────────
 * Cleared, the second slot renders as a dashed "+" rather than letting Dashboard
 * span the row. A head row that changes shape depending on whether it is
 * configured makes the one fixed tile move under the cursor, and the placeholder
 * is the only thing that says the slot can be filled again.
 */
function HeadTiles({
  tile,
  choices,
  onSet,
  onClear,
  onLinkClick,
}: {
  /** The chosen destination, or undefined when cleared (or gated out of view). */
  tile: ResolvedNavEntry | undefined
  /** Everything the tile may be set to (the visible catalogue). */
  choices: ResolvedNavEntry[]
  onSet: (id: string) => void
  onClear: () => void
  onLinkClick?: () => void
}) {
  const t = useTranslations('Nav')

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <NavTile
        href={DASHBOARD_ITEM.href}
        label={t(DASHBOARD_ITEM.labelKey as Parameters<typeof t>[0])}
        icon={DASHBOARD_ITEM.icon}
        exact={DASHBOARD_ITEM.exact}
        onClick={onLinkClick}
      />
      {tile ? (
        <NavTile
          href={tile.href}
          label={tile.label}
          icon={tile.icon}
          exact={tile.exact}
          onClick={onLinkClick}
        >
          <HeadTilePicker
            choices={choices}
            currentId={tile.id}
            onPick={onSet}
            onClear={onClear}
            trigger={
              // Hover-revealed on a pointer device, always present for touch
              // (where there is no hover and an invisible control is no
              // control). Tiny and cornered so it never crowds the label.
              <button
                type="button"
                aria-label={t('headTileChange')}
                className="absolute right-0.5 top-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/tile:opacity-100 max-md:opacity-60"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            }
          />
        </NavTile>
      ) : (
        <HeadTilePicker
          choices={choices}
          currentId={null}
          onPick={onSet}
          trigger={
            <button
              type="button"
              aria-label={t('headTileAdd')}
              title={t('headTileAdd')}
              className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input px-2 py-3 text-center text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-5 w-5 shrink-0" />
              <span className="w-full truncate leading-none">{t('headTileAddShort')}</span>
            </button>
          }
        />
      )}
    </div>
  )
}

/** The destination chooser behind a tile's control. Reuses the sidebar's own
 *  catalogue, so a tile can be set to anything the nav can reach — including
 *  settings screens and plugin pages. */
function HeadTilePicker({
  choices,
  currentId,
  onPick,
  onClear,
  trigger,
}: {
  choices: ResolvedNavEntry[]
  currentId: string | null
  onPick: (id: string) => void
  onClear?: () => void
  trigger: React.ReactElement
}) {
  const t = useTranslations('Nav')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = q ? choices.filter((c) => c.label.toLowerCase().includes(q)) : choices

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setQuery('')
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-60 p-0">
        <div className="border-b p-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('headTileSearch')}
            autoFocus
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {visible.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t('headTileNoMatch')}
            </p>
          )}
          {visible.map((c) => {
            const Icon = c.icon
            const isCurrent = c.id === currentId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onPick(c.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isCurrent ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>
        {onClear && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4 shrink-0" />
              {t('headTileRemove')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
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

// Marks the whole Shortcuts area as a region: a thin, flat, brand-violet rule
// down its left edge, spanning the group heading, both runs and the empty-state
// hint.
//
// IT MUST NOT CONSUME LAYOUT WIDTH, and it must not push the rows. The original
// marker was a `before:` pseudo-element on a `pl-3` wrapper, which is the half of
// it that had to go: the padding it needed pushed every shortcut row 12px right
// of every other nav row. This is an absolutely-positioned sibling instead, so
// every nav link in the sidebar — shortcuts and features alike — reports the same
// 8px left offset (measured live, 19 rows, one value).
//
// THE GAP COMES OUT OF THE GUTTER, NEVER OUT OF THE ROWS. An active or hovered
// row paints a background from its own left edge, which is the nav's CONTENT edge
// at 8px — the same place the rule sat, so the two touched. Indenting the rows to
// separate them would undo the paragraph above, so the rule moves the other way
// instead: `-left-1` puts it at 4px, inside `nav`'s own `px-2` padding, ~3px clear
// of any row background and ~4px clear of the sidebar edge — near enough centred
// in the gutter.
//
// That negative offset is SAFE against the scroll container, which is the thing to
// check rather than assume: `nav` is `overflow-y-auto`, so its other axis computes
// non-visible too, and it clips at its PADDING box — x ≥ 0. The rule lives at
// x = 4–5, inside that padding, so it is neither clipped nor scrollable-overflow,
// and contributes no horizontal scrollbar. Anything that moves it further left
// than -8px (`-left-2`) crosses the padding box and WILL be clipped.
//
// `z-10` because a row wrapper is `relative`, so its hover background would
// otherwise paint over a rule that is merely earlier in the DOM.
//
// FLAT AND FULL STRENGTH — no gradient, no ramp, no alpha. A tint that faded along
// its length was tried here (as a left-edge rule, then as a horizontal background
// wash across the whole area) and rejected both times: the wash grew with the list
// and read as a highlight rather than a boundary. The alpha went with the width:
// at 2px, primary/70 (2.94:1 light / 3.97:1 dark against the sidebar) held it back
// from shouting; at 1px there is half the ink to begin with, so full primary
// (4.88:1 / 6.89:1) is what keeps a hairline present at a glance — and it still
// lays down less violet than the 2px line it replaces.
const SHORTCUTS_RULE =
  'pointer-events-none absolute inset-y-0 -left-1 z-10 w-px rounded-full bg-primary'

// How many recently-visited items the Shortcuts group keeps, in addition to the
// pinned ones.
const MAX_RECENT_SHORTCUTS = 5
// Rows the group aims to show before "Show more". Pinned rows are never
// truncated, so the budget is spent on them first and whatever is left goes to
// the recent run.
const SHORTCUTS_VISIBLE_MIN = 5
// ...but the recent run never drops below this while it has rows. A heavy pinner
// would otherwise spend the whole budget and push recents to zero, leaving "Show
// more" as the only evidence that half exists — and with no divider drawn any
// more, a run that renders nothing is a run that is simply gone.
const RECENT_VISIBLE_MIN = 2

// The "Shortcuts" macro group — Firebase-style: the destinations a studio keeps
// within reach, held as TWO RUNS of ONE mechanism (item 1 of THE NAV-MEMORY
// CENSUS in contexts/NavPinsContext.tsx):
//   · pinned — hand-curated, drag-orderable, never truncated, never ages out.
//   · recent — the rolling visit history, truncated behind "Show more".
// The pin on a row PROMOTES a recent into the pinned run (and, turned off,
// demotes it back); the X removes the row from the group entirely.
//
// NOTHING HARD SEPARATES THE TWO RUNS — no headings, no divider. Three signals
// carry it instead, and every one of them was already there:
//   1. ORDER. Pinned first, always. `entries` arrives pre-merged that way.
//   2. THE PIN ITSELF. A pinned row's pin is filled and visible at rest; a recent
//      row's only appears on hover. Two adjacent rows are tellable apart without
//      reading anything.
//   3. THE MOVE. Pinning re-renders the row at the end of the pinned run, so a
//      promotion is seen happening. With no line to cross, that motion is now the
//      whole story — which is why `pinned`/`recents` must stay derived from
//      `alwaysShownIds` on every render rather than snapshotted.
// A divider and two labels were both tried here first (2026-08-18) and both lost
// to the same objection: they restate what the rows already say, and they compete
// with the left rule for the one job of marking this area out.
//
// SHORTCUTS_RULE marks the region instead — see its comment for why it is
// absolutely positioned and for the measured values. It covers the whole group,
// empty state included: a region that stopped being marked exactly when the hint
// explaining it appears would be marking the wrong thing. Expanded sidebar only.
// Hidden entirely when there is nothing at all. Per-browser (NavPinsContext).
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
  // Insertion index (within the PINNED list) the dragged row would drop into.
  const [dropAt, setDropAt] = useState<number | null>(null)

  // Keep the group visible even when empty (expanded sidebar only) — a short
  // muted hint explains how it fills up. The icon rail just skips it.
  if (entries.length === 0) {
    if (collapsed) return null
    return (
      <div className="relative mt-3 py-1">
        <div aria-hidden className={SHORTCUTS_RULE} />
        <GroupLabel>{t('navGroupShortcuts')}</GroupLabel>
        <p className="px-3 py-1 pr-2 text-xs leading-relaxed text-muted-foreground/60">
          {t('navShortcutsEmpty')}
        </p>
      </div>
    )
  }

  // `entries` arrives merged (pinned first, then recents) — split it back into
  // the two runs it was built from, DERIVED every render so a pin moves the row
  // immediately (see signal 3 above). The icon rail renders the same rows in the
  // same order.
  const pinned = entries.filter((e) => alwaysShownIds.includes(e.id))
  const recents = entries.filter((e) => !alwaysShownIds.includes(e.id))
  const recentVisible = Math.max(RECENT_VISIBLE_MIN, SHORTCUTS_VISIBLE_MIN - pinned.length)
  const shownRecents = expanded ? recents : recents.slice(0, recentVisible)
  const hasMore = recents.length > recentVisible

  // Drag is PINNED-ONLY, deliberately, and it now only ever REORDERS:
  //  · Recent is ordered by when you were last there. A manual placement inside
  //    it cannot be stored and would be undone by the next navigation — a drag
  //    that silently does nothing, which is worse than one that isn't offered.
  //  · Dragging ACROSS the boundary to promote is not offered either. Promotion
  //    has one affordance — the pin: hoverable, labelled, keyboard-reachable and
  //    reversible. A second, invisible path that promotes on an accidental drop
  //    adds no discoverability and one more way to be surprised.
  const commitDrop = () => {
    if (dragId != null && dropAt != null) {
      const visible = pinned.map((e) => e.id)
      const from = visible.indexOf(dragId)
      // dropAt === from | from + 1 is a drop onto itself: nothing moves.
      if (from !== -1 && dropAt !== from && dropAt !== from + 1) {
        // Reorder inside the STORED list, not the displayed one: a pinned id
        // whose destination is currently gated off is invisible here and must
        // survive the reorder rather than be silently dropped from storage.
        const rest = alwaysShownIds.filter((id) => id !== dragId)
        const anchor = visible[dropAt]
        const at = anchor
          ? rest.indexOf(anchor) // insert BEFORE the row dropped onto…
          : rest.indexOf(visible[visible.length - 1]) + 1 // …or after the last one
        rest.splice(at < 0 ? rest.length : at, 0, dragId)
        setShortcutOrder(rest)
      }
    }
    setDragId(null)
    setDropAt(null)
  }

  const dragPropsFor = (entry: ResolvedNavEntry, idx: number): ShortcutDragProps => ({
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
  })

  const dropLine = <div className="mx-2 my-0.5 h-0.5 rounded bg-primary/60" />

  return (
    <div className={collapsed ? 'mt-3 pt-3' : 'relative mt-3 py-1'}>
      {/* Expanded only: a hairline beside a 40px icon rail marks nothing. */}
      {!collapsed && <div aria-hidden className={SHORTCUTS_RULE} />}
      {/* Header row: the group label, with "clear all" pushed to the right.
          Confirmed, because the pinned rows are hand-curated and drag-ordered —
          rebuilding them is minutes of fiddling, and there is no undo. It clears
          BOTH runs, which is why it hangs off the group heading — there is no
          second heading for it to belong to, and that is deliberate. */}
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
      <div className="space-y-0.5">
        {pinned.map((entry, idx) => (
          <div key={entry.id}>
            {!collapsed && dragId != null && dropAt === idx && dropLine}
            <ShortcutRow
              entry={entry}
              collapsed={collapsed}
              onClick={onLinkClick}
              dragging={dragId === entry.id}
              dragProps={collapsed ? undefined : dragPropsFor(entry, idx)}
            />
          </div>
        ))}
        {!collapsed && dragId != null && dropAt === pinned.length && dropLine}
        {shownRecents.map((entry) => (
          <ShortcutRow key={entry.id} entry={entry} collapsed={collapsed} onClick={onLinkClick} />
        ))}
        {/* Show more belongs to Recent — it is the only half that truncates. */}
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
  // A STATE the row's record is in, not a category: "Archived". Rendered as a
  // chip because the difference has to survive a glance — a result you can open
  // but must not book or message reads identically to any other without it.
  badge?: string
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
  const { tabs, newTab, switchTab, enabled: tabsEnabled } = useOpenTabs()
  const { isAlwaysShown, toggleAlwaysShown } = useNavPins()
  // The people you just had open — the panel's empty state, replaced by results
  // the moment anything is typed. See the nav-memory census in NavPinsContext.
  const { recentContactIds } = useRecentContacts()
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
  // The recently-viewed rows are stored as IDS, so the roster is what turns them
  // into names — which means the CONTACT lists (and only those: not the
  // subscription types, not the activities) also arm when the panel opens with a
  // history to show. It is the same one-per-session read typing would trigger a
  // moment later, on the same shared cache entry, and the alternative — storing
  // names — is stale the first time somebody is renamed.
  const contactsTeamId =
    armed || (expanded && recentContactIds.length > 0) ? currentTeamId : null
  const { data: contacts = [], isFetching: contactsFetching } = useActiveContacts(
    contactsTeamId,
    scopeUid
  )
  // ARCHIVED TOO — a former member is exactly who you look up when they come
  // back or ask about an old payment, and until now searching for them returned
  // nothing at all (UX-21). It is a SECOND query, not a widened first one: the
  // pickers, the roster and the dashboard all read `useActiveContacts` for its
  // meaning. One extra read per panel session, on the same latch as the others,
  // and it shares its cache entry with the contacts page's Archived tab.
  //
  // DELETED CONTACTS ARE NOT SEARCHED, and that is the decision rather than an
  // omission: someone asked to be removed, and a search box that still finds
  // them works against the request. They remain reachable from the Contacts
  // page's own Deleted tab, where restoring is the deliberate act it should be.
  //
  // Own-scoped coaches get no archived results — the broad query is denied for
  // them by the rules (see the hook), so `null` here is the same answer the
  // contacts page gives by hiding the tab.
  const { data: archivedContacts = [], isFetching: archivedFetching } = useArchivedContacts(
    scopeUid ? null : contactsTeamId
  )
  const { data: subscriptionTypes = [], isFetching: subsFetching } =
    useSubscriptionTypes(entityTeamId)
  const { data: activities = [], isFetching: activitiesFetching } = useActivities(entityTeamId)
  const entitiesFetching =
    contactsFetching || archivedFetching || subsFetching || activitiesFetching

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
    sublabel?: string,
    badge?: string
  ): SearchEntry => ({
    id, href, label, icon, keywords: '', canShortcut: false, kind, sublabel, badge,
  })

  // A contact has a record of its own to open. A subscription type and an
  // activity do not — they are edited in a dialog on the page that lists them —
  // so those results land on that page rather than inventing a route.
  const contactMatches = (c: Contact) =>
    matches(`${c.firstname ?? ''} ${c.lastname ?? ''}`, c.email, c.phone)
  const contactRow = (c: Contact, badge?: string) =>
    entityRow(
      `contact:${c.id}`,
      `/contacts/${c.id}`,
      `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim() || (c.email ?? c.id),
      Users,
      'contact',
      c.email ?? undefined,
      badge
    )
  // Active first and archived after, each capped separately rather than sharing
  // one cap: a studio with six matching current members would otherwise never
  // see the former one they are actually looking for. The archived rows carry a
  // badge — an unmarked result is one somebody messages or books by mistake.
  const contactResults: SearchEntry[] = q
    ? [
        ...contacts.filter(contactMatches).slice(0, 6).map((c) => contactRow(c)),
        ...archivedContacts
          .filter(contactMatches)
          .slice(0, 3)
          .map((c) => contactRow(c, t('navSearchArchivedBadge'))),
      ]
    : []
  // RECENTLY VIEWED CONTACTS — the empty state, resolved from the same two
  // rosters the results use, through the same `contactRow`, so an archived
  // person carries the SAME amber badge here as they do in a result. Two
  // renderings of one fact that disagreed would be worse than not showing it.
  //
  // AN ID THAT DOES NOT RESOLVE IS DROPPED, silently and only from the display:
  // a deleted contact leaves no blank row, and a roster still in flight simply
  // shows fewer rows for a moment rather than pruning a list it cannot yet see.
  const recentContactRows: SearchEntry[] = recentContactIds
    .map((id) => {
      const activeMatch = contacts.find((c) => c.id === id)
      if (activeMatch) return contactRow(activeMatch)
      const archivedMatch = archivedContacts.find((c) => c.id === id)
      return archivedMatch ? contactRow(archivedMatch, t('navSearchArchivedBadge')) : null
    })
    .filter((row): row is SearchEntry => !!row)

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

  // Keyboard selection indexes the FLATTENED result order, so it keeps working
  // when later providers append their own groups — the visual grouping and the
  // arrow-key order must not diverge.
  //
  // Before anything is typed the recently-viewed rows ARE that list: ⌘K, ↓, ↵
  // reaches the person you just had open without touching the mouse, which is
  // most of the point of remembering them at all.
  const flat = showResults ? groups.flatMap((g) => g.results) : recentContactRows
  const active = flat[activeIndex]
  // One selectable list, whichever of the two is on screen.
  const listOpen = showResults || recentContactRows.length > 0

  // A new query is a new result set; an index carried over from the old one
  // would highlight an unrelated row (or nothing).
  useEffect(() => {
    setActiveIndex(0)
  }, [q])

  // Keep the highlighted row visible in the scrollable dropdown.
  useEffect(() => {
    if (!listOpen) return
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [listOpen, activeIndex])

  // Close when clicking anywhere outside the panel. Keyed on `expanded`, not on
  // `listOpen`: the panel is dismissible while it is still empty, which is
  // exactly when a user who opened it by accident wants out.
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

  // Opens the entry in a tab AND GOES THERE — deliberately not the background
  // ctrl/⌘-click convention OpenTabsContext documents for links. A search result
  // is a destination the user just asked for by name; collecting it silently
  // behind the current page is the browser's answer to a different question.
  //
  // `newTab` activates but does not navigate (the strip only navigates on an
  // explicit click), so the push is required — without it the tab would be
  // active while the page stayed put. And `newTab` does not dedupe the way
  // `openInNewTab` does, so an entry already open is focused rather than
  // duplicated; otherwise searching twice for the same page would stack tabs.
  //
  // With the strip switched off (Settings → General) there is nowhere to put a
  // tab, so fall back to opening normally rather than no-op — a shortcut that
  // silently does nothing reads as broken.
  const openEntryAsTab = (entry: SearchEntry) => {
    if (!tabsEnabled) return openEntry(entry)
    const existing = tabs.find((tb) => normalizeTabPath(tb.href) === normalizeTabPath(entry.href))
    if (existing) switchTab(existing.tabId)
    else newTab(entry.href, entry.label)
    router.push(entry.href as Route)
    close()
    onNavigate?.()
  }

  // ONE row renderer for both lists — the typed results and the recently-viewed
  // empty state. Kept as a single function on purpose: the archived badge is the
  // marker that stops somebody messaging a former member by mistake, and two
  // copies of this markup would eventually disagree about it.
  const renderEntry = (entry: SearchEntry) => {
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
        {entry.badge && (
          <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {entry.badge}
          </span>
        )}
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
  }

  // The trigger — a MINI-INPUT, not a bare icon.
  //
  // It reads as a field so it says "you can search here", while costing a share
  // of one row instead of a whole one — which is what freed the space the studio
  // name now uses in the header. Clicking it opens the real input in an overlay;
  // because the two look alike, that reads as the field growing rather than a
  // different thing appearing.
  //
  // THE BOX IS BORROWED FROM `components/ui/input.tsx`, not invented: same h-8,
  // same rounded-lg, same `border-input`, same `dark:bg-input/30` fill, same
  // `focus-visible` ring. The panel animates OUT OF this trigger, so a shape of
  // its own would break the one illusion the whole control depends on. Before
  // this it wore a transparent bottom border that only appeared on hover — at
  // rest there was no box at all, and nothing said it was a place you can type.
  //
  // IT IS FILLED IN LIGHT MODE, which is the one place it departs from Input, and
  // the numbers say why. Against the sidebar (--sidebar, #f5f5fa) the shared
  // `border-input` measures 1.23:1 — WCAG 1.4.11 asks 3:1 of a component boundary,
  // and no tasteful fill can close that gap either: an OPAQUE `bg-muted` is
  // 1.05:1 and opaque `bg-accent` 1.09:1, so 3:1 would take a violet block. The
  // boundary is not where this control's identity lives, though — its icon is
  // 4.88:1 against the sidebar and its label 5.57:1, both well past 3:1, and the
  // focus ring is 4.88:1. So the fix here is perceptual, not compliance, and it
  // goes the other way: `bg-card` is pure white, 1.085:1 and ΔL* +3.3 ABOVE the
  // sidebar rather than below it. A white field on a tinted sidebar is the oldest
  // search pattern there is, it lifts the label to 6.04:1, and — because the
  // panel's own input sits on white `--popover` — the trigger is now literally the
  // same surface as the thing it grows into. Dark keeps `bg-input/30` (1.10:1,
  // already a legible plate) because there `bg-card` would be weaker at 1.05:1.
  //
  // It stays a <button>. The panel owns the real field; a second focusable input
  // in the sidebar would be two things that look typeable and one that is not.
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
        onClick={openPanel}
        title={`${t('navSearchPlaceholder')} (${modKeyLabel()}K)`}
        aria-label={t('navSearchPlaceholder')}
        className={
          collapsed
            ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            : // Hover lifts the border towards the ring colour rather than filling the
              // box — the fill is reserved for focus, which is the state a keyboard
              // user has to be able to find. focus-visible copies Input's ring
              // exactly (the old trigger had NO focus style at all: tabbing to it
              // showed nothing, because its only border was a hover border).
              'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-muted-foreground outline-none transition-colors hover:border-ring/50 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'
        }
      >
        {/* Primary, not inherited muted: search is the fastest route to anything
            in the app and the row is otherwise the quietest thing in the header.
            Deliberately NOT hover-linked — the colour is the prominence, so it
            holds at rest; the label beside it still lifts on hover. The colour
            token is theme-aware (the dark palette lightens --primary for exactly
            this), so it holds against both backgrounds. */}
        <Search className="h-4 w-4 shrink-0 text-primary" />
        {/* Placeholder only — still no ⌘K badge, but for a MEASURED reason now
            that this is a real box: it does not fit. At the DEFAULT rail width
            (240px, the old w-60) — minus the row's mx-2 and the three 32px icon
            buttons beside it — this field is ~116px, and minus px-2.5 + the 16px
            icon + its gap the label gets ~74px. "Search…" clears that;
            "Rechercher…", "Suchen…" and "Cerca…" do not once a badge takes ~17px
            more, so three locales out of four would ship a truncated placeholder
            to buy a hint that is already in the tooltip.
            The rail is drag-resizable as of 2026-08-24, so this is no longer a
            fixed constraint — it is the worst case across the range, which is
            the one that has to hold. A badge gated on the live width would show
            and hide itself as the rail moves; the tooltip says it at every
            width. */}
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
        // Grows out of the trigger, spilling a little into the content area.
        // Capped so it never runs off a narrow viewport.
        style={{ left: anchor.left, top: anchor.top }}
        // Grows out of the trigger: fades and scales up from 95%, sliding a few
        // pixels right so it reads as the mini-input opening rather than a
        // separate panel blinking into existence on top of it.
        className="fixed z-50 w-[min(22rem,calc(100vw-1rem))] origin-top-left animate-in fade-in-0 zoom-in-95 slide-in-from-left-2 duration-150 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
      >
      <div className="relative">
      {/* Full strength, not held back: a primary leading icon can read as a focus
          state on an idle field, but this field is never idle — the panel mounts
          it autoFocused and closes when it loses the mode, so "focused" is the
          only state it is ever seen in. Matches the trigger icon it grows out of. */}
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
      <Input
        // autoFocus, NOT a ref: the shared Input is a plain function component
        // with no forwardRef, so a ref on it is silently null and the panel
        // opened with nothing focused. The input mounts with the panel, so
        // autoFocus is both correct and simpler.
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls="nav-search-results"
        aria-activedescendant={listOpen && active ? `nav-search-opt-${active.id}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return close()
          if (!listOpen || flat.length === 0) return
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
        <>
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
          {/* WHO WAS I JUST LOOKING AT — the panel's answer before a question is
              asked. Contacts only: nav destinations are already the Shortcuts
              group in the sidebar, and this is the one thing neither that nor
              the tab strip can tell you (see the census in NavPinsContext).
              Rendered under the prompt, so the field → "type to search" reading
              of the panel is unchanged and this is an addition beneath it. It
              takes the same listbox id as the results — only ever one of the two
              is on screen, and the arrow keys drive whichever it is. */}
          {recentContactRows.length > 0 && (
            <div
              ref={listRef}
              id="nav-search-results"
              role="listbox"
              className="max-h-[50vh] overflow-y-auto border-t pt-1.5"
            >
              <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium text-muted-foreground/50">
                {t('navRecentContactsGroup')}
              </p>
              <div className="space-y-0.5">{recentContactRows.map(renderEntry)}</div>
            </div>
          )}
        </>
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
                    <div className="space-y-0.5">{group.results.map(renderEntry)}</div>
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
  const tOrg = useTranslations('Org')
  const pathname = usePathname()
  const { team, currentTeamId } = useAuth()
  // WHICH SCOPE THE URL SAYS WE ARE IN. Derived, never stored — see
  // contexts/ScopeContext.tsx. Null means the current studio.
  const { current: scope } = useScope()
  const orgScopeId = scope?.kind === 'org' ? scope.id : null
  const tTop = useTranslations('TopBar')
  const { isInstalled } = useInstalledPlugins()
  const { isAtLeast } = usePlan()
  // The owner-only settings destinations (see SettingsGate in lib/settings-nav).
  const canEditTeamSettings = useCapabilities().can('team.settings')
  const { alwaysShownIds, recentIds, recordVisit, headTileId, setHeadTile } = useNavPins()
  // ONE call for the whole sidebar. Resolved here rather than inside NavLink so
  // the row and the search catalogue below read the same string — a per-row hook
  // would also mean ~20 subscriptions to one cached query.
  const affiliationTerm = useAffiliationTerm()
  const navLabel = (item: NavItem) =>
    item.dynamicLabel === 'affiliationTerm'
      ? affiliationTerm
      : t(item.labelKey as Parameters<typeof t>[0])
  // Raw message tree — used to read the per-locale `Nav.searchKeywords` synonym
  // map without a t() call per id (ids without keywords are simply label-only).
  const messages = useMessages() as unknown as {
    Nav?: { searchKeywords?: Record<string, string> }
  }
  const kwOf = (id: string) => messages.Nav?.searchKeywords?.[id] ?? ''
  // Has the nav been scrolled off its top? Drives the seam shadow below, and
  // nothing else — it is a boolean, not a scroll position, so the re-render is
  // bounded to the two frames that cross the boundary.
  const [navScrolled, setNavScrolled] = useState(false)
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
    (!item.requiresPlugin || isInstalled(item.requiresPlugin)) &&
    (!item.requiresPlan || isAtLeast(item.requiresPlan))

  // Mirrors SettingsRail's gateOk — the sidebar's shortcut-able catalogue and the rail
  // must never disagree about what exists.
  const settingsItemVisible = (item: SettingsNavItem) => {
    if (item.gate === 'ownerOnly') return canEditTeamSettings
    if (item.gate === 'customFields') return isInstalled('custom-fields')
    if (item.gate === 'shop') return shopAvailable
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
        label: navLabel(item),
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
      icon: PLUGIN_ICON_MAP[nav.icon] ?? Puzzle,
    })
  }
  // The head tile is NOT taken from this list — it is census item 5, stored on
  // its own (see NavPinsContext). Shortcuts are rendered whole; a destination
  // that is both a tile and a shortcut is a duplicate the studio asked for
  // twice.
  const headTileEntry = headTileId ? catalogue.get(headTileId) : undefined

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

  // The search index: everything in the catalogue plus the fixed head/utility
  // items (searchable but not shortcut-able — they're always visible anyway).
  // A settings destination is tagged as such rather than listed among ordinary
  // pages (UX-90) — including the /settings hub itself, which IS the settings
  // answer to "where do I change this".
  //
  // Schedule is NOT listed here: it is back in NAV_SECTIONS, so it reaches the
  // index — and the shortcut catalogue, and therefore the head-tile picker —
  // through the ordinary path with everything else. Dashboard stays here because
  // it is the one destination that is not a section row and never was.
  const settingsIds = new Set(SETTINGS_ITEMS.map((i) => i.id))

  // IN ORG SCOPE THE SEARCH INDEXES THE ORGANISATION, not the studio.
  //
  // It used to index the studio's destinations in both scopes, which was worse
  // than finding nothing: standing in an organisation, every result led OUT of
  // it, to pages whose rows were not even on screen. The rest of the sidebar
  // already swaps; this is the last piece that did not.
  //
  // The org catalogue is small and flat — the four rows plus the rail — so it is
  // built here rather than through the shortcut-able `catalogue`, which carries
  // pinning and gating that only mean something for a studio.
  const orgSearchEntries: SearchEntry[] = orgScopeId
    ? [...ORG_NAV_ITEMS, ...ORG_RAIL_ITEMS].map((item) => ({
        id: item.id,
        href: orgHref(orgScopeId, item.path),
        label:
          item.dynamicLabel === 'affiliationTerm'
            ? affiliationTerm
            : tOrg(item.labelKey as Parameters<typeof tOrg>[0]),
        icon: item.icon,
        keywords: '',
        canShortcut: false,
        kind: (item.group ? 'settings' : 'page') as SearchKind,
      }))
    : []

  const searchEntries: SearchEntry[] = orgScopeId ? [
    // How-to is the product's own help and belongs to neither scope, so it is
    // the one studio-side entry that survives the swap.
    ...[HOW_TO_ITEM].map((item) => ({
      id: item.id,
      href: item.href,
      label: t(item.labelKey as Parameters<typeof t>[0]),
      icon: item.icon,
      exact: item.exact,
      keywords: kwOf(item.id),
      canShortcut: false,
      kind: 'page' as SearchKind,
    })),
    ...orgSearchEntries,
  ] : [
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

          ORIENTATION, NOT A CONTROL — and that is now a placement decision
          rather than a product one. This row used to say there was no team
          switcher at all; there is one as of 2026-08-24, in the account
          dropdown at the foot of the sidebar (components/layout/TeamSwitcher),
          because people already reach a second studio through an ordinary team
          invitation and had no way to open it. It lives beside the identity it
          changes rather than here, where the name is what tells you where you
          are. Hidden when collapsed, like every other piece of text in the
          sidebar. */}
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
          {/* THE OCCASIONAL UTILITIES MOVED UP HERE (2026-08-23), beside the QR,
              so the search field below can take the whole row. Both controls on
              this row are about the STUDIO rather than about a destination —
              the QR encodes its links, the menu opens its settings, its plugins
              and its how-to — which is why they sit together, and why the row
              below is now one thing: search. */}
          <UtilityFlyout onLinkClick={onLinkClick} />
        </div>
      )}

      {/* Search row. First of the two pinned rows; the head pair sits under it,
          and the scroll area starts below them both. Expanded, search has this
          row to ITSELF — the "⋯" utilities moved up to the studio-name row
          above on 2026-08-23; collapsed, they stack here as centred icons
          because there is no studio row to move them to.

          Search is a mini-input rather than the full-width field it used to be a
          row above: the field cost a whole row for something used in bursts, and
          collapsing it is what freed the space the studio name now has. It opens
          as an overlay anchored to itself, and ⌘K/Ctrl+K opens it too — behind an
          icon it would otherwise lose the discoverability a permanent field had.

          In icon-only mode the row stacks as centred icons. */}
      <div
        // No bottom rule: this row reads as part of the header block above it,
        // and a second line so close to the studio row's was clutter. The same
        // went for the head pair below — see the seam there.
        className={`mx-2 pt-2 pb-1.5 shrink-0 flex gap-1 ${
          collapsed ? 'flex-col items-center' : 'items-center'
        }`}
      >
        <NavSearch entries={searchEntries} onNavigate={onLinkClick} collapsed={collapsed} />
        {/* ── THE OCCASIONAL UTILITIES, BEHIND ONE CONTROL, IN BOTH MODES ─────
            Collapsed, this was forced: the icons stack VERTICALLY and cost
            ~144px, pushing Dashboard to y=256 of a 720px rail — five occasional
            destinations physically above the two a studio opens every session,
            a hierarchy inversion produced by the collapse rather than by any
            decision.

            Expanded they cost only one 32px row, so nothing forced it there —
            but the same argument holds for ATTENTION rather than for space.
            Plugins, Settings and How-to are reached deliberately, minutes
            apart, never mid-task; sitting permanently beside the search field
            they compete with the working areas below for the top of the pane.
            Behind "⋯" they cost one click and stop competing (Franco,
            2026-08-20).

            Search stays out of the group in both modes: it is a primary action
            (and ⌘K), not an occasional one.

            COLLAPSED ONLY, since 2026-08-23. Expanded, this control now sits on
            the studio-name row above and the search field has this row to
            itself; collapsed there is no studio row to move it to (no text at
            w-14), which is the same reason `includeQr` exists. */}
        {collapsed && <UtilityFlyout onLinkClick={onLinkClick} includeQr />}
      </div>

      {/* THE HEAD PAIR — where things stand, and what is on today.
          Two tiles on one row, icon over label, which gives the top of the nav a
          shape its body does not have: the eye finds them by silhouette before
          it reads anything. Schedule earns the second slot by being the surface
          a studio opens every single session.

          PINNED (Franco, 2026-08-20). These two and the search above them are
          the three things reached from anywhere, so they are the three that must
          never be scrolled away: the scroll area starts BELOW this block rather
          than above it. The order — search, then tiles — is the original one,
          tried the other way round and put back.

          It is safe to pin only because everything here is fixed-height by
          construction: one search row plus one tile row (or two icon rows
          collapsed). Shortcuts stayed in the scroll area precisely because they
          are NOT — a studio with a dozen pinned pages would push the working
          areas off-screen and have nothing give way.

          COLLAPSED FALLS BACK TO ROWS. At w-14 there is no second column to put
          anything in, and two 28px half-tiles would be unreadable — so the rail
          keeps the ordinary icon-only rows it already knows how to draw.

          THE TOUR ANCHOR STAYS ON THE TILES. It used to wrap the tiles AND the
          Shortcuts group, framing them as one "where do the things I use most
          live?" region. They are no longer in the same box — one is pinned, the
          other scrolls — and a highlight cannot span a scroll boundary, so the
          anchor keeps the half that is a fixed, always-visible target. */}
      {/* NOT IN ORG SCOPE. The pair is Dashboard plus the studio's own most-used
          surface, pinned because they are "the things reached from anywhere" —
          but that is a claim about a STUDIO. An organisation has neither: no
          dashboard, no schedule, and its home is the studios list which is
          already the first row below. Leaving them here put two studio
          destinations above the org's own navigation, which is the hierarchy
          inversion the pinning exists to prevent, pointed the other way.

          The same reasoning already removed Shortcuts and the plugin rows in org
          scope (they are pinned PER STUDIO). This was missed because it sits
          above the scroll area rather than inside it (Franco, 2026-08-27). */}
      {!orgScopeId && (
      <div
        // The seam between what is pinned and what scrolls. It carries NO rule:
        // the header block already has the studio row's line, and a second one
        // two rows below it drew a box around the top of the pane rather than
        // separating anything (Franco, 2026-08-21). What marks the boundary is
        // on the scroller instead — a shadow that only appears once something
        // is actually scrolled under it.
        className="mx-2 shrink-0 pt-1 pb-2"
      >
        {collapsed ? (
          // At w-14 there is no second column, and a chooser on a 28px target is
          // not a control — the rail keeps the ordinary icon-only rows it already
          // knows how to draw, in the same order.
          <>
            <NavLink item={DASHBOARD_ITEM} collapsed onClick={onLinkClick} />
            {/* ShortcutRow, not NavLink: a catalogue entry carries an already
                translated `label` (plugin rows resolve from the `Plugins`
                namespace, not `Nav`), and collapsed it renders as a bare icon
                link with the label as its tooltip. */}
            {headTileEntry && (
              <ShortcutRow entry={headTileEntry} collapsed onClick={onLinkClick} />
            )}
          </>
        ) : (
          <HeadTiles
            tile={headTileEntry}
            choices={[...catalogue.values()]}
            onSet={(id) => setHeadTile(id)}
            onClear={() => setHeadTile(null)}
            onLinkClick={onLinkClick}
          />
        )}
      </div>
      )}

      {/* Nav — the scrolling half of the pane.
          `min-h-0` on the wrapper because a flex child will not shrink below its
          content without it, and the nav has to be allowed to shrink for
          `overflow-y-auto` to mean anything. */}
      <div className="relative min-h-0 flex-1">
        {/* THE SEAM, DRAWN ONLY WHEN THERE IS SOMETHING TO SEPARATE.
            A rule here was a permanent line boxing in the top of the pane even
            with nothing scrolled under it. This is the same information —
            "content continues above" — but it is only true sometimes, so it is
            only drawn then: a short gradient that fades in on the first pixel of
            scroll and back out at the top.

            Absolutely positioned OVER the scroller rather than inside it, so it
            does not move with the content it is shading, and
            `pointer-events-none` so it never eats a click on the row beneath. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-3 bg-gradient-to-b from-black/10 to-transparent transition-opacity duration-200 dark:from-black/40 ${
            navScrolled ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <nav
          // Cheap: React bails out of a re-render when the boolean is unchanged,
          // so this only costs a render on the two frames that actually cross
          // the boundary, not on every scroll event.
          onScroll={(e) => setNavScrolled(e.currentTarget.scrollTop > 0)}
          className="h-full overflow-y-auto py-2 px-2"
        >
        {/* THE SCOPE INDICATOR — the design's single biggest risk is somebody
            not noticing which scope they are in, and the answer is not more
            words. It is a different ACCENT and a persistent band, so the
            difference is visible before anything is read. Only drawn in org
            scope: the studio is the default place to stand, and a badge on the
            common case is noise rather than information. */}
        {orgScopeId && !collapsed && (
          <div className="mb-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-amber-700 dark:text-amber-400">
              {tTop('scopeOrganisation')}
            </p>
            <p className="truncate text-sm font-semibold">{scope?.name || ' '}</p>
          </div>
        )}
        {/* ORG SCOPE REPLACES THE STUDIO'S ROWS ENTIRELY — it does not sit
            beside them. That is the whole point of a scope: one Events, one
            Places, one Settings on screen at a time, so the word never needs a
            second look. Shortcuts and the plugin rows are studio-scoped too
            (the pin store is keyed per studio), so they go with it. */}
        {orgScopeId ? (
          <OrgNavRows orgId={orgScopeId} collapsed={collapsed} onLinkClick={onLinkClick} />
        ) : (
        <>
        {/* Shortcuts — pinned + recently visited (hidden when empty). THE FIRST
            SCROLLING THING: unlike the head pair above the search, this list
            grows with use, so it is what gives way when the pane runs short. */}
        <ShortcutsNav entries={shortcutEntries} collapsed={collapsed} onLinkClick={onLinkClick} />

        {/* Features — the Run / Offer / Grow working areas. Extra top margin on
            the sections: unlike the other macro groups, the first thing here is
            another (section) header, which otherwise sits too close to the label. */}
        <div className="mt-3 pt-3">
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
                      label={navLabel(item)}
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
                // CONTAINS the active page — which is NOT the same as BEING it.
                // This used to wear `bg-primary/10 text-primary`, the exact
                // treatment a real destination wears (NavLink, NavTile,
                // ShortcutRow all use it), so a section icon read as the current
                // page while actually being a container you have to hover to
                // open. In the collapsed rail there is no label to disambiguate
                // it, so the pill was the whole message and the message was
                // wrong.
                //
                // The tint stays — knowing which section holds you is useful —
                // but the PILL goes. Filled = you are here; coloured glyph
                // alone = it is in here. Three steps, no new vocabulary:
                // muted (resting) → primary glyph (contains) → filled pill (is).
                const sectionHoldsActive =
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
                          aria-current={sectionHoldsActive ? 'true' : undefined}
                          className={`flex w-full items-center justify-center rounded-lg px-2 py-2 transition-colors hover:bg-accent ${
                            sectionHoldsActive
                              ? 'text-primary hover:text-primary'
                              : 'text-muted-foreground hover:text-foreground'
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
        </>
        )}
        </nav>
      </div>

      {/* User account + QR at bottom. The flip sits WITH the scope identity
          rather than in the utility row: it is about where you are standing,
          which is the question the account menu below already answers. */}
      <div className="border-t py-2 px-2 shrink-0">
        <div className={`mb-1 flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
          <ScopeFlip collapsed={collapsed} />
        </div>
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  )
}

// ─── layout ───────────────────────────────────────────────────────────────────

// ── THE DESKTOP RAIL'S WIDTH ─────────────────────────────────────────────────
// The rail is drag-resizable between these bounds. `SIDEBAR_DEFAULT` is the 240px
// the rail shipped as (`w-60`), so a sidebar nobody has dragged is pixel-identical
// to what it was before it could be dragged.
//
// DRAGGING PAST THE MINIMUM COLLAPSES IT to the icon rail, and persists that —
// the drag is the primary collapse gesture (Franco, 2026-08-24) and the chevron
// in the header stays as the shortcut. `SIDEBAR_COLLAPSE_SLOP` is the dead zone
// below the minimum that has to be crossed first, so pulling the rail down to
// its narrowest does not collapse it by accident: inside the slop the width
// simply holds at the minimum.
//
// THE KEYBOARD CROSSES THE SAME DEAD ZONE. Arrow keys are not a second rule with
// a second feel: `handleResizeKey` keeps a virtual position that may sit below
// SIDEBAR_MIN exactly as the pointer's clientX may, holds the applied width at
// the minimum while it is in there, and collapses on the press that takes it
// past the slop. Reaching the narrowest rail and pressing once more must not be
// the same keystroke as hiding the labels.
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 400
const SIDEBAR_DEFAULT = 240
const SIDEBAR_COLLAPSE_SLOP = 40
// Keyboard step on the handle, so the control is not mouse-only.
const SIDEBAR_KEY_STEP = 16
const SIDEBAR_WIDTH_KEY = 'linyup_sidebar_width'
// UNPREFIXED, unlike every key added since — and it stays that way. Renaming it
// would silently reset the collapse preference of everyone who has ever set one.
const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'

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
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  // While true the width transition is OFF. With it on, the rail eases towards
  // each new width over 200ms and visibly trails the cursor for the whole drag.
  const [resizing, setResizing] = useState(false)
  // Tears the drag down if the layout unmounts mid-gesture — otherwise the
  // window listeners and the body's `user-select: none` outlive it.
  const endResize = useRef<(() => void) | null>(null)
  // The keyboard's virtual position, mirroring the pointer's clientX: it is the
  // only place the arrow keys can accumulate an overshoot below SIDEBAR_MIN,
  // since the applied width is clamped at the minimum while inside the collapse
  // slop. `null` = no overshoot outstanding, start from the real width again.
  const keyOvershoot = useRef<number | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Settings detail pages now live under the /settings/* shell, which owns its rail
  // (desktop) + back-link (mobile). Only standalone settings items that stay outside
  // that shell (e.g. /plugins) still get the hub back-link injected here.
  const onSettingsPage =
    !pathname.startsWith('/settings') && SETTINGS_ITEMS.some((i) => i.href === pathname)

  // BOTH sidebar preferences are restored HERE, in an effect, and neither is
  // ever read during render: localStorage does not exist on the server, so a
  // render-time read is an SSR/hydration mismatch. That is why the collapse read
  // has always lived in an effect, and the width read joins it rather than
  // starting a second, wrong, convention.
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (stored === 'true') setCollapsed(true)
    const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (Number.isFinite(storedWidth) && storedWidth >= SIDEBAR_MIN && storedWidth <= SIDEBAR_MAX) {
      setSidebarWidth(storedWidth)
    }
  }, [])

  useEffect(() => () => endResize.current?.(), [])

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

  const persistWidth = (w: number) => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w))
    } catch {
      /* ignore unavailable storage */
    }
  }
  const persistCollapsed = (c: boolean) => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(c))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const handleToggleCollapse = () => {
    setCollapsed((v) => {
      persistCollapsed(!v)
      return !v
    })
  }

  // The rail's left edge is the viewport's left edge — the aside is the first
  // in-flow child of the shell — so the pointer's clientX IS the width it is
  // asking for, with no offset to carry.
  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setResizing(true)
    // A pointer gesture sets the width outright; any overshoot the arrow keys
    // had banked belongs to a gesture that is over.
    keyOvershoot.current = null

    // Without this the drag selects nav labels the length of the sidebar, and
    // the cursor flickers back to the default over every element it crosses.
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    // Mirrored in plain locals so the pointerup handler persists what was last
    // applied rather than the values captured when the drag began.
    let width = sidebarWidth
    let isCollapsed = collapsed

    // On the window, not the 8px strip: the pointer leaves the handle on the
    // first frame of any real drag, and pointerup routinely lands elsewhere.
    const move = (ev: PointerEvent) => {
      const x = ev.clientX
      if (x < SIDEBAR_MIN - SIDEBAR_COLLAPSE_SLOP) {
        isCollapsed = true
        setCollapsed(true)
        return
      }
      isCollapsed = false
      width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, x))
      setCollapsed(false)
      setSidebarWidth(width)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
      endResize.current = null
      setResizing(false)
      // Both preferences, always: a drag that ends in the icon rail has changed
      // the collapse state as well as the width, and storing one without the
      // other is how the two come back disagreeing on the next load.
      persistWidth(width)
      persistCollapsed(isCollapsed)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    endResize.current = end
  }

  const handleResizeReset = () => {
    keyOvershoot.current = null
    setCollapsed(false)
    persistCollapsed(false)
    setSidebarWidth(SIDEBAR_DEFAULT)
    persistWidth(SIDEBAR_DEFAULT)
  }

  const handleResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Home') {
      e.preventDefault()
      handleResizeReset()
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    if (collapsed) {
      // Out of the icon rail in one press, back to the stored width. Stepping
      // 16px at a time out of a 56px stub would take nine presses to reach a
      // rail that can show a label.
      if (e.key === 'ArrowRight') {
        keyOvershoot.current = null
        setCollapsed(false)
        persistCollapsed(false)
      }
      return
    }
    // The virtual position, not the applied width — inside the slop those two
    // differ, and stepping from the applied width would make every further
    // ArrowLeft re-run the same 180 → 164 step and never cross anything.
    const from = keyOvershoot.current ?? sidebarWidth
    const next = from + (e.key === 'ArrowLeft' ? -SIDEBAR_KEY_STEP : SIDEBAR_KEY_STEP)
    if (next < SIDEBAR_MIN - SIDEBAR_COLLAPSE_SLOP) {
      // Same rule as the drag: past the minimum AND past the slop is the icon rail.
      keyOvershoot.current = null
      setCollapsed(true)
      persistCollapsed(true)
      return
    }
    if (next < SIDEBAR_MIN) {
      // In the dead zone: bank the overshoot, hold the rail at its narrowest.
      keyOvershoot.current = next
      if (sidebarWidth !== SIDEBAR_MIN) {
        setSidebarWidth(SIDEBAR_MIN)
        persistWidth(SIDEBAR_MIN)
      }
      return
    }
    keyOvershoot.current = null
    const clamped = Math.min(SIDEBAR_MAX, next)
    setSidebarWidth(clamped)
    persistWidth(clamped)
  }

  return (
    // OUTERMOST of the shell providers: the sidebar reads the scope to decide
    // which row set to render at all, so it has to resolve above everything the
    // sidebar mounts. It costs one pathname read and the already-cached
    // `useOrgLinks` query.
    <ScopeProvider>
    <ScopeFlipShortcut />
    <NavPinsProvider>
      <UpgradeModalProvider>
        <RecentContactsProvider>
        <OpenTabsProvider>
        {/* Owns every floating control's position — page FABs and shell overlays
            declare a lane instead of hardcoding a corner (see FloatingDock). */}
        <FloatingDock>
        <div className="flex bg-background">
          {/* Desktop sidebar — fixed to viewport height, nav scrolls internally.
              Expanded, the width is an inline style so it can be dragged; the
              collapsed rail keeps the `w-14` class it has always had, so the
              icon mode is byte-identical to before. No `relative` class here on
              purpose: `sticky` already makes this the containing block for the
              handle below, and both are position utilities — adding one would
              be a coin toss over which wins. */}
          <aside
            style={{ width: collapsed ? undefined : sidebarWidth }}
            className={`hidden md:flex flex-col border-r bg-sidebar shrink-0 sticky top-0 h-screen ${
              resizing ? '' : 'transition-[width] duration-200'
            } ${collapsed ? 'w-14' : ''}`}
          >
            <SidebarContent collapsed={collapsed} onToggleCollapse={handleToggleCollapse} />
            {/* THE RESIZE HANDLE — an 8px strip straddling the right border.
                Focusable and keyboard-driven (←/→ to resize, Home to reset)
                because a rail that can only be adjusted by dragging can only be
                adjusted with a mouse. Double-click also resets. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('sidebarResizeLabel')}
              aria-valuemin={SIDEBAR_MIN}
              aria-valuemax={SIDEBAR_MAX}
              aria-valuenow={collapsed ? undefined : sidebarWidth}
              tabIndex={0}
              title={t('sidebarResizeHint')}
              onPointerDown={handleResizeStart}
              onKeyDown={handleResizeKey}
              onDoubleClick={handleResizeReset}
              className={`absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize transition-colors hover:bg-primary/20 focus-visible:bg-primary/40 focus-visible:outline-none ${
                resizing ? 'bg-primary/30' : ''
              }`}
            />
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
            {/* ABOVE the verify-email strip: a studio that is about to be erased
                outranks an address that has not been confirmed. Self-gating on
                `team.deletion_scheduled_for`, and shown to every role — the
                owner-only card in Settings → Team is where this used to be
                said, which left a coach with no way to learn it at all. */}
            <TeamDeletionBanner />
            {/* ABOVE the content, full width, not inside the page container:
                it is not about the page being looked at, and what it announces
                — outbound email is switched off — is worth more than the strip
                of vertical space it costs. */}
            <VerifyEmailBanner />
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
          {/* The setup checklist, as an overlay that survives navigation — the
              steps span five areas and every one of them leaves the page the
              list would otherwise live on. Self-gates: it renders nothing once
              the required steps are done, or once the team has hidden it. */}
          <SetupGuide />
          {/* AI assistant — self-gates on the (locked) plugin being installed. */}
          <AssistantLauncher />
          {/* In-app feedback — self-gates on the ops-controlled global flag. */}
          <FeedbackLauncher />
        </div>
        </FloatingDock>
        </OpenTabsProvider>
        </RecentContactsProvider>
      </UpgradeModalProvider>
    </NavPinsProvider>
    </ScopeProvider>
  )
}
