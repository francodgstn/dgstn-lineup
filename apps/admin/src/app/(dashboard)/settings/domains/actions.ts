'use server'

import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/lib/require-operator'
import { setSecret, SecretManagerUnavailableError } from '@/lib/secret-manager'
import { CLOUDFLARE_API_TOKEN_SECRET } from '@/lib/queries/domains'
import type { SaveSecretResult } from '@/components/secret-field'

/**
 * Stores the platform's Cloudflare API token. Re-verifies the operator, because
 * a server action is a public POST endpoint.
 *
 * Write-only, like the Brevo and Stripe secrets next door: the console needs to
 * know only WHETHER a secret is set (roles/secretmanager.viewer), never its
 * value. Do not add a "test the token" action here without understanding that it
 * would require granting the console plaintext read of a live credential — the
 * same trade the removed Brevo test-send made, and the reason it was removed.
 */
export async function saveCloudflareToken(formData: FormData): Promise<SaveSecretResult> {
  await requireOperator()

  const value = String(formData.get('cloudflareToken') ?? '').trim()
  if (!value) return { ok: false, error: 'API token is required.' }

  try {
    await setSecret(CLOUDFLARE_API_TOKEN_SECRET, value)
  } catch (err) {
    if (err instanceof SecretManagerUnavailableError) {
      revalidatePath('/settings/domains')
      return { ok: true, warning: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to store the API token: ${message}` }
  }

  revalidatePath('/settings/domains')
  return { ok: true }
}
