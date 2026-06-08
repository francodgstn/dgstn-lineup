import type { PluginManifest } from '@linyup/shared'

export const gamificationManifest: PluginManifest = {
  id: 'gamification',
  nameKey: 'gamificationName',
  descriptionKey: 'gamificationDescription',
  category: 'engagement',
  minPlan: 'club',
  status: 'available',
  recommended: true,
  addon: { coachPriceMonthly: 5, stripeLookupKey: 'linyup_addon_gamification_monthly' },
  iconName: 'Trophy',
  navContributions: [
    {
      href: '/gamification',
      labelKey: 'gamificationNavLabel',
      icon: 'Trophy',
    },
  ],
}
