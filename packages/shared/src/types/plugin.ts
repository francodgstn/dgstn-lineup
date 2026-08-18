import type { Timestamp } from './common'
import type { SaasPlan } from './team'

export type PluginId = string
// Consolidated, user-facing buckets (kept deliberately few + meaningful):
//   engagement — gamification, referrals
//   commerce   — products, online courses (things you sell)
//   web        — website, messaging (whatsapp)
//   data       — contact groups, custom fields, insights/analytics
export type PluginCategory = 'engagement' | 'commerce' | 'web' | 'data'
export type PluginStatus = 'available' | 'coming_soon' | 'beta'

// Template literal union — enables type-safe namespaced IDs like 'plugin:whatsapp:send_message'
export type PluginActionId = `plugin:${string}:${string}`
export type PluginTriggerId = `plugin:${string}:${string}`

export interface PluginAutomationTrigger {
  id: PluginTriggerId
  labelKey: string
  descriptionKey?: string
  icon: string
  supportsDelay: boolean
}

export interface PluginAutomationActionField {
  key: string
  labelKey: string
  type: 'text' | 'textarea' | 'select' | 'number'
  options?: Array<{ value: string; labelKey: string }>
  required?: boolean
}

export interface PluginAutomationAction {
  id: PluginActionId
  labelKey: string
  descriptionKey?: string
  icon: string
  configFields?: PluginAutomationActionField[]
}

/** Built-in sidebar sections a plugin nav item can render into. */
export type PluginNavSection = 'operations' | 'engage' | 'configure' | 'team'

export interface PluginNavContribution {
  href: string // relative to /(auth)/ — e.g. '/plugins/online-courses'
  labelKey: string
  icon: string
  minPlan?: SaasPlan
  /** Optional existing sidebar section to render into. When set and matching
   *  a built-in section, the item appears inside that section (after the
   *  built-in items). When omitted or unmatched, the item falls back to the
   *  default plugin groups ("Plugins" / "Engage"). */
  section?: PluginNavSection
}

export interface PluginEventType {
  id: string // e.g. 'fighting_cup' — used as event.type value
  nameKey: string
  icon: string // lucide icon name
  hasCategories?: boolean // plugin manages per-event categories (events/{id}/categories)
  hasCheckinForm?: boolean // plugin provides a custom React check-in form
  hasCsvExport?: boolean
  hasPdfExport?: boolean
}

export interface PluginManifest {
  id: PluginId
  nameKey: string
  descriptionKey: string
  category: PluginCategory
  minPlan: SaasPlan
  status: PluginStatus
  recommended?: boolean // surfaced with a "Recommended" tag and floated to the top
  // When set, this plugin is available to the Coach plan as a paid monthly
  // add-on (à la carte). Studio/Org include all plugins regardless. Plugins
  // without `addon` are upgrade-locked for coaches.
  addon?: { coachPriceMonthly: number; stripeLookupKey: string }

  iconName: string // lucide icon name resolved at runtime
  /** When true, the plugin is visible in the marketplace but can only be installed
   *  via the `unlockPlugin` callable after a strong secret key check — never a direct
   *  client write (see firestore.rules installed_plugins + unlockPlugin). Used for
   *  experimental/gated plugins the operator unlocks privately. */
  locked?: boolean
  /** Optional URL (or public path) to a screenshot shown in the plugin detail modal. */
  screenshot?: string
  automationTriggers?: PluginAutomationTrigger[]
  automationActions?: PluginAutomationAction[]
  navContributions?: PluginNavContribution[]
  hasOwnerConfig?: boolean // plugin has a settings/credential dialog
  eventType?: PluginEventType // plugin contributes an event type
}

export interface InstalledPlugin {
  pluginId: PluginId
  /** Set for team-scoped installs; absent on org-level installs. */
  teamId?: string
  /** Set for org-level installs; absent on team-scoped installs. */
  orgId?: string
  installedAt: Timestamp
  installedBy: string
  config?: Record<string, unknown>
  secretRef?: string // pointer to Secret Manager secret (future)
  status: 'active' | 'disabled'
  updated_at?: Timestamp
  updatedBy?: string
  /**
   * `online-courses` only, and server-written only. Set on the write that
   * deactivates the install, it tells `onInstalledPluginStatusChange` whether to
   * delete this team's `courses/{id}/public_profile/{id}` mirrors — the only
   * thing that keeps a bought course openable. `true` on an ORGANISATION lapse
   * (the studio's member paid for a course and a third party stopped paying),
   * absent/false everywhere else. Written by `downgradeTeamToFree`, which is the
   * only writer of an inactive install; see its comment for why it cannot go
   * stale. Use `KEEP_COURSE_MIRRORS_FIELD` rather than the literal.
   */
  keep_course_mirrors?: boolean
}

/**
 * The field name above, so the writer (`downgradeTeamToFree`) and the reader
 * (`onInstalledPluginStatusChange`) cannot drift apart silently — a typo on
 * either side would delete the mirrors a paying member's course lives behind,
 * with nothing to notice it.
 */
export const KEEP_COURSE_MIRRORS_FIELD = 'keep_course_mirrors' as const
