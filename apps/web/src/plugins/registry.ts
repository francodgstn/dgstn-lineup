// Plugin registry — static list of all available first-party plugins.
// Manifests are code (bundled); only installation state lives in Firestore.
// To add a new plugin: create a manifest file and add it here.

import type { PluginManifest } from '@lineup/shared'
import { aiInsightsManifest } from './ai-insights/manifest'
import { whatsappManifest } from './whatsapp/manifest'
import { clubWebsiteManifest } from './club-website/manifest'
import { hmdFightingCupManifest } from './hmd-fighting-cup/manifest'

export const PLUGIN_REGISTRY: PluginManifest[] = [
  aiInsightsManifest,
  whatsappManifest,
  clubWebsiteManifest,
  hmdFightingCupManifest,
]

/** All plugin-contributed event type IDs (built-in type IDs from installed plugins). */
export function getPluginEventTypeIds(): string[] {
  return PLUGIN_REGISTRY
    .filter((p) => p.eventType)
    .map((p) => p.eventType!.id)
}
