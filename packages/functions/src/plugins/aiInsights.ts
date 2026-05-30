// AI Insights plugin — automation action handler stub.
// Real implementation will call the Anthropic Claude API to generate personalised
// messages for contacts. Until then this is a deliberate no-op so the engine
// can safely route 'plugin:ai-insights:generate_message' actions without errors.

import type { PluginActionHandler } from './index'

export const aiInsightsGenerateMessage: PluginActionHandler = async ({ contactId, ruleId }) => {
  console.log(
    `[plugin:ai-insights] generate_message is Coming Soon — skipping for contact ${contactId} / rule ${ruleId}`
  )
}
