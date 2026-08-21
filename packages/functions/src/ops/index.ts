/**
 * Operator-only callables for the production demo tenant and its review login.
 *
 * The console is the trigger; these are the executor. See `demoTenant.ts` for
 * why that split exists, and `reviewAccess.ts` for the bounds on the fixed code.
 *
 * Every action here is operator-gated by `requireOperator`, which returns the
 * identity so each one can say WHO in its log line — a prod data operation with
 * no attributable actor is not much of an audit trail.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { APP_SETTINGS_COLLECTION } from '@linyup/shared'
import { requireOperator } from '../utils/operator'
import { purgeTeam } from '../saas-billing/purgeTeam'
import { provisionDemoTenant, DEMO_TEAM_ID } from './demoTenant'
import {
  REVIEW_ACCESS_DOC,
  REVIEW_ACCESS_MAX_DAYS,
  clearReviewAccessCache,
} from './reviewAccess'

/**
 * Provision or reset the demo tenant.
 *
 * `reset` purges first and re-provisions — the idempotent path exists too, but a
 * reset is what you want before a submission, because a reviewer will have left
 * bookings behind and `provision` alone converges documents rather than removing
 * ones it no longer writes.
 *
 * Nine minutes: the purge walks every collection in the tenant manifest, and the
 * default sixty seconds is not enough for that plus a re-provision.
 */
export const manageDemoTenant = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const operator = requireOperator(request)
  const { action } = (request.data ?? {}) as { action?: string }

  if (action !== 'provision' && action !== 'reset') {
    throw new HttpsError('invalid-argument', "action must be 'provision' or 'reset'")
  }

  if (action === 'reset') {
    // eslint-disable-next-line no-console
    console.log(`[demo-tenant] reset requested by ${operator}`)
    await purgeTeam(DEMO_TEAM_ID, false)
  }

  const result = await provisionDemoTenant()
  // eslint-disable-next-line no-console
  console.log(`[demo-tenant] ${action} by ${operator}:`, JSON.stringify(result.counts))
  return result
})

/**
 * Turn the review login on or off, and set its code and window.
 *
 * The code is supplied by the operator rather than generated, so it can be typed
 * into App Store Connect first and never has to be read back out of a database.
 */
export const setReviewAccess = onCall(async (request) => {
  const operator = requireOperator(request)
  const data = (request.data ?? {}) as {
    enabled?: boolean
    email?: string
    code?: string
    days?: number
    note?: string
  }

  const ref = admin.firestore().collection(APP_SETTINGS_COLLECTION).doc(REVIEW_ACCESS_DOC)

  // DISABLING must always work, and must not require a well-formed payload —
  // it is the kill switch, and a kill switch that validates its arguments is
  // one you cannot reach in a hurry.
  if (data.enabled === false) {
    await ref.set(
      { enabled: false, updated_at: FieldValue.serverTimestamp(), updated_by: operator },
      { merge: true }
    )
    clearReviewAccessCache()
    // eslint-disable-next-line no-console
    console.log(`[review-otp] disabled by ${operator}`)
    return { enabled: false }
  }

  const email = (data.email ?? '').toLowerCase().trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid contact email is required')
  }
  if (!/^\d{6}$/.test(data.code ?? '')) {
    throw new HttpsError('invalid-argument', 'The code must be exactly six digits')
  }
  const days = Number(data.days)
  if (!Number.isFinite(days) || days <= 0 || days > REVIEW_ACCESS_MAX_DAYS) {
    throw new HttpsError(
      'invalid-argument',
      `The window must be between 1 and ${REVIEW_ACCESS_MAX_DAYS} days`
    )
  }

  const expiresAt = Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
  await ref.set(
    {
      enabled: true,
      email,
      code: data.code,
      expires_at: expiresAt,
      note: data.note ?? null,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: operator,
    },
    { merge: true }
  )
  clearReviewAccessCache()
  // eslint-disable-next-line no-console
  console.log(`[review-otp] enabled for ${email} until ${expiresAt.toDate().toISOString()} by ${operator}`)
  return { enabled: true, email, expiresAtMs: expiresAt.toMillis() }
})

/** What the console renders. The CODE IS NEVER RETURNED — an operator who has
 *  lost it sets a new one; reading it back would put a live credential in a
 *  browser and in every proxy log between here and there. */
export const getReviewAccess = onCall(async (request) => {
  requireOperator(request)
  const snap = await admin
    .firestore()
    .collection(APP_SETTINGS_COLLECTION)
    .doc(REVIEW_ACCESS_DOC)
    .get()
  if (!snap.exists) return { configured: false }
  const d = snap.data() as Record<string, unknown>
  const expiresMs = (d.expires_at as Timestamp | undefined)?.toMillis?.() ?? null
  return {
    configured: true,
    enabled: d.enabled === true,
    email: (d.email as string) ?? null,
    expiresAtMs: expiresMs,
    expired: typeof expiresMs === 'number' ? expiresMs <= Date.now() : true,
    note: (d.note as string) ?? null,
    updatedBy: (d.updated_by as string) ?? null,
  }
})
