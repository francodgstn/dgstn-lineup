/* eslint-disable no-console */
// Publishes the messaging-related ENV params of THIS functions deployment to
// Firestore (app_settings/messaging_env) so the operator console can display
// the environment layer next to a tenant's messaging policy — the card would
// otherwise show an allowlist while TEST_MODE silently redirects everything.
//
// Written from the functions runtime itself (the only place the deployed param
// values actually exist), refreshed by the hourly reminder schedule + the daily
// batch — so the doc reflects a new deploy within the hour. Firestore rules
// have no match for this doc (client access denied); the operator console reads
// it via the Admin SDK.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { defineString } from 'firebase-functions/params'
import { APP_SETTINGS_COLLECTION } from '@linyup/shared'

// Re-declared handles to params owned by mailService/smsService/messagingPolicy —
// defineString returns the same param object for the same name, so .value()
// reads the identical deployed value.
const mailEnabled = defineString('MAIL_ENABLED', { default: 'true' })
const smsEnabled = defineString('SMS_ENABLED', { default: 'false' })
const testMode = defineString('TEST_MODE', { default: 'false' })
const testEmail = defineString('TEST_EMAIL', { default: '' })
const defaultMode = defineString('MESSAGING_DEFAULT_MODE', { default: 'live' })

export const MESSAGING_ENV_DOC = 'messaging_env'

export interface MessagingEnvSnapshot {
  mail_enabled: boolean
  sms_enabled: boolean
  test_mode: boolean
  test_email: string | null
  default_mode: string
}

export function buildMessagingEnvSnapshot(): MessagingEnvSnapshot {
  return {
    mail_enabled: mailEnabled.value() !== 'false',
    sms_enabled: smsEnabled.value() === 'true',
    test_mode: testMode.value() === 'true',
    test_email: testMode.value() === 'true' ? testEmail.value() || null : null,
    default_mode: defaultMode.value(),
  }
}

/** Idempotent hourly/daily publish — one tiny doc write. */
export async function publishMessagingEnv(): Promise<void> {
  try {
    await admin
      .firestore()
      .collection(APP_SETTINGS_COLLECTION)
      .doc(MESSAGING_ENV_DOC)
      .set({ ...buildMessagingEnvSnapshot(), updated_at: FieldValue.serverTimestamp() })
  } catch (err) {
    console.warn('[messaging] failed to publish env snapshot:', err)
  }
}
