import type { PluginManifest } from '@linyup/shared'

// AI assistant — an in-app help/navigation copilot. Shipped LOCKED: it shows in
// the marketplace but can only be installed via the `unlockPlugin` callable after
// a strong secret-key check (see packages/functions/src/plugins/unlockPlugin.ts +
// firestore.rules). Deliberately excluded from all seed/sandbox/demo data so it
// stays operator-only while experimental.
export const aiAssistantManifest: PluginManifest = {
  id: 'ai-assistant',
  nameKey: 'aiAssistantName',
  descriptionKey: 'aiAssistantDescription',
  category: 'data',
  minPlan: 'studio',
  status: 'available',
  locked: true,
  iconName: 'Sparkles',
  hasOwnerConfig: false,
}
