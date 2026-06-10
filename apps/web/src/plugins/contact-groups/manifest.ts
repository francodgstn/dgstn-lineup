import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const contactGroupsManifest: PluginManifest = {
  id: 'contact-groups',
  nameKey: 'contactGroupsName',
  descriptionKey: 'contactGroupsDescription',
  category: 'organization',
  minPlan: 'coach',
  status: 'available',
  addon: PLUGIN_ADDONS['contact-groups'],
  iconName: 'FolderTree',
  navContributions: [
    {
      href: '/plugins/contact-groups',
      labelKey: 'contactGroupsNavLabel',
      icon: 'FolderTree',
    },
  ],
}
