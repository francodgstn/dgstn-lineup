import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const clubCoursesManifest: PluginManifest = {
  id: 'club-courses',
  nameKey: 'clubCoursesName',
  descriptionKey: 'clubCoursesDescription',
  category: 'content',
  minPlan: 'club',
  status: 'available',
  recommended: true,
  addon: PLUGIN_ADDONS['club-courses'],
  iconName: 'GraduationCap',
  navContributions: [
    {
      href: '/plugins/club-courses',
      labelKey: 'clubCoursesNavLabel',
      icon: 'GraduationCap',
      minPlan: 'club',
    },
  ],
}
