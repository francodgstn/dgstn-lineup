import nodemailer from 'nodemailer'
import { defineString } from 'firebase-functions/params'
import { getSMTPConfig } from './secrets'
import { getAppSettings } from './app_settings'

const testModeEnabled = defineString('TEST_MODE', {
  description: 'Redirect all emails to a single test address',
  default: 'false',
})

const testEmail = defineString('TEST_EMAIL', {
  description: 'Recipient when test mode is enabled',
  default: '',
})

const DEFAULT_SENDER = {
  name: 'Lineup',
  email: 'noreply@lineup.app',
}

export async function getEmailTransporter() {
  const appSettings = await getAppSettings()
  const smtpConfig = await getSMTPConfig(appSettings)
  return nodemailer.createTransport(smtpConfig as nodemailer.TransportOptions)
}

export function isTestModeEnabled() {
  return testModeEnabled.value() === 'true'
}

export function getSenderAddress(options: { name?: string; email?: string } = {}) {
  const name = options.name || DEFAULT_SENDER.name
  const email = options.email || DEFAULT_SENDER.email
  return `"${name}" <${email}>`
}

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  senderOptions?: { name?: string; email?: string }
  transporter?: nodemailer.Transporter
  attachments?: nodemailer.SendMailOptions['attachments']
}

export async function sendEmail(options: SendEmailOptions) {
  const { to, subject, html, text, from, senderOptions = {}, transporter: provided, attachments = [] } = options

  if (!to || !subject || (!html && !text)) {
    throw new Error('Missing required email fields: to, subject, and html/text')
  }

  const transporter = provided || (await getEmailTransporter())
  const fromAddress = from || getSenderAddress(senderOptions)
  const isTestMode = isTestModeEnabled()
  const recipientEmail = isTestMode ? testEmail.value() : to
  const originalRecipient = Array.isArray(to) ? to.join(', ') : to

  if (isTestMode) {
    console.log(`TEST MODE: Redirecting email from "${originalRecipient}" to "${recipientEmail}"`) // eslint-disable-line no-console
  }

  const mailOptions: nodemailer.SendMailOptions = { from: fromAddress, to: recipientEmail, subject, html, text }
  if (attachments.length > 0) mailOptions.attachments = attachments

  const result = await transporter.sendMail(mailOptions)
  return { ...result, testMode: isTestMode, originalRecipient: isTestMode ? originalRecipient : undefined }
}

export async function sendBatchEmails(emails: SendEmailOptions[], stopOnError = false) {
  const transporter = await getEmailTransporter()
  const results = { total: emails.length, sent: 0, failed: 0, errors: [] as { recipient: string | string[]; error: string }[] }

  for (const emailOptions of emails) {
    try {
      await sendEmail({ ...emailOptions, transporter })
      results.sent++
    } catch (error) {
      const err = error as Error
      results.failed++
      results.errors.push({ recipient: emailOptions.to, error: err.message })
      console.error(`Failed to send email to ${emailOptions.to}:`, err.message) // eslint-disable-line no-console
      if (stopOnError) throw error
    }
  }

  return results
}

export function buildEmailTemplate({ title, body, footer }: { title: string; body: string; footer?: string }) {
  const defaultFooter = footer || 'This is an automated email from Lineup.<br>Please do not reply.'

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
