import { getBrevoClient } from './brevoClient'
import type { SmsProvider, SmsProviderSendResult } from './smsTypes'

// Brevo implementation of the SmsProvider seam — the only file that talks to
// Brevo's transactional-SMS API. Reuses the shared client (same API key as
// mail). Note: SMS is billed from prepaid SMS credits, separate from the email
// plan — keep the account topped up.
export const brevoSmsProvider: SmsProvider = {
  async send(msg): Promise<SmsProviderSendResult> {
    const client = await getBrevoClient()
    const res = await client.transactionalSms.sendAsyncTransactionalSms({
      sender: msg.sender,
      recipient: msg.recipient,
      content: msg.content,
      type: 'transactional',
      ...(msg.tag ? { tag: { field: msg.tag } } : {}),
    })
    return { providerMessageId: String(res.messageId ?? '') }
  },
}
