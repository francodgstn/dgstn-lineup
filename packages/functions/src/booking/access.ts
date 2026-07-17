// The paid-access gate shared by bookSession (group classes) and bookAppointment
// (1:1 appointments). An activity's accessRule ('open' | 'members' | 'subscription')
// is enforced here against an already-resolved authenticated contact (or null for
// a guest) — the single source of truth so both booking flows agree.
import * as admin from 'firebase-admin'
import { HttpsError } from 'firebase-functions/v2/https'
import type { Timestamp } from 'firebase-admin/firestore'
import type { ActivityAccessRule, SubscriptionPrice } from '@linyup/shared'

/**
 * Does HOLDING a subscription of this type grant unmetered (non-credit) access?
 * Used by the booking access gate: credit-pack types must not pass on the
 * membership snapshot alone — their access is metered by credit balance.
 *   • The contact's held price is a non-credit price of this type → true.
 *   • The contact's held price is a credit price of this type      → false.
 *   • Price unknown: true unless EVERY active price carries credits (a
 *     credits-only type can only ever grant metered access).
 */
async function typeGrantsUnmeteredAccess(
  teamId: string,
  subscriptionTypeId: string,
  contact: FirebaseFirestore.DocumentData
): Promise<boolean> {
  try {
    const snap = await admin
      .firestore()
      .collection('teams')
      .doc(teamId)
      .collection('subscription_types')
      .doc(subscriptionTypeId)
      .get()
    if (!snap.exists) return true // unknown type — behave as before credits existed
    const prices = ((snap.data()?.prices as SubscriptionPrice[] | undefined) ?? []).filter(
      (p) => p.active !== false
    )
    if (prices.length === 0 || prices.every((p) => !p.credits)) return true
    const heldPriceId =
      contact.subscription_type_id === subscriptionTypeId
        ? (contact.subscription_price_id as string | undefined)
        : undefined
    if (heldPriceId) {
      const heldPrice = prices.find((p) => p.id === heldPriceId)
      if (heldPrice) return !heldPrice.credits
    }
    // Held price unknown: lenient unless the type is credits-only.
    return prices.some((p) => !p.credits)
  } catch {
    return true // fail open — same behavior as before the credits feature
  }
}

export interface AccessGateResult {
  /** The subscription type whose coverage matched, or null (open/members rule,
   *  or no subscription check was needed). */
  matchedSubscriptionTypeId: string | null
  /** Set when the match came from a lesson-credit pack — the caller must spend
   *  one credit of this type atomically with the booking write. */
  creditSpendTypeId: string | null
}

/** Why coverage was denied — null means it wasn't (the caller is covered). */
export type BookingAccessDenialReason = 'guest' | 'not_joined' | 'no_subscription' | 'no_credits'

export interface BookingCoverageResult extends AccessGateResult {
  /** Whether the accessRule is satisfied — the non-throwing twin of
   *  resolveBookingAccessGate's "doesn't throw". */
  covered: boolean
  denial: BookingAccessDenialReason | null
}

function denialMessage(denial: BookingAccessDenialReason, isAppointment: boolean): string {
  switch (denial) {
    case 'guest':
      return isAppointment
        ? 'This appointment series is for registered members only. Please verify your email.'
        : 'This session is for registered members only. Please verify your email.'
    case 'not_joined':
      return isAppointment
        ? 'This appointment series is for members only. Trial accounts cannot book.'
        : 'This session is for members only. Trial accounts cannot book this class.'
    case 'no_credits':
      return 'No lesson credits remaining on your pack. Purchase a new pack to book this class.'
    case 'no_subscription':
      return 'This class requires an active membership you do not currently hold.'
  }
}

/**
 * Non-throwing core of the paid-access gate: does this (already-resolved)
 * authenticated contact — or null for a guest — satisfy an activity's
 * accessRule? Pure move of the logic that used to live inline in
 * resolveBookingAccessGate (still the thrower bookSession uses); appointment
 * checkout reuses this to compute coverage WITHOUT refusing guests (payment is
 * proof — see appointments/checkout.ts).
 */
export async function resolveBookingCoverage(params: {
  teamId: string
  accessRule: ActivityAccessRule
  authenticatedContact: (admin.firestore.DocumentData & { id: string }) | null
}): Promise<BookingCoverageResult> {
  const { teamId, accessRule, authenticatedContact } = params
  const NONE: BookingCoverageResult = {
    covered: true,
    matchedSubscriptionTypeId: null,
    creditSpendTypeId: null,
    denial: null,
  }
  if (accessRule.type === 'open') return NONE

  if (!authenticatedContact) {
    return { covered: false, matchedSubscriptionTypeId: null, creditSpendTypeId: null, denial: 'guest' }
  }
  if (authenticatedContact.acquisition_stage !== 'joined') {
    return { covered: false, matchedSubscriptionTypeId: null, creditSpendTypeId: null, denial: 'not_joined' }
  }

  if (accessRule.type !== 'subscription') return NONE

  const allowed = accessRule.subscriptionTypeIds ?? []
  // Coverage = any LIVE subscription the contact holds (fallback: primary snapshot).
  const held = new Set<string>()
  const active =
    (authenticatedContact.active_subscriptions as
      | Array<{ subscription_type_id?: string }>
      | undefined) ?? []
  active.forEach((s) => {
    if (s.subscription_type_id) held.add(s.subscription_type_id)
  })
  if (authenticatedContact.subscription_type_id) held.add(authenticatedContact.subscription_type_id)

  // Lesson-credit balances (denormalised rollup; expiry re-checked on spend).
  const nowMs = Date.now()
  const creditTypes = new Set(
    (
      (authenticatedContact.credit_summary as
        | Array<{
            subscription_type_id: string
            remaining: number
            next_expires_at?: Timestamp | null
          }>
        | undefined) ?? []
    )
      .filter((e) => e.remaining > 0 && (!e.next_expires_at || e.next_expires_at.toMillis() > nowMs))
      .map((e) => e.subscription_type_id)
  )

  // 1) Unmetered coverage first — a held subscription whose type isn't
  //    credits-only never burns credits.
  let matchedSubscriptionTypeId: string | null = null
  for (const id of allowed) {
    if (!held.has(id)) continue
    if (await typeGrantsUnmeteredAccess(teamId, id, authenticatedContact)) {
      matchedSubscriptionTypeId = id
      break
    }
  }
  // 2) Credit coverage — spend one credit (transactionally, at booking write).
  let creditSpendTypeId: string | null = null
  if (!matchedSubscriptionTypeId) {
    const creditType = allowed.find((id) => creditTypes.has(id))
    if (creditType) {
      matchedSubscriptionTypeId = creditType
      creditSpendTypeId = creditType
    }
  }
  if (!matchedSubscriptionTypeId) {
    const heldCreditType = allowed.some((id) => held.has(id))
    return {
      covered: false,
      matchedSubscriptionTypeId: null,
      creditSpendTypeId: null,
      denial: heldCreditType ? 'no_credits' : 'no_subscription',
    }
  }
  return { covered: true, matchedSubscriptionTypeId, creditSpendTypeId, denial: null }
}

/**
 * Enforce an activity's accessRule against an already-resolved authenticated
 * contact (or null for a guest). Throws HttpsError on denial. Shared by
 * bookSession (group classes) and bookAppointment (1:1 appointments) so both
 * agree on the paid-access axis. Thin thrower over resolveBookingCoverage —
 * class behaviour is unchanged.
 */
export async function resolveBookingAccessGate(params: {
  teamId: string
  accessRule: ActivityAccessRule
  authenticatedContact: (admin.firestore.DocumentData & { id: string }) | null
  /** Drives denial-message wording only. */
  isAppointment: boolean
}): Promise<AccessGateResult> {
  const coverage = await resolveBookingCoverage(params)
  if (coverage.denial) {
    throw new HttpsError('permission-denied', denialMessage(coverage.denial, params.isAppointment))
  }
  return { matchedSubscriptionTypeId: coverage.matchedSubscriptionTypeId, creditSpendTypeId: coverage.creditSpendTypeId }
}
