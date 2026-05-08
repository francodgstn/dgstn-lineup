import * as admin from 'firebase-admin'

let cachedSettings: Record<string, unknown> | null = null

export async function getAppSettings(): Promise<Record<string, unknown>> {
  if (cachedSettings) return cachedSettings

  const doc = await admin.firestore().collection('app_settings').doc('global_settings').get()

  if (!doc.exists) {
    throw new Error('app_settings/global_settings document not found')
  }

  cachedSettings = doc.data() as Record<string, unknown>
  return cachedSettings
}
