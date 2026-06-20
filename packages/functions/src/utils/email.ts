// Thin façade over the provider-agnostic mail service (src/mail/). Kept so the
// many existing call sites can keep importing { sendEmail, sendBatchEmails,
// buildEmailTemplate } from '../utils/email'. Transport is Brevo; there is no
// SMTP/nodemailer here any more.
//
//   • Pass `teamId` to send AS the studio (Managed or verified BYO domain).
//   • Omit `teamId` to send Linyup system mail (from hello@linyup.com).
import { sendStudioMail, sendSystemMail, type SendOutcome } from '../mail/mailService'
import type { MailAttachment } from '../mail/types'

export { idempotencyKey } from '../mail/mailService'

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  // When set, the message is sent as this studio (team). When omitted, it is
  // sent as Linyup system mail.
  teamId?: string
  replyTo?: string
  attachments?: MailAttachment[]
  tags?: string[]
  idempotencyKey?: string
}

export async function sendEmail(options: SendEmailOptions): Promise<SendOutcome> {
  const { teamId, ...msg } = options
  return teamId ? sendStudioMail(teamId, msg) : sendSystemMail(msg)
}

export interface BatchSendResult {
  total: number
  sent: number
  failed: number
  errors: { recipient: string | string[]; error: string }[]
}

export async function sendBatchEmails(
  emails: SendEmailOptions[],
  stopOnError = false,
): Promise<BatchSendResult> {
  const results: BatchSendResult = { total: emails.length, sent: 0, failed: 0, errors: [] }
  for (const options of emails) {
    try {
      await sendEmail(options)
      results.sent++
    } catch (error) {
      const err = error as Error
      results.failed++
      results.errors.push({ recipient: options.to, error: err.message })
      console.error(`Failed to send email to ${options.to}:`, err.message) // eslint-disable-line no-console
      if (stopOnError) throw error
    }
  }
  return results
}

export function buildEmailTemplate({ title, body, footer }: { title: string; body: string; footer?: string }) {
  const defaultFooter = footer || 'This is an automated email from Linyup.<br>Please do not reply.'

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #ffffff; padding: 30px 20px; border-left: 1px solid #e0e0e0; border-right: 1px solid #e0e0e0; }
    .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 14px; color: #666; border-radius: 0 0 8px 8px; border-top: 1px solid #e0e0e0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>${title}</h1></div>
    <div class="content">${body}</div>
    <div class="footer">${defaultFooter}</div>
  </div>
</body>
</html>`

  const text = `${title}\n${'='.repeat(title.length)}\n\n${body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}\n\n---\n${defaultFooter.replace(/<[^>]*>/g, '')}`

  return { html, text }
}
