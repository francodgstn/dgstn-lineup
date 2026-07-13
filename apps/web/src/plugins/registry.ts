// Plugin registry — static list of all available first-party plugins.
// Manifests are code (bundled); only installation state lives in Firestore.
// To add a new plugin: create a manifest file and add it here.

import type { PluginManifest } from '@linyup/shared'
import { aiAssistantManifest } from './ai-assistant/manifest'
import { aiInsightsManifest } from './ai-insights/manifest'
import { whatsappManifest } from './whatsapp/manifest'
import { websiteManifest } from './website/manifest'
import { hmdFightingCupManifest } from './hmd-fighting-cup/manifest'
import { referralsManifest } from './referrals/manifest'
import { onlineCoursesManifest } from './online-courses/manifest'
import { productsManifest } from './products/manifest'
import { gamificationManifest } from './gamification/manifest'
import { contactGroupsManifest } from './contact-groups/manifest'
import { customFieldsManifest } from './custom-fields/manifest'
import { customFormsManifest } from './custom-forms/manifest'
import { documentsManifest } from './documents/manifest'
import { kioskManifest } from './kiosk/manifest'
import { financeManifest } from './finance/manifest'

export const PLUGIN_REGISTRY: PluginManifest[] = [
  aiAssistantManifest,
  aiInsightsManifest,
  whatsappManifest,
  websiteManifest,
  hmdFightingCupManifest,
  referralsManifest,
  onlineCoursesManifest,
  productsManifest,
  gamificationManifest,
  contactGroupsManifest,
  customFieldsManifest,
  customFormsManifest,
  documentsManifest,
  kioskManifest,
  financeManifest,
]

/** All plugin-contributed event type IDs (built-in type IDs from installed plugins). */
export function getPluginEventTypeIds(): string[] {
  return PLUGIN_REGISTRY
    .filter((p) => p.eventType)
    .map((p) => p.eventType!.id)
}
