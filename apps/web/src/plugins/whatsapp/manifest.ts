import type { PluginManifest } from '@lineup/shared'

export const whatsappManifest: PluginManifest = {
  id: 'whatsapp',
  nameKey: 'whatsappName',
  descriptionKey: 'whatsappDescription',
  category: 'communications',
  minPlan: 'club',
  status: 'coming_soon',
  iconName: 'MessageCircle',
  automationTriggers: [
    {
      id: 'plugin:whatsapp:message_received',
      labelKey: 'whatsappTriggerMessageReceived',
      icon: 'MessageCircle',
      supportsDelay: false,
    },
  ],
  automationActions: [
    {
      id: 'plugin:whatsapp:send_message',
      labelKey: 'whatsappActionSendMessage',
      icon: 'MessageCircle',
      configFields: [
        {
          key: 'message',
          labelKey: 'Common.message',
          type: 'textarea',
          required: true,
        },
      ],
    },
  ],
  hasOwnerConfig: true,
}
