import 'server-only'
import {
  APP_SETTINGS_COLLECTION,
  PUBLIC_SETTINGS_DOC,
  type AnnouncementStyle,
  type PlatformAnnouncement,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
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

export interface AnnouncementStatus {
  enabled: boolean
  text: string | null
  style: AnnouncementStyle
  updatedMs: number | null
  updatedBy: string | null
}

// Reads the platform announcement banner config from the world-readable
// app_settings/public doc (fields live flat alongside the signup flag). Missing
// doc / fields = disabled, default 'info' style.
export async function getAnnouncementStatus(): Promise<AnnouncementStatus> {
  const snap = await adminDb.collection(APP_SETTINGS_COLLECTION).doc(PUBLIC_SETTINGS_DOC).get()
  if (!snap.exists) {
    return { enabled: false, text: null, style: 'info', updatedMs: null, updatedBy: null }
  }
  const d = snap.data() as PlatformAnnouncement
  return {
    enabled: d.announcement_enabled === true,
    text: d.announcement_text ?? null,
    style: d.announcement_style ?? 'info',
    updatedMs: d.announcement_updated_at?.toMillis?.() ?? null,
    updatedBy: d.announcement_updated_by ?? null,
  }
}
