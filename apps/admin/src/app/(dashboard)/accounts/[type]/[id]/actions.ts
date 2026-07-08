'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import {
  TEAMS_COLLECTION,
  MESSAGING_POLICIES_COLLECTION,
  type MessagingMode,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * Operator kill-switch for a team's Stripe Connect (member → studio) payments.
 * Connect is self-serve, so `enabled=false` blocks onboarding + charging, while
 * `true` (or absent) allows the studio to set it up. Writes only the nested
 * `payments.connectEnabled` field so the function-managed account mirror is left
 * untouched.
 */
export async function setConnectEnabled(teamId: string, enabled: boolean): Promise<ActionResult> {
  await requireOperator()
  await adminDb
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .update({
      'payments.connectEnabled': enabled,
      updated_at: FieldValue.serverTimestamp(),
    })
  revalidatePath(`/accounts/team/${teamId}`)
  return { ok: true }
}

// ─── Outbound messaging policy (messaging_policies/{entityId}) ────────────────
// Operator-only delivery control — firestore.rules denies ALL client access, so
// these server actions (Admin SDK) are, next to the seeders and the
// `pnpm messaging:policy` CLI, the only write path. Model:
// packages/functions/src/mail/README.md → "Per-tenant delivery policy".

const MESSAGING_MODES: MessagingMode[] = ['live', 'allowlist', 'redirect', 'silent']

export interface MessagingPolicyInput {
  mode: MessagingMode
  allowEmails: string[]
  allowPhones: string[]
  redirectEmail: string
  redirectPhone: string
}

const EMAIL_RE = /^(@[^\s@]+\.[^\s@]+|[^\s@]+@[^\s@]+\.[^\s@]+)$/ // address or '@domain.tld'
const PHONE_RE = /^\+[1-9]\d{6,14}$/ // E.164

export async function setMessagingPolicy(
  entityId: string,
  input: MessagingPolicyInput,
): Promise<ActionResult> {
  const operator = await requireOperator()

  if (!MESSAGING_MODES.includes(input.mode)) {
    return { ok: false, error: `Invalid mode '${input.mode}'.` }
  }
  // Structural guardrail: /try playground teams have PUBLIC shared owner logins —
  // full live delivery must never be enabled for them, no matter who asks.
  if (input.mode === 'live' && entityId.startsWith('sandbox-')) {
    return { ok: false, error: 'sandbox-* (/try) tenants cannot be set to live delivery.' }
  }

  const allowEmails = [
    ...new Set(input.allowEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ]
  const allowPhones = [
    ...new Set(input.allowPhones.map((p) => p.replace(/[\s\-()]/g, '')).filter(Boolean)),
  ]
  const badEmail = allowEmails.find((e) => !EMAIL_RE.test(e))
  if (badEmail) return { ok: false, error: `Invalid allowlist entry '${badEmail}' (use an address or '@domain.tld').` }
  const badPhone = allowPhones.find((p) => !PHONE_RE.test(p))
  if (badPhone) return { ok: false, error: `Invalid phone '${badPhone}' (use E.164, e.g. +41761234501).` }

  const redirectEmail = input.redirectEmail.trim().toLowerCase()
  const redirectPhone = input.redirectPhone.replace(/[\s\-()]/g, '')
  if (input.mode === 'redirect' && !redirectEmail && !redirectPhone) {
    return { ok: false, error: 'Redirect mode needs a redirect email (and/or phone).' }
  }
  if (redirectEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(redirectEmail)) {
    return { ok: false, error: `Invalid redirect email '${redirectEmail}'.` }
  }
  if (redirectPhone && !PHONE_RE.test(redirectPhone)) {
    return { ok: false, error: `Invalid redirect phone '${redirectPhone}' (E.164).` }
  }

  // Full replace (no merge) — stale fields from a previous mode must not linger.
  await adminDb
    .collection(MESSAGING_POLICIES_COLLECTION)
    .doc(entityId)
    .set({
      entityId,
      mode: input.mode,
      ...(allowEmails.length ? { allowEmails } : {}),
      ...(allowPhones.length ? { allowPhones } : {}),
      ...(redirectEmail ? { redirectEmail } : {}),
      ...(redirectPhone ? { redirectPhone } : {}),
      updated_at: FieldValue.serverTimestamp(),
      updated_by: operator.email,
    })
  revalidatePath(`/accounts/team/${entityId}`)
  revalidatePath(`/accounts/org/${entityId}`)
  return { ok: true }
}

/** Remove the policy — the environment's MESSAGING_DEFAULT_MODE applies again. */
export async function deleteMessagingPolicy(entityId: string): Promise<ActionResult> {
  await requireOperator()
  await adminDb.collection(MESSAGING_POLICIES_COLLECTION).doc(entityId).delete()
  revalidatePath(`/accounts/team/${entityId}`)
  revalidatePath(`/accounts/org/${entityId}`)
  return { ok: true }
}
