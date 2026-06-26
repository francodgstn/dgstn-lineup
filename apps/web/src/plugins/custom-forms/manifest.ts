import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

// Custom Forms — a lightweight form builder + submissions backend. Included on
// Studio/Org; available to Coach as a low-priced monthly add-on (CHF 3). Same
// gating model as the website/online-courses plugins.
export const customFormsManifest: PluginManifest = {
  id: 'custom-forms',
  nameKey: 'customFormsName',
  descriptionKey: 'customFormsDescription',
  category: 'data',
  minPlan: 'studio',
  status: 'available',
  recommended: true,
  addon: PLUGIN_ADDONS['custom-forms'],
  iconName: 'ClipboardList',
  navContributions: [
    {
      href: '/plugins/custom-forms',
      labelKey: 'customFormsNavLabel',
      icon: 'ClipboardList',
      minPlan: 'studio',
      section: 'engage',
    },
  ],
}
