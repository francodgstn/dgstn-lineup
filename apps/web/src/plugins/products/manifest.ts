import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

// Products — let a studio (included) or a coach (paid add-on) sell their own
// merchandise/equipment alongside memberships. Intentionally light: variants for
// sizes, no stock tracking. The public storefront shares the existing /shop route.
export const productsManifest: PluginManifest = {
  id: 'products',
  nameKey: 'productsName',
  descriptionKey: 'productsDescription',
  category: 'commerce',
  minPlan: 'studio',
  status: 'available',
  addon: PLUGIN_ADDONS['products'],
  iconName: 'Tag',
  // Nav lives in the main "Offer" section (see (auth)/layout.tsx), shown only when
  // installed — so it is not contributed to the sidebar plugin-nav here.
}
