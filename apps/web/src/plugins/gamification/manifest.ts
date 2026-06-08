import type { PluginManifest } from '@linyup/shared'

export const gamificationManifest: PluginManifest = {
  id: 'gamification',
  nameKey: 'gamificationName',
  descriptionKey: 'gamificationDescription',
  category: 'analytics',
  minPlan: 'club',
  status: 'available',
  iconName: 'Trophy',
  navContributions: [
    {
      href: '/gamification',
      labelKey: 'gamificationNavLabel',
      icon: 'Trophy',
    },
  ],
}
