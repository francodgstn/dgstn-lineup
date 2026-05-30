// WhatsApp plugin — automation action handler stub.
// Real implementation will call the Meta Business API (WhatsApp Cloud API) to send
// messages to contacts. Until then this is a deliberate no-op so the engine
// can safely route 'plugin:whatsapp:send_message' actions without errors.

import type { PluginActionHandler } from './index'

export const whatsappSendMessage: PluginActionHandler = async ({ contactId, ruleId }) => {
  console.log(
    `[plugin:whatsapp] send_message is Coming Soon — skipping for contact ${contactId} / rule ${ruleId}`
  )
}
