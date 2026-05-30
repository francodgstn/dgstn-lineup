import type { PluginManifest } from '@lineup/shared'

export const whatsappManifest: PluginManifest = {
  id: 'whatsapp',
  nameKey: 'Plugins.whatsappName',
  descriptionKey: 'Plugins.whatsappDescription',
  category: 'communications',
  minPlan: 'club',
  status: 'coming_soon',
  iconName: 'MessageCircle',
  automationTriggers: [
    {
      id: 'plugin:whatsapp:message_received',
      labelKey: 'Plugins.whatsappTriggerMessageReceived',
      icon: 'MessageCircle',
      supportsDelay: false,
    },
  ],
  automationActions: [
    {
      id: 'plugin:whatsapp:send_message',
      labelKey: 'Plugins.whatsappActionSendMessage',
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
