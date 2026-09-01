// Finance plugin — monthly reporting CSV export + double-entry accounting in
// ONE plugin: included for Studio/Organization, a paid add-on for Coach
// (pluginAccessForPlan resolves that automatically from `addon` + minPlan),
// upgrade prompt for Free.
//
// The finance JOURNAL and monthly report docs are always-on core infrastructure
// for every team — this plugin gates the export callable, the accounting
// module, and their UI surfaces, never data capture.

import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const financeManifest: PluginManifest = {
  id: 'finance',
  nameKey: 'financeName',
  descriptionKey: 'financeDescription',
  category: 'data',
  minPlan: 'coach',
  addon: PLUGIN_ADDONS['finance'],
  status: 'beta',
  iconName: 'Calculator',
  navContributions: [
    { href: '/plugins/finance', labelKey: 'financeNavLabel', icon: 'Calculator', section: 'operations' },
    // The asset register is a finance-plugin FEATURE with its own front door —
    // presentation is free, ownership stays here (docs/finance-accrual.md §4).
    { href: '/plugins/finance/assets', labelKey: 'financeAssetsNavLabel', icon: 'Dumbbell', section: 'operations' },
  ],
}
