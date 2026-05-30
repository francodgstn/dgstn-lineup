import type { PluginManifest } from '@lineup/shared'

export const aiInsightsManifest: PluginManifest = {
  id: 'ai-insights',
  nameKey: 'Plugins.aiInsightsName',
  descriptionKey: 'Plugins.aiInsightsDescription',
  category: 'ai',
  minPlan: 'club',
  status: 'coming_soon',
  iconName: 'Sparkles',
  automationActions: [
    {
      id: 'plugin:ai-insights:generate_message',
      labelKey: 'Plugins.aiInsightsActionGenerateMessage',
      icon: 'Sparkles',
      configFields: [],
    },
  ],
  hasOwnerConfig: false,
}
