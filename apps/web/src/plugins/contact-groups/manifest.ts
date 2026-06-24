import type { PluginManifest } from '@linyup/shared'

// Standard in Coach (2026-06 overhaul): Contact Groups is included from Coach up
// with no add-on charge. minPlan 'coach' + no `addon` → pluginAccessForPlan
// resolves it to `included` for Coach/Studio/Org and installs client-side.
export const contactGroupsManifest: PluginManifest = {
  id: 'contact-groups',
  nameKey: 'contactGroupsName',
  descriptionKey: 'contactGroupsDescription',
  category: 'data',
  minPlan: 'coach',
  status: 'available',
  recommended: true,
  iconName: 'FolderTree',
  navContributions: [
    {
      href: '/plugins/contact-groups',
      labelKey: 'contactGroupsNavLabel',
      icon: 'FolderTree',
      section: 'operations',
    },
  ],
}
