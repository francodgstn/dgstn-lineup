// Canonical catalog of curated Coach **add-on** plugins. Single source of truth
// shared by: the web plugin manifests (display), the billing Cloud Functions
// (Stripe subscription items), and scripts/stripe-sync.ts (declarative Stripe
// product/price provisioning).
//
// Studio/Org include all plugins; Coach activates these as paid monthly add-ons.
// Prices here are display/seed values — the authoritative amount is the Stripe
// Price for the matching lookup key (kept in sync via scripts/stripe-sync.ts).

export interface PluginAddonPrice {
  /** Indicative monthly price in CHF (display + Stripe sync seed). */
  coachPriceMonthly: number
  /** Stripe Price lookup key — convention: `linyup_addon_<pluginId>_monthly`. */
  stripeLookupKey: string
}

export const PLUGIN_ADDONS: Record<string, PluginAddonPrice> = {
  gamification:   { coachPriceMonthly: 5, stripeLookupKey: 'linyup_addon_gamification_monthly' },
  referrals:      { coachPriceMonthly: 5, stripeLookupKey: 'linyup_addon_referrals_monthly' },
  'online-courses': { coachPriceMonthly: 8, stripeLookupKey: 'linyup_addon_online-courses_monthly' },
  website:        { coachPriceMonthly: 8, stripeLookupKey: 'linyup_addon_website_monthly' },
  'contact-groups': { coachPriceMonthly: 5, stripeLookupKey: 'linyup_addon_contact-groups_monthly' },
  'custom-fields': { coachPriceMonthly: 2, stripeLookupKey: 'linyup_addon_custom-fields_monthly' },
  products:       { coachPriceMonthly: 5, stripeLookupKey: 'linyup_addon_products_monthly' },
}

export function pluginAddon(pluginId: string): PluginAddonPrice | undefined {
  return PLUGIN_ADDONS[pluginId]
}

/** Reverse-resolve a Stripe lookup key back to the plugin id (webhook reconcile). */
export function pluginIdForAddonLookupKey(lookupKey: string): string | undefined {
  for (const [id, v] of Object.entries(PLUGIN_ADDONS)) {
    if (v.stripeLookupKey === lookupKey) return id
  }
  return undefined
}
