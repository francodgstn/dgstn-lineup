'use server'

import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/lib/require-operator'
import { setSecret, SecretManagerUnavailableError } from '@/lib/secret-manager'
import { DEEPL_API_KEY_SECRET } from '@/lib/queries/settings'
import type { SaveSecretResult } from '@/components/secret-field'

// Write path for the DeepL key backing site translation. Same contract as the
// Brevo actions: re-verify the operator (server actions are public POST
// endpoints), store write-only in Secret Manager, warn instead of failing
// against the emulators.
export async function saveDeeplApiKey(formData: FormData): Promise<SaveSecretResult> {
  await requireOperator()

  const value = String(formData.get('apiKey') ?? '').trim()
  if (!value) return { ok: false, error: 'API key is required.' }

  try {
    await setSecret(DEEPL_API_KEY_SECRET, value)
  } catch (err) {
    if (err instanceof SecretManagerUnavailableError) {
      revalidatePath('/settings/translation')
      return { ok: true, warning: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to store the API key: ${message}` }
  }

  revalidatePath('/settings/translation')
  return { ok: true }
}
