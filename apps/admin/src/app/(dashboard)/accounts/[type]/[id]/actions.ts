'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import {
  TEAMS_COLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
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

/**
 * DETACH a team's Stripe connected account.
 *
 * `setConnectEnabled(false)` above stops charges but leaves the account LINKED —
 * which is why `purgeTeam` flags `connect_accounts` as
 * `externalTeardown: 'stripe_connect'` and its runbook ends in a manual step in
 * the Stripe dashboard. Nothing in the product could sever the link, so a studio
 * that left Linyup kept its account pointed here, and a torn-down tenant left an
 * orphan behind.
 *
 * OPERATOR-ONLY, deliberately. A studio-facing version needs to reason about
 * pending payouts and reversals, and getting that wrong strands a customer's
 * money; the guards below are enough to keep an operator from breaking a live
 * tenant, not enough to hand to one.
 *
 * It clears the local link only. The account continues to exist at Stripe, under
 * the platform, and is untouched — this is a disconnect, not a deletion, and the
 * caller still has to decide what happens to it there.
 */
export async function disconnectConnectAccount(teamId: string): Promise<ActionResult> {
  await requireOperator()

  const teamRef = adminDb.collection(TEAMS_COLLECTION).doc(teamId)
  const teamSnap = await teamRef.get()
  if (!teamSnap.exists) return { ok: false, error: 'Team not found.' }
  const payments = (teamSnap.data()?.payments ?? {}) as { connectAccountId?: string }
  const accountId = payments.connectAccountId
  if (!accountId) return { ok: false, error: 'This team has no connected account.' }

  // ── Refuse while anything still depends on it ────────────────────────────
  // A live recurring subscription bills through this account; disconnecting
  // under it would leave Stripe charging for a link the product no longer knows
  // about. Same live set the checkout path uses.
  const LIVE = new Set(['active', 'trialing', 'past_due'])
  const subs = await teamRef.collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION).get()
  const liveSubs = subs.docs.filter((d) => LIVE.has((d.data().status as string) ?? '')).length
  if (liveSubs > 0) {
    return {
      ok: false,
      error: `${liveSubs} live member subscription${liveSubs === 1 ? '' : 's'} still bill through this account. Cancel them in Stripe first.`,
    }
  }

  // An in-flight checkout holds a seat and expects a webhook that will arrive
  // after the link is gone. Short-lived (30 min), so this is a "try again
  // shortly" rather than a real obstacle.
  const holds = await adminDb
    .collectionGroup('bookings')
    .where('teamId', '==', teamId)
    .where('status', '==', 'pending_payment')
    .limit(1)
    .get()
  if (!holds.empty) {
    return {
      ok: false,
      error: 'A checkout is still in flight for this team. Wait for it to complete or expire (30 min), then try again.',
    }
  }

  // ── Sever both sides of the link ─────────────────────────────────────────
  // `connect_accounts/{acct}.teamId` is the only account → team map the Connect
  // webhook has, so removing it is what actually stops routing.
  await adminDb.collection('connect_accounts').doc(accountId).delete()
  await teamRef.update({
    payments: FieldValue.delete(),
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
