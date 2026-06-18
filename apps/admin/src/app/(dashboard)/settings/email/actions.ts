'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import { APP_SETTINGS_COLLECTION, GLOBAL_SETTINGS_DOC } from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'
import { setSecret, SecretManagerUnavailableError } from '@/lib/secret-manager'
import { SMTP_PASSWORD_SECRET } from '@/lib/queries/settings'

export interface SaveSmtpResult {
  ok: boolean
  error?: string
  // Set when the config saved but the password could not be stored (e.g. running
  // against the emulators where Secret Manager is unavailable).
  warning?: string
}

export async function saveGlobalSmtp(formData: FormData): Promise<SaveSmtpResult> {
  // Server actions are public POST endpoints — re-verify the operator here.
  const operator = await requireOperator()

  const host = String(formData.get('host') ?? '').trim()
  const portRaw = String(formData.get('port') ?? '').trim()
  const secure = formData.get('secure') === 'on' || formData.get('secure') === 'true'
  const user = String(formData.get('user') ?? '').trim()
  const password = String(formData.get('password') ?? '') // never trimmed

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!host) return { ok: false, error: 'Host is required.' }
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Port must be a whole number between 1 and 65535.' }
  }
  if (!user) return { ok: false, error: 'Username is required.' }

  const docRef = adminDb.collection(APP_SETTINGS_COLLECTION).doc(GLOBAL_SETTINGS_DOC)

  // Has a password ever been stored? Required on first save (there's nothing in
  // Secret Manager to fall back on yet).
  const existing = await docRef.get()
  const existingSmtp = (existing.data()?.nodemailer_smtp ?? null) as
    | { password_set?: boolean }
    | null
  const alreadyHasPassword = existingSmtp?.password_set === true

  if (!password && !alreadyHasPassword) {
    return { ok: false, error: 'A password is required for the initial save.' }
  }

  // ── Store the password in Secret Manager (only when a new one was entered) ──
  let warning: string | undefined
  let passwordSet = alreadyHasPassword
  let passwordUpdated = false

  if (password) {
    try {
      await setSecret(SMTP_PASSWORD_SECRET, password)
      passwordSet = true
      passwordUpdated = true
    } catch (err) {
      if (err instanceof SecretManagerUnavailableError) {
        // Local/emulator dev — save the rest, warn that the password didn't persist.
        warning = err.message
      } else {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Failed to store the password: ${message}` }
      }
    }
  }

  // ── Persist the non-secret config ───────────────────────────────────────────
  const smtp: Record<string, unknown> = {
    host,
    port,
    secure,
    auth: { user },
    password_set: passwordSet,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: operator.email,
  }
  if (passwordUpdated) smtp.password_updated_at = FieldValue.serverTimestamp()

  await docRef.set({ nodemailer_smtp: smtp }, { merge: true })

  revalidatePath('/settings/email')
  return { ok: true, warning }
}
