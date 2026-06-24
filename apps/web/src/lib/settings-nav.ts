// Shared catalogue of "settings" destinations. Consumed by the sidebar (which shows
// the user's pinned subset under the Settings group) and by the /settings hub page
// (which lists them all, grouped, with pin toggles). Keeping it in one place means
// the sidebar and hub never drift.
import {
  Zap,
  CalendarRange,
  Tag,
  CalendarCheck,
  MapPin,
  Workflow,
  Puzzle,
  UserCog,
  Settings,
  CreditCard,
  Bell,
  Award,
  Wallet,
  Send,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SettingsGroupKey = 'catalog' | 'automation' | 'team' | 'account'

export interface SettingsNavItem {
  id: string // stable id used in the pin set + as React key
  href: string
  labelKey: string // key in the `Nav` i18n namespace
  icon: LucideIcon
  group: SettingsGroupKey
  exact?: boolean // active only on exact path match (hub routes like /plugins)
}

// Order here drives both the hub (within each group) and the pinned sidebar list.
export const SETTINGS_ITEMS: SettingsNavItem[] = [
  { id: 'activities', href: '/activities', labelKey: 'activities', icon: Zap, group: 'catalog' },
  { id: 'eventTypes', href: '/team/event-types', labelKey: 'eventTypes', icon: CalendarRange, group: 'catalog' },
  { id: 'subscriptions', href: '/team/subscriptions', labelKey: 'subscriptions', icon: Tag, group: 'catalog' },
  { id: 'places', href: '/team/places', labelKey: 'places', icon: MapPin, group: 'catalog' },
  { id: 'bookingPage', href: '/team/booking', labelKey: 'bookingPage', icon: CalendarCheck, group: 'catalog' },
  { id: 'automations', href: '/automations', labelKey: 'automations', icon: Workflow, group: 'automation' },
  { id: 'plugins', href: '/plugins', labelKey: 'plugins', icon: Puzzle, group: 'automation', exact: true },
  // Team settings — exploded from the old single "Team settings" entry so each
  // section is reachable directly (each deep-links to its tab via ?tab=).
  { id: 'teamGeneral', href: '/team/settings', labelKey: 'teamGeneral', icon: Settings, group: 'team', exact: true },
  { id: 'teamAlerts', href: '/team/settings?tab=alerts', labelKey: 'teamAlerts', icon: Bell, group: 'team' },
  { id: 'teamRanking', href: '/team/settings?tab=ranking', labelKey: 'teamRanking', icon: Award, group: 'team' },
  { id: 'teamPayments', href: '/team/settings?tab=payments', labelKey: 'teamPayments', icon: Wallet, group: 'team' },
  { id: 'teamOutreach', href: '/team/settings?tab=outreach', labelKey: 'teamOutreach', icon: Send, group: 'team' },
  { id: 'managers', href: '/team/members', labelKey: 'managers', icon: UserCog, group: 'account' },
  { id: 'billing', href: '/billing', labelKey: 'billing', icon: CreditCard, group: 'account' },
]

// Group order + their `Nav` namespace label keys (rendered on the hub page).
export const SETTINGS_GROUPS: { key: SettingsGroupKey; labelKey: string }[] = [
  { key: 'catalog', labelKey: 'groupCatalog' },
  { key: 'automation', labelKey: 'groupAutomation' },
  { key: 'team', labelKey: 'groupTeam' },
  { key: 'account', labelKey: 'groupAccount' },
]

// Pinned to the sidebar by default — the items that matter most while setting up a
// new studio. Users add/remove pins from the hub; the choice is per-browser.
export const DEFAULT_PINNED_IDS = ['activities', 'subscriptions', 'plugins']
