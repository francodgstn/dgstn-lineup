import type { PluginManifest } from '@linyup/shared'

export const clubCoursesManifest: PluginManifest = {
  id: 'club-courses',
  nameKey: 'clubCoursesName',
  descriptionKey: 'clubCoursesDescription',
  category: 'content',
  minPlan: 'club',
  status: 'available',
  recommended: true,
  addon: { coachPriceMonthly: 8, stripeLookupKey: 'linyup_addon_club-courses_monthly' },
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
