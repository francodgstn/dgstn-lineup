import type { PluginManifest } from '@linyup/shared'

export const whatsappManifest: PluginManifest = {
  id: 'whatsapp',
  nameKey: 'whatsappName',
  descriptionKey: 'whatsappDescription',
  category: 'web',
  minPlan: 'studio',
  status: 'coming_soon',
  iconName: 'MessageCircle',
  // NOTHING FIRES `message_received` YET, and nothing may release this plugin
  // until something does. A trigger a studio can select but that never runs is
  // indistinguishable from a rule that has simply not matched — no error, no
  // log, nothing to notice (UX-87). It is harmless today only because
  // `status: 'coming_soon'` makes the plugin uninstallable, and a plugin that
  // cannot be installed contributes no triggers to the automations builder. So
  // flipping this to `'available'` is the same change as shipping the trigger:
  // the server-side fire must land in the same commit. `referrals` is the worked
  // example — packages/functions/src/referrals/events.ts.
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
