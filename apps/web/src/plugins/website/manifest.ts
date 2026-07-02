import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const websiteManifest: PluginManifest = {
  id: 'website',
  nameKey: 'websiteName',
  descriptionKey: 'websiteDescription',
  category: 'web',
  minPlan: 'studio',
  status: 'available',
  recommended: true,
  addon: PLUGIN_ADDONS['website'],
  iconName: 'Globe',
  hasOwnerConfig: true,
  // No sidebar nav entry — the Website surface is reached from the Public pages
  // hub (its card links to /plugins/website). Discovery still happens via the
  // hub's Website card + the plugins marketplace.
}
