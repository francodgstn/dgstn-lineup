import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const clubWebsiteManifest: PluginManifest = {
  id: 'club-website',
  nameKey: 'clubWebsiteName',
  descriptionKey: 'clubWebsiteDescription',
  category: 'content',
  minPlan: 'club',
  status: 'coming_soon',
  addon: PLUGIN_ADDONS['club-website'],
  iconName: 'Globe',
  hasOwnerConfig: true,
}
