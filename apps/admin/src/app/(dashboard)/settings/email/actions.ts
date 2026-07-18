'use server'

import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/lib/require-operator'
import {
  getSecretValue,
  setSecret,
  SecretManagerUnavailableError,
} from '@/lib/secret-manager'
import { BREVO_API_KEY_SECRET, BREVO_SYSTEM_SENDER, BREVO_WEBHOOK_SECRET } from '@/lib/queries/settings'
import type { SaveSecretResult } from '@/components/secret-field'

// Shared write path for the two Brevo secrets. Re-verifies the operator (server
// actions are public POST endpoints), then stores the value in Secret Manager.
async function saveBrevoSecret(
  secretName: string,
  label: string,
  value: string,
): Promise<SaveSecretResult> {
  await requireOperator()

  if (!value) return { ok: false, error: `${label} is required.` }

  try {
    await setSecret(secretName, value)
  } catch (err) {
    if (err instanceof SecretManagerUnavailableError) {
      // Local/emulator dev — nothing was persisted; warn rather than fail.
      revalidatePath('/settings/email')
      return { ok: true, warning: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to store the ${label.toLowerCase()}: ${message}` }
  }

  revalidatePath('/settings/email')
  return { ok: true }
}

export async function saveBrevoApiKey(formData: FormData): Promise<SaveSecretResult> {
  const value = String(formData.get('apiKey') ?? '').trim()
  return saveBrevoSecret(BREVO_API_KEY_SECRET, 'API key', value)
}

export async function saveBrevoWebhookSecret(formData: FormData): Promise<SaveSecretResult> {
  const value = String(formData.get('webhookSecret') ?? '').trim()
  return saveBrevoSecret(BREVO_WEBHOOK_SECRET, 'Webhook secret', value)
}

export interface SendTestResult {
  ok: boolean
  error?: string
  warning?: string
  sentTo?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Sends a Brevo **system** test email (from hello@linyup.com) so the operator can
// verify the API key + sender are working. Recipient defaults to the operator's
// own address; an explicit value overrides it.
export async function sendBrevoTestEmail(formData: FormData): Promise<SendTestResult> {
  const operator = await requireOperator()

  const toRaw = String(formData.get('to') ?? '').trim()
  const recipient = toRaw || operator.email
  if (!EMAIL_RE.test(recipient)) return { ok: false, error: 'Enter a valid recipient email address.' }

  let apiKey: string
  try {
    apiKey = await getSecretValue(BREVO_API_KEY_SECRET)
  } catch (err) {
    if (err instanceof SecretManagerUnavailableError) return { ok: false, warning: err.message }
    if ((err as { code?: number }).code === 5) return { ok: false, error: 'No Brevo API key is configured yet.' }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Call Brevo's transactional endpoint directly (no SDK in the admin app — keeps
  // the bundle lean and avoids Turbopack resolving a heavy Node SDK). The mail
  // service in packages/functions handles all real app mail; this is an
  // operator-only sanity check of the API key + system sender.
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Linyup', email: BREVO_SYSTEM_SENDER },
        to: [{ email: recipient }],
        subject: 'Linyup system test email',
        htmlContent:
          '<p>This is a Linyup <strong>system</strong> test email sent via Brevo.</p>' +
          '<p>If you received this, system mail is configured correctly.</p>',
        textContent:
          'This is a Linyup system test email sent via Brevo.\n\n' +
          'If you received this, system mail is configured correctly.',
        tags: ['test', 'system'],
      }),
    })

    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as { message?: string }
        detail = body?.message ? `: ${body.message}` : ''
      } catch {
        /* ignore non-JSON error bodies */
      }
      return { ok: false, error: `Send failed (${res.status})${detail}` }
    }
  } catch (err) {
    return { ok: false, error: `Send failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  return { ok: true, sentTo: recipient }
}
