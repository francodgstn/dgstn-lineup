import type { PluginManifest } from '@linyup/shared'

export const kioskManifest: PluginManifest = {
  id: 'kiosk',
  nameKey: 'kioskName',
  descriptionKey: 'kioskDescription',
  category: 'web',
  minPlan: 'studio',
  status: 'beta',
  iconName: 'Monitor',
  hasOwnerConfig: true,
  navContributions: [
    { href: '/plugins/kiosk', labelKey: 'kioskNavLabel', icon: 'Monitor', section: 'engage' },
  ],
}
