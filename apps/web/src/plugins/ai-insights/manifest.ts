import type { PluginManifest } from '@linyup/shared'

export const aiInsightsManifest: PluginManifest = {
  id: 'ai-insights',
  nameKey: 'aiInsightsName',
  descriptionKey: 'aiInsightsDescription',
  category: 'data',
  minPlan: 'studio',
  status: 'coming_soon',
  iconName: 'Sparkles',
  automationActions: [
    {
      id: 'plugin:ai-insights:generate_message',
      labelKey: 'aiInsightsActionGenerateMessage',
      icon: 'Sparkles',
      configFields: [],
    },
  ],
  hasOwnerConfig: false,
}
