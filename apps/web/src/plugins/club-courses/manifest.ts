import type { PluginManifest } from '@linyup/shared'

export const clubCoursesManifest: PluginManifest = {
  id: 'club-courses',
  nameKey: 'clubCoursesName',
  descriptionKey: 'clubCoursesDescription',
  category: 'content',
  minPlan: 'club',
  status: 'available',
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
