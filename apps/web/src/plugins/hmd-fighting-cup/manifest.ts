import type { PluginManifest } from '@lineup/shared'

export const hmdFightingCupManifest: PluginManifest = {
  id: 'hmd-fighting-cup',
  nameKey: 'Plugins.hmdFightingCupName',
  descriptionKey: 'Plugins.hmdFightingCupDescription',
  category: 'analytics',
  minPlan: 'club',
  status: 'available',
  iconName: 'Trophy',
  hasOwnerConfig: false,
  navContributions: [
    {
      href: '/plugins/hmd-fighting-cup',
      labelKey: 'Plugins.hmdFightingCupNavLabel',
      icon: 'Trophy',
      minPlan: 'club',
    },
  ],
  eventType: {
    id: 'hmd_fighting_cup',
    nameKey: 'Plugins.hmdFightingCupEventTypeName',
    icon: 'Trophy',
    hasCategories: true,
    hasCheckinForm: true,
    hasCsvExport: true,
    hasPdfExport: true,
  },
}
