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
// NO documents manifest: Documents is a default feature on every plan, not a
// plugin. Leaving it registered would keep a marketplace card with an install
// button that means nothing — and, on Free and Coach, one that the rules refuse.
import { kioskManifest } from './kiosk/manifest'
import { financeManifest } from './finance/manifest'
import { giftCardsManifest } from './gift-cards/manifest'
import { promoCodesManifest } from './promo-codes/manifest'

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
  kioskManifest,
  financeManifest,
  giftCardsManifest,
  promoCodesManifest,
]

/** All plugin-contributed event type IDs (built-in type IDs from installed plugins). */
export function getPluginEventTypeIds(): string[] {
  return PLUGIN_REGISTRY
    .filter((p) => p.eventType)
    .map((p) => p.eventType!.id)
}
