import type { PluginManifest } from '@linyup/shared'

// Documents — a studio's small set of core operational documents (terms,
// privacy policy, regulations). Free & up: gated purely by INSTALL STATE, no
// paid add-on and no plan lock (minPlan 'free', no `addon` field).
export const documentsManifest: PluginManifest = {
  id: 'documents',
  nameKey: 'documentsName',
  descriptionKey: 'documentsDescription',
  category: 'data',
  minPlan: 'free',
  status: 'available',
  recommended: true,
  iconName: 'FileText',
  navContributions: [
    {
      href: '/plugins/documents',
      labelKey: 'documentsNavLabel',
      icon: 'FileText',
      section: 'configure',
    },
  ],
}
