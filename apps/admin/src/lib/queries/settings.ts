import 'server-only'
import {
  APP_SETTINGS_COLLECTION,
  MOBILE_SETTINGS_DOC,
  PUBLIC_SETTINGS_DOC,
  type AnnouncementStyle,
  type MobileAppSettings,
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

// Secret Manager secret backing DeepL site translation. Matches the name the
// Cloud Functions read (see packages/functions/src/translate/).
export const DEEPL_API_KEY_SECRET = 'deepl-api-key'

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

// Whether the DeepL key backing site translation is set. Google Cloud
// Translation (the other provider) needs no secret at all — it runs on the
// functions service account — so "not configured" here does not mean
// translation is off (see packages/functions/src/translate/provider.ts).
export async function getTranslationStatus(): Promise<{ deeplKeyConfigured: boolean }> {
  return { deeplKeyConfigured: await isSecretConfigured(DEEPL_API_KEY_SECRET) }
}

// Secret Manager names backing Stripe. Stable identifiers matching what the
// Cloud Functions read via getSecret() (packages/functions/src/utils/secrets.ts).
// Two DISTINCT webhook secrets, because there are two endpoints:
//   handleStripeWebhook  → platform/SaaS billing (studios paying Linyup)
//   handleConnectWebhook → Connect (members paying studios) — signed separately
export const STRIPE_SECRET_KEY_SECRET = 'stripe-secret-key'
export const STRIPE_WEBHOOK_SECRET = 'stripe-webhook-secret'
export const STRIPE_CONNECT_WEBHOOK_SECRET = 'stripe-connect-webhook-secret'

export interface StripeStatus {
  secretKeyConfigured: boolean
  webhookSecretConfigured: boolean
  connectWebhookSecretConfigured: boolean
}

export async function getStripeStatus(): Promise<StripeStatus> {
  const [secretKeyConfigured, webhookSecretConfigured, connectWebhookSecretConfigured] =
    await Promise.all([
      isSecretConfigured(STRIPE_SECRET_KEY_SECRET),
      isSecretConfigured(STRIPE_WEBHOOK_SECRET),
      isSecretConfigured(STRIPE_CONNECT_WEBHOOK_SECRET),
    ])

  return { secretKeyConfigured, webhookSecretConfigured, connectWebhookSecretConfigured }
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

export interface MobileSettingsStatus {
  minSupportedVersion: string | null
  updateMessage: string | null
  storeUrlIos: string | null
  storeUrlAndroid: string | null
  updatedMs: number | null
  updatedBy: string | null
}

// The member app's policy (app_settings/mobile, MobileAppSettings). A missing
// doc is "no gate" — exactly what the app reads it as.
export async function getMobileSettingsStatus(): Promise<MobileSettingsStatus> {
  const snap = await adminDb.collection(APP_SETTINGS_COLLECTION).doc(MOBILE_SETTINGS_DOC).get()
  if (!snap.exists) {
    return {
      minSupportedVersion: null,
      updateMessage: null,
      storeUrlIos: null,
      storeUrlAndroid: null,
      updatedMs: null,
      updatedBy: null,
    }
  }
  const d = snap.data() as MobileAppSettings
  return {
    minSupportedVersion: d.min_supported_version ?? null,
    updateMessage: d.update_message ?? null,
    storeUrlIos: d.store_url_ios ?? null,
    storeUrlAndroid: d.store_url_android ?? null,
    updatedMs: d.updated_at?.toMillis?.() ?? null,
    updatedBy: d.updated_by ?? null,
  }
}
