// Shared catalogue of "settings" destinations. Consumed by the sidebar (which shows
// the user's pinned subset under the Settings group) and by the settings rail
// (/settings/* — which lists them all, grouped, with pin toggles). Keeping it in one
// place means the sidebar and rail never drift.
import {
  CalendarRange,
  CalendarCheck,
  MapPin,
  Puzzle,
  UserCog,
  ShieldCheck,
  Settings,
  CreditCard,
  Bell,
  Award,
  Wallet,
  Send,
  Mail,
  ListChecks,
  ListTodo,
  LayoutTemplate,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SettingsGroupKey = 'scheduling' | 'studio' | 'account'

// Runtime visibility gate for items that only apply on certain plans/plugins. The
// rail resolves these (plan via usePlan, plugin via useInstalledPlugins) and hides
// items whose gate fails.
export type SettingsGate = 'affiliations' | 'customFields'

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
  // Scheduling — how sessions and bookings work.
  { id: 'eventTypes', href: '/settings/event-types', labelKey: 'eventTypes', icon: CalendarRange, group: 'scheduling' },
  { id: 'programTemplates', href: '/settings/program-templates', labelKey: 'programTemplates', icon: ListTodo, group: 'scheduling' },
  { id: 'places', href: '/settings/places', labelKey: 'places', icon: MapPin, group: 'scheduling' },
  { id: 'bookingPage', href: '/settings/booking', labelKey: 'bookingPage', icon: CalendarCheck, group: 'scheduling' },
  // Studio — the studio's own configuration. Each team sub-section is its own rail
  // item (selected by ?tab= on /settings/team); affiliations + custom-fields are
  // plan/plugin-gated. The plugins marketplace lives here too (renders in the detail
  // pane; its per-plugin editor sub-routes open full-screen at /plugins/*).
  { id: 'teamGeneral', href: '/settings/team', labelKey: 'teamGeneral', icon: Settings, group: 'studio', exact: true },
  { id: 'teamPayments', href: '/settings/team?tab=payments', labelKey: 'teamPayments', icon: Wallet, group: 'studio' },
  { id: 'teamOutreach', href: '/settings/team?tab=outreach', labelKey: 'teamOutreach', icon: Send, group: 'studio' },
  { id: 'teamEmails', href: '/settings/emails', labelKey: 'teamEmails', icon: Mail, group: 'studio' },
  { id: 'teamAlerts', href: '/settings/team?tab=alerts', labelKey: 'teamAlerts', icon: Bell, group: 'studio' },
  { id: 'teamRanking', href: '/settings/team?tab=ranking', labelKey: 'teamRanking', icon: Award, group: 'studio' },
  // Affiliations moved to the main nav's "Offer" section (/offer/affiliations).
  { id: 'teamCustomFields', href: '/settings/team?tab=custom-fields', labelKey: 'teamCustomFields', icon: ListChecks, group: 'studio', gate: 'customFields' },
  // The public-surface overview hub — the map of everything the world can see
  // (public URL, default landing, per-surface live status). Individual surfaces
  // are reachable from their own sections (Shop → Offer, Space → Grow, …); this is
  // the settings/overview that ties them together. Lives outside the /settings/*
  // shell at /public-page, so the layout injects a "back to settings" link.
  { id: 'publicPages', href: '/public-page', labelKey: 'publicPage', icon: LayoutTemplate, group: 'studio', exact: true },
  { id: 'plugins', href: '/settings/plugins', labelKey: 'plugins', icon: Puzzle, group: 'studio', exact: true },
  // Account — workspace admin.
  { id: 'managers', href: '/settings/members', labelKey: 'managers', icon: UserCog, group: 'account' },
  { id: 'roles', href: '/settings/roles', labelKey: 'roles', icon: ShieldCheck, group: 'account' },
  { id: 'billing', href: '/settings/billing', labelKey: 'billing', icon: CreditCard, group: 'account' },
]

// Group order + their `Nav` namespace label keys (rendered in the rail). Account on
// top per product direction.
export const SETTINGS_GROUPS: { key: SettingsGroupKey; labelKey: string }[] = [
  { key: 'account', labelKey: 'groupAccount' },
  { key: 'scheduling', labelKey: 'groupScheduling' },
  { key: 'studio', labelKey: 'groupStudio' },
]

// Pinned to the sidebar by default — the settings that matter most while setting up a
// new studio. Users add/remove pins from the rail; the choice is per-browser.
export const DEFAULT_PINNED_IDS = ['publicPages', 'bookingPage', 'plugins']
