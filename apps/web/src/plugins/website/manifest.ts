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
  navContributions: [
    { href: '/plugins/website', labelKey: 'websiteNavLabel', icon: 'Globe', section: 'engage' },
  ],
}
