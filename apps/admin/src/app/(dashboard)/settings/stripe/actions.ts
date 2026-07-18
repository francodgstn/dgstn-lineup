'use server'

import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/lib/require-operator'
import { getSecretValue, setSecret, SecretManagerUnavailableError } from '@/lib/secret-manager'
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

export interface VerifyKeyResult {
  ok: boolean
  error?: string
  warning?: string
  /** Stripe account the key belongs to, so the operator can confirm it's the
   *  right account — and whether it's LIVE or TEST mode. */
  accountId?: string
  accountName?: string
  livemode?: boolean
}

// Reads the stored secret key and asks Stripe who it belongs to (GET /v1/account
// — read-only). This is the check that catches the two mistakes that otherwise
// surface only at the first real charge: a test key deployed to production, or a
// key belonging to the wrong Stripe account.
export async function verifyStripeKey(): Promise<VerifyKeyResult> {
  await requireOperator()

  let secretKey: string
  try {
    secretKey = await getSecretValue(STRIPE_SECRET_KEY_SECRET)
  } catch (err) {
    if (err instanceof SecretManagerUnavailableError) return { ok: false, warning: err.message }
    if ((err as { code?: number }).code === 5) {
      return { ok: false, error: 'No Stripe secret key is configured yet.' }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        detail = body?.error?.message ? `: ${body.error.message}` : ''
      } catch {
        /* ignore non-JSON error bodies */
      }
      return { ok: false, error: `Stripe rejected the key (${res.status})${detail}` }
    }
    const acct = (await res.json()) as {
      id?: string
      business_profile?: { name?: string | null }
      settings?: { dashboard?: { display_name?: string | null } }
      charges_enabled?: boolean
    }
    return {
      ok: true,
      accountId: acct.id,
      accountName:
        acct.settings?.dashboard?.display_name || acct.business_profile?.name || undefined,
      // Stripe doesn't return livemode on /v1/account; the key prefix is the
      // authoritative signal and is what an operator actually needs to see.
      livemode: secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_'),
    }
  } catch (err) {
    return { ok: false, error: `Check failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
