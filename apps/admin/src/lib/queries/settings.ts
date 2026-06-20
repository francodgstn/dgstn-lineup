import 'server-only'
import { secretExists, SecretManagerUnavailableError } from '@/lib/secret-manager'

// Secret Manager secret names that back Brevo. Stable identifiers — these match
// the names the Cloud Functions read (see packages/functions/src/mail/).
export const BREVO_API_KEY_SECRET = 'brevo-api-key'
export const BREVO_WEBHOOK_SECRET = 'brevo-webhook-secret'

// The fixed system sender all platform mail is sent from under Brevo. There is
// no global SMTP fallback any more — system mail goes out via Brevo, authed by
// the brevo-api-key secret.
export const BREVO_SYSTEM_SENDER = 'hello@linyup.com'

export interface BrevoStatus {
  apiKeyConfigured: boolean
  webhookSecretConfigured: boolean
  systemSender: string
}

// Best-effort "is this secret set?" — never throws. A missing secret, or Secret
// Manager being unavailable (emulators), both read as "not configured".
async function isSecretConfigured(secretName: string): Promise<boolean> {
  try {
    return await secretExists(secretName)
  } catch (err) {
    if (err instanceof SecretManagerUnavailableError) return false
    // Surface unexpected failures rather than silently masking them as "not set".
    throw err
  }
}

// Reads whether Brevo is wired up: the API key (system mail auth) and the
// webhook secret (token that authenticates Brevo's event callbacks). The system
// sender is fixed, not stored.
export async function getBrevoStatus(): Promise<BrevoStatus> {
  const [apiKeyConfigured, webhookSecretConfigured] = await Promise.all([
    isSecretConfigured(BREVO_API_KEY_SECRET),
    isSecretConfigured(BREVO_WEBHOOK_SECRET),
  ])

  return {
    apiKeyConfigured,
    webhookSecretConfigured,
    systemSender: BREVO_SYSTEM_SENDER,
  }
}
