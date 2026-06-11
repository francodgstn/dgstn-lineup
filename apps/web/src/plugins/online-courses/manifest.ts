import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const onlineCoursesManifest: PluginManifest = {
  id: 'online-courses',
  nameKey: 'onlineCoursesName',
  descriptionKey: 'onlineCoursesDescription',
  category: 'content',
  minPlan: 'studio',
  status: 'available',
  recommended: true,
  addon: PLUGIN_ADDONS['online-courses'],
  iconName: 'GraduationCap',
  navContributions: [
    {
      href: '/plugins/online-courses',
      labelKey: 'onlineCoursesNavLabel',
      icon: 'GraduationCap',
      minPlan: 'studio',
    },
  ],
}
