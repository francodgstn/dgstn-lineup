import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

// Custom Fields — extends the contact form with account-defined extra fields.
// Deliberately has NO navContributions: it adds no menu section, only a card on
// the contact form and a tab injected into the existing Settings page (shown
// only when installed). Field definitions are managed there, so there is no
// `/plugins` Configure dialog (hasOwnerConfig is omitted/false).
export const customFieldsManifest: PluginManifest = {
  id: 'custom-fields',
  nameKey: 'customFieldsName',
  descriptionKey: 'customFieldsDescription',
  category: 'organization',
  minPlan: 'studio', // included from studio up; coach buys the add-on; free is upgrade-locked
  status: 'available',
  recommended: true,
  addon: PLUGIN_ADDONS['custom-fields'],
  iconName: 'ListPlus',
  // No navContributions → no sidebar/menu entry.
}
