import type { PluginManifest } from '@lineup/shared'

export const hmdFightingCupManifest: PluginManifest = {
  id: 'hmd-fighting-cup',
  nameKey: 'hmdFightingCupName',
  descriptionKey: 'hmdFightingCupDescription',
  category: 'analytics',
  minPlan: 'club',
  status: 'available',
  iconName: 'Trophy',
  hasOwnerConfig: false,
  navContributions: [
    {
      href: '/plugins/hmd-fighting-cup',
      labelKey: 'hmdFightingCupNavLabel',
      icon: 'Trophy',
      minPlan: 'club',
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
