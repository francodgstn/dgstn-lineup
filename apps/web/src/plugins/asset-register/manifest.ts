// Asset register — what the studio OWNS: equipment, fittings, vehicles, IT.
//
// ITS OWN PLUGIN, NOT A FINANCE FEATURE. `docs/finance-accrual.md` states the
// boundary — "operational plugins own operational truth; the finance plugin
// owns every ledger posting, derived one-directionally through its single
// posting engine" — and equipment used to be the one exception to it. It no
// longer is: the register answers an operational question (what do we own, how
// many, where), and finance READS it for the statement of assets and, later,
// the depreciation postings, exactly as it already reads subscriptions, credit
// packs and gift cards.
//
// The dependency therefore points FROM finance (see PLUGIN_REQUIREMENTS), which
// is what keeps the statement of assets always reachable for an accounting
// user while leaving the register installable on its own.
//
// Included from Coach with no add-on: it costs nothing to serve, posts nothing,
// and a solo coach owns kit too.

import type { PluginManifest } from '@linyup/shared'

export const assetRegisterManifest: PluginManifest = {
  id: 'asset-register',
  nameKey: 'assetRegisterName',
  descriptionKey: 'assetRegisterDescription',
  category: 'data',
  minPlan: 'coach',
  status: 'available',
  iconName: 'Boxes',
  navContributions: [
    {
      href: '/plugins/asset-register',
      labelKey: 'assetRegisterNavLabel',
      icon: 'Boxes',
      section: 'grow',
    },
  ],
}
