import type { PluginManifest } from '@linyup/shared'

// Custom Fields — extends the contact form with account-defined extra fields.
// Deliberately has NO navContributions: it adds no menu section, only a card on
// the contact form and a tab injected into the existing Settings page (shown
// only when installed). Field definitions are managed there, so there is no
// `/plugins` Configure dialog (hasOwnerConfig is omitted/false).
//
// Standard in Coach (2026-06 overhaul): included from Coach up with no add-on
// charge. minPlan 'coach' + no `addon` → pluginAccessForPlan resolves it to
// `included` for Coach/Studio/Org; free is upgrade-locked.
export const customFieldsManifest: PluginManifest = {
  id: 'custom-fields',
  nameKey: 'customFieldsName',
  descriptionKey: 'customFieldsDescription',
  category: 'organization',
  minPlan: 'coach',
  status: 'available',
  recommended: true,
  iconName: 'ListPlus',
  // No navContributions → no sidebar/menu entry.
}
