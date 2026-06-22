// Shared catalogue of "settings" destinations. Consumed by the sidebar (which shows
// the user's pinned subset under the Settings group) and by the /settings hub page
// (which lists them all, grouped, with pin toggles). Keeping it in one place means
// the sidebar and hub never drift.
import {
  Zap,
  CalendarRange,
  Tag,
  CalendarCheck,
  Workflow,
  Puzzle,
  UserCog,
  Settings,
  CreditCard,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SettingsGroupKey = 'catalog' | 'automation' | 'account'

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
  { id: 'bookingPage', href: '/team/booking', labelKey: 'bookingPage', icon: CalendarCheck, group: 'catalog' },
  { id: 'automations', href: '/automations', labelKey: 'automations', icon: Workflow, group: 'automation' },
  { id: 'plugins', href: '/plugins', labelKey: 'plugins', icon: Puzzle, group: 'automation', exact: true },
  { id: 'managers', href: '/team/members', labelKey: 'managers', icon: UserCog, group: 'account' },
  { id: 'teamSettings', href: '/team/settings', labelKey: 'teamSettings', icon: Settings, group: 'account' },
  { id: 'billing', href: '/billing', labelKey: 'billing', icon: CreditCard, group: 'account' },
]

// Group order + their `Nav` namespace label keys (rendered on the hub page).
export const SETTINGS_GROUPS: { key: SettingsGroupKey; labelKey: string }[] = [
  { key: 'catalog', labelKey: 'groupCatalog' },
  { key: 'automation', labelKey: 'groupAutomation' },
  { key: 'account', labelKey: 'groupAccount' },
]

// Pinned to the sidebar by default — the items that matter most while setting up a
// new studio. Users add/remove pins from the hub; the choice is per-browser.
export const DEFAULT_PINNED_IDS = ['activities', 'subscriptions', 'plugins']
