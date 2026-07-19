// The paid-access gate shared by bookSession (group classes) and bookAppointment
// (1:1 appointments). An activity's accessRule ('open' | 'members' | 'subscription')
// is enforced here against an already-resolved authenticated contact (or null for
// a guest) — the single source of truth so both booking flows agree.
// CLASS-ONLY as of 2026-07 — appointments dropped the access gate entirely (money
// is the only gate there; see `ActivityMemberBenefit` in @linyup/shared). This
// file's held/credit core is shared with `resolveHeldBenefit` below, which is the
// appointments-only (non-throwing, money-only) parallel read over the same data.
import * as admin from 'firebase-admin'
import { HttpsError } from 'firebase-functions/v2/https'
import type { Timestamp } from 'firebase-admin/firestore'
import {
  GUEST_SNAPSHOT,
  resolvePaymentOptions,
  resolveUsageLimit,
  usageWindowDocId,
  type ActivityAccessRule,
  type ContactPaymentSnapshot,
  type SubscriptionPrice,
  type SubscriptionUsageLimit,
} from '@linyup/shared'

/**
 * Does HOLDING a subscription of this type grant unmetered (non-credit) access?
 * Used by the booking access gate: credit-pack types must not pass on the
 * membership snapshot alone — their access is metered by credit balance.
 *   • The contact's held price is a non-credit price of this type → true.
 *   • The contact's held price is a credit price of this type      → false.
 *   • Price unknown: true unless EVERY active price carries credits (a
 *     credits-only type can only ever grant metered access).
 */
async function classifyHeldType(
  teamId: string,
  subscriptionTypeId: string,
  contact: FirebaseFirestore.DocumentData
): Promise<{ unmetered: boolean; limit: SubscriptionUsageLimit | null }> {
  try {
    const snap = await admin
      .firestore()
      .collection('teams')
      .doc(teamId)
      .collection('subscription_types')
      .doc(subscriptionTypeId)
      .get()
    if (!snap.exists) return { unmetered: true, limit: null } // unknown type — pre-credits behavior
    const data = snap.data()!
    const limit = resolveUsageLimit({ limits: data.limits as SubscriptionUsageLimit[] | undefined })
    const prices = ((data.prices as SubscriptionPrice[] | undefined) ?? []).filter(
      (p) => p.active !== false
    )
    if (prices.length === 0 || prices.every((p) => !p.credits)) return { unmetered: true, limit }
    const heldPriceId =
      contact.subscription_type_id === subscriptionTypeId
        ? (contact.subscription_price_id as string | undefined)
        : undefined
    if (heldPriceId) {
      const heldPrice = prices.find((p) => p.id === heldPriceId)
      if (heldPrice) return { unmetered: !heldPrice.credits, limit }
    }
    // Held price unknown: lenient unless the type is credits-only.
    return { unmetered: prices.some((p) => !p.credits), limit }
  } catch {
    return { unmetered: true, limit: null } // fail open — pre-credits/pre-limits behavior
  }
}

async function typeGrantsUnmeteredAccess(
  teamId: string,
  subscriptionTypeId: string,
  contact: FirebaseFirestore.DocumentData
): Promise<boolean> {
  return (await classifyHeldType(teamId, subscriptionTypeId, contact)).unmetered
}

export interface AccessGateResult {
  /** The subscription type whose coverage matched, or null (open/members rule,
   *  or no subscription check was needed). */
  matchedSubscriptionTypeId: string | null
  /** Set when the match came from a lesson-credit pack — the caller must spend
   *  one credit of this type atomically with the booking write. */
  creditSpendTypeId: string | null
  /** Set when the match came from a USAGE-LIMITED subscription — the caller
   *  must increment this window counter atomically with the booking write
   *  (and stamp the booking so cancellation can decrement it). */
  usageSpend: { subscriptionTypeId: string; docId: string; count: number } | null
}

/** Why coverage was denied — null means it wasn't (the caller is covered). */
export type BookingAccessDenialReason =
  | 'guest'
  | 'not_joined'
  | 'no_subscription'
  | 'no_credits'
  | 'limit_reached'

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
    case 'limit_reached':
      return 'You have used all the classes your membership includes for this period.'
    case 'no_subscription':
      return 'This class requires an active membership you do not currently hold.'
  }
}

// The "held" shape both resolveBookingCoverage (classes) and resolveHeldBenefit
// (appointments) start from: live subscriptions + the primary snapshot, and
// non-exhausted, non-expired lesson-credit balances. Pure, no DB call — the DB
// call (typeGrantsUnmeteredAccess, above) happens per-id, because it depends on
// which id is being checked.
function heldAndCreditSets(contact: FirebaseFirestore.DocumentData): {
  held: Set<string>
  creditTypes: Set<string>
} {
  const held = new Set<string>()
  const active =
    (contact.active_subscriptions as Array<{ subscription_type_id?: string }> | undefined) ?? []
  active.forEach((s) => {
    if (s.subscription_type_id) held.add(s.subscription_type_id)
  })
  if (contact.subscription_type_id) held.add(contact.subscription_type_id)

  const nowMs = Date.now()
  const creditTypes = new Set(
    (
      (contact.credit_summary as
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
  return { held, creditTypes }
}

/**
 * Build the pure snapshot `resolvePaymentOptions` (@linyup/shared) consumes —
 * the AUTHORITATIVE server-side one. This is where the impure part of coverage
 * lives: classifying each relevant held type as unmetered vs credit-metered
 * (`typeGrantsUnmeteredAccess`, a per-type Firestore read, deliberately
 * fail-open). Only ids in `relevantTypeIds` are classified — pass the union of
 * every id the resolution can touch (accessRule ids ∪ benefit ids).
 */
export interface LimitedUsageWindow {
  subscriptionTypeId: string
  /** Doc id under contacts/{id}/usage_windows for the CURRENT window. */
  docId: string
  /** The configured allowance (limit.count). */
  count: number
  used: number
}

export interface ContactPaymentContext {
  snapshot: ContactPaymentSnapshot
  /** Per LIMITED unmetered held type: the current window's counter state —
   *  what bookSession must increment transactionally on a covered booking. */
  limitedWindows: Record<string, LimitedUsageWindow>
}

export async function loadContactPaymentContext(params: {
  teamId: string
  contact: (admin.firestore.DocumentData & { id: string }) | null
  relevantTypeIds: string[]
}): Promise<ContactPaymentContext> {
  const { teamId, contact, relevantTypeIds } = params
  if (!contact) return { snapshot: GUEST_SNAPSHOT, limitedWindows: {} }

  const { held, creditTypes } = heldAndCreditSets(contact)
  const nowMs = Date.now()
  const usableRemaining = (id: string): number => {
    const entries =
      (contact.credit_summary as
        | Array<{
            subscription_type_id?: string
            remaining?: number
            next_expires_at?: Timestamp | null
          }>
        | undefined) ?? []
    return entries
      .filter(
        (e) =>
          e.subscription_type_id === id &&
          (e.remaining ?? 0) > 0 &&
          (!e.next_expires_at || e.next_expires_at.toMillis() > nowMs)
      )
      .reduce((sum, e) => sum + (e.remaining ?? 0), 0)
  }

  const heldUnmeteredTypeIds: string[] = []
  const heldCreditTypes: Array<{ subscriptionTypeId: string; remaining: number }> = []
  const limited: Array<{ id: string; limit: SubscriptionUsageLimit }> = []
  for (const id of relevantTypeIds) {
    if (held.has(id)) {
      const { unmetered, limit } = await classifyHeldType(teamId, id, contact)
      if (unmetered) {
        heldUnmeteredTypeIds.push(id)
        if (limit) limited.push({ id, limit })
        continue
      }
      // Mirror-held but credit-metered — attached, possibly with 0 usable left
      // (drives the no_credits denial).
      heldCreditTypes.push({ subscriptionTypeId: id, remaining: usableRemaining(id) })
      continue
    }
    if (creditTypes.has(id)) {
      heldCreditTypes.push({ subscriptionTypeId: id, remaining: usableRemaining(id) })
    }
  }

  // Current-window consumption for the limited types (one small doc each).
  const limitedWindows: Record<string, LimitedUsageWindow> = {}
  const usageRemaining: Record<string, number> = {}
  for (const { id, limit } of limited) {
    const docId = usageWindowDocId(id, limit.per)
    let used = 0
    try {
      const snap = await admin
        .firestore()
        .collection('contacts')
        .doc(contact.id)
        .collection('usage_windows')
        .doc(docId)
        .get()
      used = (snap.data()?.used as number | undefined) ?? 0
    } catch {
      used = 0 // fail open, like the type classification
    }
    limitedWindows[id] = { subscriptionTypeId: id, docId, count: limit.count, used }
    usageRemaining[id] = Math.max(0, limit.count - used)
  }

  return {
    snapshot: {
      authenticated: true,
      joined: contact.acquisition_stage === 'joined',
      heldUnmeteredTypeIds,
      heldCreditTypes,
      trialUsed: !!contact.trial_used_at,
      ...(limited.length > 0 ? { usageRemaining } : {}),
    },
    limitedWindows,
  }
}

export async function loadContactPaymentSnapshot(params: {
  teamId: string
  contact: (admin.firestore.DocumentData & { id: string }) | null
  relevantTypeIds: string[]
}): Promise<ContactPaymentSnapshot> {
  return (await loadContactPaymentContext(params)).snapshot
}

/**
 * Non-throwing core of the paid-access gate: does this (already-resolved)
 * authenticated contact — or null for a guest — satisfy an activity's
 * accessRule? Snapshot → resolvePaymentOptions (@linyup/shared) → mapped back
 * to the legacy result shape, so bookSession/bookAppointment diffs stay nil.
 * CLASS-ONLY — appointments dropped the access gate entirely.
 */
export async function resolveBookingCoverage(params: {
  teamId: string
  accessRule: ActivityAccessRule
  authenticatedContact: (admin.firestore.DocumentData & { id: string }) | null
}): Promise<BookingCoverageResult> {
  const { teamId, accessRule, authenticatedContact } = params
  const { snapshot, limitedWindows } = await loadContactPaymentContext({
    teamId,
    contact: authenticatedContact,
    relevantTypeIds: accessRule.subscriptionTypeIds ?? [],
  })
  const { options, denial } = resolvePaymentOptions(snapshot, {
    kind: 'class_booking',
    accessRule,
  })
  if (denial) {
    // 'sign_in_required'/'trial_used' never come out of the class arm.
    return {
      covered: false,
      matchedSubscriptionTypeId: null,
      creditSpendTypeId: null,
      usageSpend: null,
      denial: denial as BookingAccessDenialReason,
    }
  }
  const option = options[0]
  if (option?.type === 'spend_credits') {
    return {
      covered: true,
      matchedSubscriptionTypeId: option.via.subscriptionTypeId,
      creditSpendTypeId: option.via.subscriptionTypeId,
      usageSpend: null,
      denial: null,
    }
  }
  const matched =
    option?.type === 'covered' && option.via.reason === 'subscription'
      ? option.via.subscriptionTypeId
      : null
  // A limited type's coverage must consume one unit of its current window.
  const window = matched ? limitedWindows[matched] : undefined
  return {
    covered: true,
    matchedSubscriptionTypeId: matched,
    creditSpendTypeId: null,
    usageSpend: window
      ? { subscriptionTypeId: window.subscriptionTypeId, docId: window.docId, count: window.count }
      : null,
    denial: null,
  }
}

export interface HeldBenefitResult {
  /** The subset of the GIVEN `subscriptionTypeIds` the contact currently holds
   *  (unmetered subscription OR a usable credit pack), in the SAME order as
   *  the input — so a caller that picks `heldTypeIds[0]` as "the" match gets
   *  the one earliest in the activity's configured benefit order. */
  heldTypeIds: string[]
  /** Set to the first id (in input order) held ONLY via a credit pack — the
   *  type a booking must spend a credit of, IF that id ends up being the
   *  resolved benefit (`resolveEffectiveAppointmentPrice`'s `viaSubscriptionTypeId`).
   *  Null when no id is credit-only-held. */
  creditSpendTypeId: string | null
}

/**
 * APPOINTMENTS-ONLY held-benefit lookup — money is the only gate for
 * appointments (see `ActivityMemberBenefit`), so this never throws and never
 * refuses a guest; it just reports which of the activity's benefit
 * `subscriptionTypeIds` this (already-resolved) contact currently holds, for
 * `resolveEffectiveAppointmentPrice` to price against. Shares the held/credit
 * core (`heldAndCreditSets`) and the per-id unmetered-access check
 * (`typeGrantsUnmeteredAccess`) with `resolveBookingCoverage` — the class gate
 * keeps its exact behaviour; this is a parallel, non-throwing, multi-match read
 * over the SAME underlying data.
 */
export async function resolveHeldBenefit(params: {
  teamId: string
  contact: (admin.firestore.DocumentData & { id: string }) | null
  subscriptionTypeIds: string[]
}): Promise<HeldBenefitResult> {
  const { teamId, contact, subscriptionTypeIds } = params
  if (!contact || subscriptionTypeIds.length === 0) {
    return { heldTypeIds: [], creditSpendTypeId: null }
  }

  const snapshot = await loadContactPaymentSnapshot({
    teamId,
    contact,
    relevantTypeIds: subscriptionTypeIds,
  })
  const heldTypeIds: string[] = []
  let creditSpendTypeId: string | null = null
  for (const id of subscriptionTypeIds) {
    if (snapshot.heldUnmeteredTypeIds.includes(id)) {
      heldTypeIds.push(id)
      continue
    }
    const credit = snapshot.heldCreditTypes.find(
      (e) => e.subscriptionTypeId === id && e.remaining > 0
    )
    if (credit) {
      heldTypeIds.push(id)
      if (!creditSpendTypeId) creditSpendTypeId = id
    }
  }
  return { heldTypeIds, creditSpendTypeId }
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
  return {
    matchedSubscriptionTypeId: coverage.matchedSubscriptionTypeId,
    creditSpendTypeId: coverage.creditSpendTypeId,
    usageSpend: coverage.usageSpend,
  }
}
