import type { PluginManifest } from '@linyup/shared'

export const aiInsightsManifest: PluginManifest = {
  id: 'ai-insights',
  nameKey: 'aiInsightsName',
  descriptionKey: 'aiInsightsDescription',
  category: 'ai',
  minPlan: 'club',
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
