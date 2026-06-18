import 'server-only'
import {
  APP_SETTINGS_COLLECTION,
  GLOBAL_SETTINGS_DOC,
  type GlobalSmtpSettings,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'

export interface GlobalSmtpView {
  host: string
  port: number | null
  secure: boolean
  user: string
  passwordSet: boolean
  passwordUpdatedMs: number | null
  updatedMs: number | null
  updatedBy: string | null
}

const SMTP_PASSWORD_SECRET = 'smtp-password'

function globalSettingsRef() {
  return adminDb.collection(APP_SETTINGS_COLLECTION).doc(GLOBAL_SETTINGS_DOC)
}

// Reads the platform-wide SMTP fallback (app_settings/global_settings.nodemailer_smtp).
// Returns null when nothing has been configured yet.
export async function getGlobalSmtp(): Promise<GlobalSmtpView | null> {
  const snap = await globalSettingsRef().get()
  if (!snap.exists) return null

  const smtp = (snap.data()?.nodemailer_smtp ?? null) as GlobalSmtpSettings | null
  if (!smtp) return null

  return {
    host: smtp.host ?? '',
    port: typeof smtp.port === 'number' ? smtp.port : null,
    secure: smtp.secure ?? false,
    user: smtp.auth?.user ?? '',
    passwordSet: smtp.password_set ?? false,
    passwordUpdatedMs: smtp.password_updated_at?.toMillis?.() ?? null,
    updatedMs: smtp.updated_at?.toMillis?.() ?? null,
    updatedBy: smtp.updated_by ?? null,
  }
}

export { SMTP_PASSWORD_SECRET }
