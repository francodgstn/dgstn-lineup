import type { Timestamp } from './common'
import type { SaasPlan } from './team'

export type PluginId = string
export type PluginCategory = 'ai' | 'communications' | 'website' | 'payments' | 'analytics' | 'content' | 'engagement'
export type PluginStatus = 'available' | 'coming_soon' | 'beta'

// Template literal union — enables type-safe namespaced IDs like 'plugin:whatsapp:send_message'
export type PluginActionId  = `plugin:${string}:${string}`
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

export interface PluginNavContribution {
  href: string         // relative to /(auth)/ — e.g. '/plugins/club-website'
  labelKey: string
  icon: string
  minPlan?: SaasPlan
}

export interface PluginEventType {
  id: string            // e.g. 'fighting_cup' — used as event.type value
  nameKey: string
  icon: string          // lucide icon name
  hasCategories?: boolean   // plugin manages per-event categories (events/{id}/categories)
  hasCheckinForm?: boolean  // plugin provides a custom React check-in form
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
  recommended?: boolean    // surfaced with a "Recommended" tag and floated to the top

  iconName: string         // lucide icon name resolved at runtime
  automationTriggers?: PluginAutomationTrigger[]
  automationActions?: PluginAutomationAction[]
  navContributions?: PluginNavContribution[]
  hasOwnerConfig?: boolean // plugin has a settings/credential dialog
  eventType?: PluginEventType  // plugin contributes an event type
}

export interface InstalledPlugin {
  pluginId: PluginId
  teamId: string
  installedAt: Timestamp
  installedBy: string
  config?: Record<string, unknown>
  secretRef?: string       // pointer to Secret Manager secret (future)
  status: 'active' | 'disabled'
  updated_at?: Timestamp
  updatedBy?: string
}
