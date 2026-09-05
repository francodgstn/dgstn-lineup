'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import {
  APP_SETTINGS_COLLECTION,
  MOBILE_SETTINGS_DOC,
  parseVersion,
  type MobileAppSettings,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

const URL_RE = /^https:\/\/\S+$/

// Writes the member app's policy to the world-readable app_settings/mobile doc
// (MobileAppSettings). The app reads it before sign-in and shows the
// update-required screen to any build older than the minimum.
//
// The version is validated HERE because the app fails OPEN on a malformed one
// (`isVersionBelow` — a typo must never lock every member out), which means a
// typo saved here would silently disable the gate rather than break the app.
export async function setMobileSettings(formData: FormData): Promise<ActionResult> {
  const operator = await requireOperator()

  const rawVersion = String(formData.get('min_supported_version') ?? '').trim()
  const minVersion = rawVersion.length ? rawVersion : null
  if (minVersion && !parseVersion(minVersion)) {
    return { ok: false, error: `'${minVersion}' is not a version (expected major.minor.patch).` }
  }

  const message = String(formData.get('update_message') ?? '').trim()
  const ios = String(formData.get('store_url_ios') ?? '').trim()
  const android = String(formData.get('store_url_android') ?? '').trim()
  if (ios && !URL_RE.test(ios))
    return { ok: false, error: 'The iOS store link must be an https:// URL.' }
  if (android && !URL_RE.test(android))
    return { ok: false, error: 'The Android store link must be an https:// URL.' }
  if (message.length > 300) return { ok: false, error: 'Keep the message under 300 characters.' }

  const settings: MobileAppSettings = {
    min_supported_version: minVersion,
    update_message: message || null,
    store_url_ios: ios || null,
    store_url_android: android || null,
    updated_by: operator.email,
  }

  await adminDb
    .collection(APP_SETTINGS_COLLECTION)
    .doc(MOBILE_SETTINGS_DOC)
    .set({ ...settings, updated_at: FieldValue.serverTimestamp() }, { merge: true })

  revalidatePath('/settings/mobile')
  return { ok: true }
}
