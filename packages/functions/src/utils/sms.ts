// Thin façade over the SMS service (src/mail/smsService.ts), parallel to
// utils/email.ts. Call sites send AS a studio:
//
//   await sendSms({ to: contact.phone, content: '…', teamId })
//
// The service handles E.164 normalization (CH default), the SMS_ENABLED kill
// switch, TEST_MODE redirect, suppression and the idempotency ledger.
import { sendStudioSms, type SmsSendOutcome } from '../mail/smsService'

export { idempotencyKey } from '../mail/mailService'
export { normalizePhoneE164 } from '../mail/smsService'

export interface SendSmsOptions {
  to: string
  content: string
  teamId: string
  tag?: string
  idempotencyKey?: string
}

export async function sendSms(options: SendSmsOptions): Promise<SmsSendOutcome> {
  const { teamId, ...msg } = options
  return sendStudioSms(teamId, msg)
}
