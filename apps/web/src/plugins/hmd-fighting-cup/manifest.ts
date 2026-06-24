import type { PluginManifest } from '@linyup/shared'

export const hmdFightingCupManifest: PluginManifest = {
  id: 'hmd-fighting-cup',
  nameKey: 'hmdFightingCupName',
  descriptionKey: 'hmdFightingCupDescription',
  category: 'data',
  minPlan: 'studio',
  status: 'available',
  iconName: 'Trophy',
  hasOwnerConfig: false,
  // No navContributions: this plugin adds no sidebar entry. It surfaces purely
  // as an event type (below) — the Categories tab, custom check-in form, and
  // lineup exports all live on the event detail page.
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
