'use server'

import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/lib/require-operator'
import { setSecret, SecretManagerUnavailableError } from '@/lib/secret-manager'
import {
  STRIPE_CONNECT_WEBHOOK_SECRET,
  STRIPE_SECRET_KEY_SECRET,
  STRIPE_WEBHOOK_SECRET,
} from '@/lib/queries/settings'
import type { SaveSecretResult } from '@/components/secret-field'

// Shared write path for the three Stripe secrets. Re-verifies the operator —
// server actions are public POST endpoints, so the page-level check is not
// enough — then stores the value in Secret Manager.
async function saveStripeSecret(
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
      revalidatePath('/settings/stripe')
      return { ok: true, warning: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to store the ${label.toLowerCase()}: ${message}` }
  }

  revalidatePath('/settings/stripe')
  return { ok: true }
}

export async function saveStripeSecretKey(formData: FormData): Promise<SaveSecretResult> {
  const value = String(formData.get('secretKey') ?? '').trim()
  // Cheap shape check — a publishable key here would fail confusingly much later,
  // at the first charge, rather than now.
  if (value && value.startsWith('pk_')) {
    return { ok: false, error: 'That is a publishable key (pk_…). The secret key starts with sk_ or rk_.' }
  }
  return saveStripeSecret(STRIPE_SECRET_KEY_SECRET, 'Secret key', value)
}

export async function saveStripeWebhookSecret(formData: FormData): Promise<SaveSecretResult> {
  const value = String(formData.get('webhookSecret') ?? '').trim()
  if (value && !value.startsWith('whsec_')) {
    return { ok: false, error: 'A Stripe webhook signing secret starts with whsec_.' }
  }
  return saveStripeSecret(STRIPE_WEBHOOK_SECRET, 'Webhook signing secret', value)
}

export async function saveStripeConnectWebhookSecret(formData: FormData): Promise<SaveSecretResult> {
  const value = String(formData.get('connectWebhookSecret') ?? '').trim()
  if (value && !value.startsWith('whsec_')) {
    return { ok: false, error: 'A Stripe webhook signing secret starts with whsec_.' }
  }
  return saveStripeSecret(STRIPE_CONNECT_WEBHOOK_SECRET, 'Connect webhook signing secret', value)
}

// NOTE: the "verify key" action was removed deliberately. It read the Stripe
// secret key in plaintext (getSecretValue) to call GET /v1/account, which is the
// ONLY reason the console's runtime SA would need roles/secretmanager.secretAccessor.
// Reporting whether a secret is SET needs only roles/secretmanager.viewer
// (versions.get, metadata — no payload). That check was genuinely useful: it caught
// a test key deployed to prod, or a key on the wrong Stripe account. If you want it
// back, it costs plaintext read of a live key — decide that explicitly.
