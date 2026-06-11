import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const websiteManifest: PluginManifest = {
  id: 'website',
  nameKey: 'websiteName',
  descriptionKey: 'websiteDescription',
  category: 'content',
  minPlan: 'studio',
  status: 'coming_soon',
  addon: PLUGIN_ADDONS['website'],
  iconName: 'Globe',
  hasOwnerConfig: true,
}
