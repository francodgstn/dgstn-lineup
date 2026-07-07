// Thin façade over the provider-agnostic mail service (src/mail/). Kept so the
// many existing call sites can keep importing { sendEmail, sendBatchEmails,
// buildEmailTemplate } from '../utils/email'. Transport is Brevo; there is no
// SMTP/nodemailer here any more.
//
//   • Pass `teamId` to send AS the studio (Managed or verified BYO domain).
//   • Omit `teamId` to send Linyup system mail (from hello@linyup.com).
import { sendStudioMail, sendSystemMail, type SendOutcome } from '../mail/mailService'
import type { MailAttachment } from '../mail/types'
import { escapeHtml } from './html'
import { wrapInLayout } from './emailLayout'

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

  // Delegates to the shared Linyup layout so transactional mail (bookings,
  // codes, invites, billing) matches outreach/automation emails.
  const html = wrapInLayout({
    headerTitle: escapeHtml(title),
    content: body,
    footerContent: `<p>${defaultFooter}</p>`,
  })

  const text = `${title}\n${'='.repeat(title.length)}\n\n${body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}\n\n---\n${defaultFooter.replace(/<[^>]*>/g, '')}`

  return { html, text }
}
