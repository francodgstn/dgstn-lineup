import type { PluginManifest } from '@linyup/shared'

export const hmdFightingCupManifest: PluginManifest = {
  id: 'hmd-fighting-cup',
  nameKey: 'hmdFightingCupName',
  descriptionKey: 'hmdFightingCupDescription',
  category: 'analytics',
  minPlan: 'studio',
  status: 'available',
  iconName: 'Trophy',
  hasOwnerConfig: false,
  navContributions: [
    {
      href: '/plugins/hmd-fighting-cup',
      labelKey: 'hmdFightingCupNavLabel',
      icon: 'Trophy',
      minPlan: 'studio',
    },
  ],
  eventType: {
    id: 'hmd_fighting_cup',
    nameKey: 'hmdFightingCupEventTypeName',
    icon: 'Trophy',
    hasCategories: true,
    hasCheckinForm: true,
    hasCsvExport: true,
    hasPdfExport: true,
  },
}
