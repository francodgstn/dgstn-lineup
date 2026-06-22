import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

// Products — let a studio (included) or a coach (paid add-on) sell their own
// merchandise/equipment alongside memberships. Intentionally light: variants for
// sizes, no stock tracking. The public storefront shares the existing /shop route.
export const productsManifest: PluginManifest = {
  id: 'products',
  nameKey: 'productsName',
  descriptionKey: 'productsDescription',
  category: 'payments',
  minPlan: 'studio',
  status: 'available',
  addon: PLUGIN_ADDONS['products'],
  iconName: 'Tag',
  navContributions: [
    {
      href: '/plugins/products',
      labelKey: 'productsNavLabel',
      icon: 'Tag',
      section: 'operations',
    },
  ],
}
