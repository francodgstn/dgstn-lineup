import * as admin from 'firebase-admin'
import { APP_SETTINGS_COLLECTION, GLOBAL_SETTINGS_DOC } from '@linyup/shared'

let cachedSettings: Record<string, unknown> | null = null

export async function getAppSettings(): Promise<Record<string, unknown>> {
  if (cachedSettings) return cachedSettings

  const doc = await admin.firestore().collection(APP_SETTINGS_COLLECTION).doc(GLOBAL_SETTINGS_DOC).get()

  if (!doc.exists) {
    throw new Error('app_settings/global_settings document not found')
  }

  cachedSettings = doc.data() as Record<string, unknown>
  return cachedSettings
}
