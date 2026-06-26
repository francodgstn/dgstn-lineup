import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const onlineCoursesManifest: PluginManifest = {
  id: 'online-courses',
  nameKey: 'onlineCoursesName',
  descriptionKey: 'onlineCoursesDescription',
  category: 'commerce',
  minPlan: 'studio',
  status: 'available',
  recommended: true,
  addon: PLUGIN_ADDONS['online-courses'],
  iconName: 'GraduationCap',
  // Nav lives in the main "Offer" section (see (auth)/layout.tsx), shown only when
  // installed — so it is not contributed to the sidebar plugin-nav here.
}
