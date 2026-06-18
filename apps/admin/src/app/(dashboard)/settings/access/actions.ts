'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import {
  APP_SETTINGS_COLLECTION,
  PUBLIC_SETTINGS_DOC,
  SIGNUP_ALLOWLIST_COLLECTION,
  SIGNUP_INVITES_COLLECTION,
  normalizeEmail,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Toggle public signup. Writes app_settings/public — the doc the web client and
// the beforeUserCreated blocking function both read.
export async function setPublicSignup(enabled: boolean): Promise<ActionResult> {
  const operator = await requireOperator()
  await adminDb
    .collection(APP_SETTINGS_COLLECTION)
    .doc(PUBLIC_SETTINGS_DOC)
    .set(
      {
        public_signup_enabled: enabled,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: operator.email,
      },
      { merge: true },
    )
  revalidatePath('/settings/access')
  return { ok: true }
}

// Authorize an email to sign up even while public signup is closed. Optionally
// (default on) queue an invite email by writing signup_invites/{id}, which the
// onSignupInviteCreated Cloud Function turns into a branded message.
export async function addAllowlistEmail(formData: FormData): Promise<ActionResult> {
  const operator = await requireOperator()

  const raw = String(formData.get('email') ?? '').trim()
  if (!raw || !EMAIL_RE.test(raw)) return { ok: false, error: 'Enter a valid email address.' }
  const email = normalizeEmail(raw)
  const note = String(formData.get('note') ?? '').trim()
  // Checkbox is checked by default in the UI (auto-invite); unchecked = absent.
  const sendInvite = formData.get('invite') === 'on'

  await adminDb
    .collection(SIGNUP_ALLOWLIST_COLLECTION)
    .doc(email)
    .set(
      {
        email,
        added_by: operator.email,
        added_at: FieldValue.serverTimestamp(),
        ...(note ? { note } : {}),
      },
      { merge: true },
    )

  if (sendInvite) {
    await adminDb.collection(SIGNUP_INVITES_COLLECTION).add({
      email,
      created_by: operator.email,
      created_at: FieldValue.serverTimestamp(),
    })
  }

  revalidatePath('/settings/access')
  return { ok: true }
}

export async function removeAllowlistEmail(formData: FormData): Promise<ActionResult> {
  await requireOperator()
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  if (!email) return { ok: false, error: 'Missing email.' }
  await adminDb.collection(SIGNUP_ALLOWLIST_COLLECTION).doc(email).delete()
  revalidatePath('/settings/access')
  return { ok: true }
}
