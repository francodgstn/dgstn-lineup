import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const websiteManifest: PluginManifest = {
  id: 'website',
  nameKey: 'websiteName',
  descriptionKey: 'websiteDescription',
  category: 'website',
  minPlan: 'studio',
  status: 'available',
  addon: PLUGIN_ADDONS['website'],
  iconName: 'Globe',
  hasOwnerConfig: true,
  navContributions: [
    { href: '/plugins/website', labelKey: 'websiteNavLabel', icon: 'Globe', section: 'configure' },
  ],
}
