'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import {
  APP_SETTINGS_COLLECTION,
  GLOBAL_SETTINGS_DOC,
  PUBLIC_SETTINGS_DOC,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

const MAX_NOTIFY_EMAILS = 10
// Same pragmatic shape check the signup flows use — not RFC-complete.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Writes the global widget switch to the world-readable app_settings/public
// doc (the web app reads it to show/hide the feedback tab) and the private
// notification config to app_settings/global_settings (read fresh by the
// onFeedbackCreated trigger on every submission — changes apply immediately,
// no function restart needed).
export async function setFeedbackSettings(formData: FormData): Promise<ActionResult> {
  const operator = await requireOperator()

  const enabled = formData.get('enabled') === 'on'
  const notifyEnabled = formData.get('notify_enabled') === 'on'

  const rawEmails = String(formData.get('notify_emails') ?? '')
  const emails = [...new Set(
    rawEmails
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )]
  if (emails.length > MAX_NOTIFY_EMAILS) {
    return { ok: false, error: `At most ${MAX_NOTIFY_EMAILS} notification emails.` }
  }
  const invalid = emails.find((e) => !EMAIL_RE.test(e))
  if (invalid) return { ok: false, error: `Invalid email: ${invalid}` }
  if (notifyEnabled && emails.length === 0) {
    return { ok: false, error: 'Add at least one email or turn notifications off.' }
  }

  const settingsCol = adminDb.collection(APP_SETTINGS_COLLECTION)
  await Promise.all([
    settingsCol.doc(PUBLIC_SETTINGS_DOC).set(
      {
        feedback_enabled: enabled,
        feedback_updated_at: FieldValue.serverTimestamp(),
        feedback_updated_by: operator.email,
      },
      { merge: true },
    ),
    settingsCol.doc(GLOBAL_SETTINGS_DOC).set(
      {
        feedback_notify_enabled: notifyEnabled,
        feedback_notify_emails: emails,
      },
      { merge: true },
    ),
  ])

  revalidatePath('/feedback/settings')
  return { ok: true }
}
