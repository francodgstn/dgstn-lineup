'use server'

import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/lib/require-operator'
import { setSecret, SecretManagerUnavailableError } from '@/lib/secret-manager'
import { BREVO_API_KEY_SECRET, BREVO_WEBHOOK_SECRET } from '@/lib/queries/settings'
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

// NOTE: the "send test email" action was removed deliberately. It read the Brevo
// API key in plaintext (getSecretValue), which is the ONLY reason the console's
// runtime SA would need roles/secretmanager.secretAccessor. The console only
// needs to know WHETHER a secret is set — that is roles/secretmanager.viewer
// (versions.get, metadata) and grants no payload access. Re-adding a test action
// here means re-granting plaintext read of a live API key; do it knowingly.
