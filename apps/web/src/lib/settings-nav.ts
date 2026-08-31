// Shared catalogue of "settings" destinations. Consumed by the sidebar (which shows
// the subset the user always shows, under Favourites) and by the settings rail
// (/settings/* — which lists them all, grouped, with an "always show" toggle on
// each). Keeping it in one place means the sidebar and rail never drift.
// Vocabulary: see THE NAV-MEMORY CENSUS in contexts/NavPinsContext.tsx.
import {
  Award,
  Bell,
  CalendarCheck,
  CalendarRange,
  CreditCard,
  FileText,
  FlaskConical,
  LayoutTemplate,
  ListChecks,
  ListTodo,
  Mail,
  Puzzle,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Target,
  UserCog,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SettingsGroupKey =
  | 'account'
  | 'studio'
  | 'scheduling'
  | 'communication'
  | 'publicSurfaces'

// Runtime visibility gate for items that only apply on certain plans/plugins/roles.
// The rail resolves these (plugin via useInstalledPlugins, role via
// useCapabilities) and hides items whose gate fails.
//
// `ownerOnly` — the destination is entirely read-only below the owner role:
// firestore.rules makes the team doc, alert_presets, integrations and billing
// owner-write (integrations owner-READ as well), so a manager who follows one of
// these rows arrives at a screen with nothing she can do. A rail item you can
// only look at is not worth a row. The controls behind them are still disabled +
// annotated for an owner-less arrival by deep link — hiding the row is
// navigation, never enforcement.
//
// `shop` — the storefront only means anything once there is something to sell or
// a way to charge (the products or online-courses plugin, or a payment channel).
// Same condition the main nav used while the row lived there.
export type SettingsGate = 'ownerOnly' | 'customFields' | 'shop'

export interface SettingsNavItem {
  id: string // stable id used in the pin set + as React key
  href: string
  labelKey: string // key in the `Nav` i18n namespace
  icon: LucideIcon
  group: SettingsGroupKey
  exact?: boolean // active only on exact path match (hub routes like /settings/plugins)
  gate?: SettingsGate // hidden unless the runtime condition holds
}

// Order here drives the rail (within each group) and the pinned sidebar list.
// Activities + Subscriptions live in the main nav's "Offer" section now. Most items
// render under a shared /settings/* layout (the master-detail rail + detail pane);
// legacy paths (/team/settings, /billing, …) resolve via redirect stubs.
export const SETTINGS_ITEMS: SettingsNavItem[] = [
  // ── Account — workspace admin: who is here, what we pay, what we opted into.
  { id: 'managers', href: '/settings/members', labelKey: 'managers', icon: UserCog, group: 'account' },
  { id: 'roles', href: '/settings/roles', labelKey: 'roles', icon: ShieldCheck, group: 'account' },
  { id: 'billing', href: '/settings/billing', labelKey: 'billing', icon: CreditCard, group: 'account', gate: 'ownerOnly' },
  // Experimental features — the studio's opt-in for surfaces that are built and
  // working but not yet settled. Account, not Studio: it is a workspace-wide
  // "what have we turned on". Owner-only because the switch is a team-doc write
  // (firestore.rules), so a manager who reached it could only look at it. NOT a
  // plugin, deliberately — see the registry header in
  // packages/shared/src/types/experimental.ts.
  { id: 'experimental', href: '/settings/experimental', labelKey: 'experimentalFeatures', icon: FlaskConical, group: 'account', gate: 'ownerOnly' },

  // ── Studio — the studio's own configuration: who it is, how it takes money,
  // how it ranks and describes people, what it has installed. Each team
  // sub-section is its own rail item (selected by ?tab= on /settings/team).
  //
  // It used to hold the email and public-surface rows too, which made it long
  // enough that a reader arrived here by elimination. Those became their own
  // groups — see the note on SETTINGS_GROUPS below.
  { id: 'teamGeneral', href: '/settings/team', labelKey: 'teamGeneral', icon: Settings, group: 'studio', exact: true },
  { id: 'teamPayments', href: '/settings/team?tab=payments', labelKey: 'teamPayments', icon: Wallet, group: 'studio', gate: 'ownerOnly' },
  { id: 'teamRanking', href: '/settings/team?tab=ranking', labelKey: 'teamRanking', icon: Award, group: 'studio', gate: 'ownerOnly' },
  // Affiliations moved to the main nav's "Offer" section (/offer/affiliations).
  { id: 'teamCustomFields', href: '/settings/team?tab=custom-fields', labelKey: 'teamCustomFields', icon: ListChecks, group: 'studio', gate: 'customFields' },
  { id: 'teamCoaching', href: '/settings/coaching', labelKey: 'teamCoaching', icon: Target, group: 'studio' },
  // The plugins marketplace renders in the detail pane; its per-plugin editor
  // sub-routes open full-screen at /plugins/*.
  { id: 'plugins', href: '/settings/plugins', labelKey: 'plugins', icon: Puzzle, group: 'studio', exact: true },

  // ── Scheduling — how sessions and bookings work.
  //
  // IT STAYS ITS OWN GROUP even when short (UX-67 follow-up). The label is the
  // word a studio arrives with — someone looking for the booking window looks
  // for "Scheduling", not for "Studio" — so the group is doing search work, not
  // just visual grouping. Revisit only if it drops to one row: a group of one is
  // a header with nothing to head.
  { id: 'eventTypes', href: '/settings/event-types', labelKey: 'eventTypes', icon: CalendarRange, group: 'scheduling' },
  // Reusable event programmes. Renders inside the /settings shell, so it stays a
  // rail row (unlike Places, below).
  { id: 'programTemplates', href: '/settings/program-templates', labelKey: 'programTemplates', icon: ListTodo, group: 'scheduling' },
  // Places is NOT here any more: it moved to /schedule/places, beside the calendar
  // that reads it, and is listed in the main nav's Run section (UX-67). It is not
  // kept as a rail row pointing there, deliberately — a rail row whose page lives
  // outside the /settings shell throws the reader out of settings mid-task, which
  // is exactly what UX-61 objected to. Every row in this list now renders inside
  // the shell; `publicPages` below is the one that reaches it via a route group
  // rather than a /settings/* path.
  { id: 'bookingPage', href: '/settings/booking', labelKey: 'bookingPage', icon: CalendarCheck, group: 'scheduling' },

  // ── Communication — what the studio sends, and how it reads.
  //
  // Outreach folded into Emails (2026-08-25): sender identity, placeholders,
  // templates and the system toggles are one subject, and were already sharing
  // the `EmailSettings` i18n namespace. `?tab=outreach` redirects to /settings/emails,
  // so a pinned `teamOutreach` id resolves to nothing and simply drops out of the
  // pin list (the catalogue is a Map lookup) rather than breaking it.
  { id: 'teamEmails', href: '/settings/emails', labelKey: 'teamEmails', icon: Mail, group: 'communication' },
  // Split out of teamEmails (2026-08-27): the templates list + placeholder
  // reference is AUTHORING copy, while teamEmails above is CONFIGURATION
  // (sender identity, system-email toggles, booking instructions, SMS). The
  // templates list was pushing the config cards below the fold, so it earned
  // its own row rather than a tab or a disclosure on the same page.
  { id: 'teamEmailTemplates', href: '/settings/email-templates', labelKey: 'teamEmailTemplates', icon: FileText, group: 'communication' },
  // Alerts are the OTHER outbound channel — what the studio sends ITSELF (and
  // its coaches) when something happens. Same subject as the two above: a
  // message goes out and somebody reads it.
  { id: 'teamAlerts', href: '/settings/team?tab=alerts', labelKey: 'teamAlerts', icon: Bell, group: 'communication', gate: 'ownerOnly' },

  // ── Public pages — what the world sees.
  //
  // The public-surface overview hub — the map of everything the world can see
  // (public URL, default landing, per-surface live status). Individual surfaces
  // are reachable from their own sections (Space → Grow, Shop → just below); this
  // is the settings/overview that ties them together.
  //
  // The route stays at /public-page — it is bookmarked, and its sibling
  // /public-page/space is linked from the main nav — but it RENDERS inside the
  // settings shell (rail + detail pane) via a route-group layout at
  // (auth)/public-page/layout.tsx, so it reads like every other settings section
  // instead of dumping the reader onto a bare full page (UX-61). That shell now
  // covers /public-page/shop and /public-page/space too — they are sections of
  // this one, and drawn full-width they read as unfinished pages. It is ALSO
  // listed in the main nav's Grow section under the same id, so the map is
  // reachable from where public surfaces are worked on (UX-28) — one
  // destination, one shortcut star, listed twice.
  { id: 'publicPages', href: '/public-page', labelKey: 'publicPage', icon: LayoutTemplate, group: 'publicSurfaces', exact: true },
  // The public storefront that aggregates subscriptions, products and courses.
  // It renders in this shell and is a SECTION of the public-page hub above, so
  // the row belongs beside it — it spent a while in the main nav's Offer section
  // instead, which put a settings destination in the middle of the things a
  // studio actually sells.
  { id: 'shop', href: '/public-page/shop', labelKey: 'shop', icon: ShoppingBag, group: 'publicSurfaces', gate: 'shop' },
]

/**
 * Group order + their `Nav` namespace label keys (rendered in the rail). Account
 * on top per product direction.
 *
 * ── WHY FIVE GROUPS AND NOT THREE (2026-08-31) ──────────────────────────────
 * "Studio" had eleven rows and every other group had two or three, which made
 * it the place a reader ended up by elimination rather than by expectation —
 * and eleven rows is past the point where a group heading helps you skip past
 * what you do not want. Two coherent subjects came out of it:
 *
 *  • COMMUNICATION — Emails, Email templates, Alerts. One subject already: two
 *    of them share the `EmailSettings` i18n namespace, and all three answer
 *    "what do we send, and how does it read". Somebody hunting for a reminder's
 *    wording looks for that word, not for "Studio".
 *  • PUBLIC PAGES — the public-surface hub and the Shop, which is a section of
 *    it. Both are about what the WORLD sees; the rest of Studio is about what
 *    the studio is.
 *
 * What stayed in Studio is what is genuinely the studio's own configuration:
 * identity, how it takes money, ranks, custom fields, coaching axes, plugins.
 *
 * ORDER is by how often a settings visit lands there, not alphabetical (the
 * same rule the sidebar's sections follow): Account, then Studio — General is
 * the single most-opened settings page — then the three topic groups.
 */
export const SETTINGS_GROUPS: { key: SettingsGroupKey; labelKey: string }[] = [
  { key: 'account', labelKey: 'groupAccount' },
  { key: 'studio', labelKey: 'groupStudio' },
  { key: 'scheduling', labelKey: 'groupScheduling' },
  { key: 'communication', labelKey: 'groupCommunication' },
  { key: 'publicSurfaces', labelKey: 'groupPublicSurfaces' },
]

/**
 * The always-shown shortcuts a browser starts with. Users add/remove them from
 * the rail; the choice is per-browser. (The STORED name of this list stays
 * `defaultNavPins` — see the census in contexts/NavPinsContext.tsx for why.)
 *
 * EMPTY, DELIBERATELY. It used to seed `['publicPages','bookingPage','plugins']`
 * — a guess at what a new studio needs, arriving pre-pinned without being asked
 * for. An empty group with a visible hint ("Pages you open show up here") says
 * more than three rows nobody chose, and the recents half fills it within a
 * session of ordinary use anyway.
 */
export const DEFAULT_SHORTCUT_IDS: string[] = []

/**
 * The destination in the head tile beside Dashboard before the studio picks one.
 *
 * Schedule: it is the surface a studio opens every session, and the tile exists
 * to put exactly that one click from anywhere. Census item 5 in
 * contexts/NavPinsContext.tsx owns the storage and the absent-vs-cleared rule —
 * this constant is only the fallback for "never chosen".
 */
export const DEFAULT_HEAD_TILE_ID = 'calendar'
