import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const gamificationManifest: PluginManifest = {
  id: 'gamification',
  nameKey: 'gamificationName',
  descriptionKey: 'gamificationDescription',
  category: 'engagement',
  minPlan: 'studio',
  status: 'available',
  recommended: true,
  addon: PLUGIN_ADDONS['gamification'],
  iconName: 'Trophy',
  navContributions: [
    {
      href: '/gamification',
      labelKey: 'gamificationNavLabel',
      icon: 'Trophy',
    },
  ],
}
