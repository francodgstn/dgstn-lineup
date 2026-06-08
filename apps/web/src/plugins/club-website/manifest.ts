import type { PluginManifest } from '@linyup/shared'

export const clubWebsiteManifest: PluginManifest = {
  id: 'club-website',
  nameKey: 'clubWebsiteName',
  descriptionKey: 'clubWebsiteDescription',
  category: 'content',
  minPlan: 'club',
  status: 'coming_soon',
  addon: { coachPriceMonthly: 8, stripeLookupKey: 'linyup_addon_club-website_monthly' },
  iconName: 'Globe',
  hasOwnerConfig: true,
}
