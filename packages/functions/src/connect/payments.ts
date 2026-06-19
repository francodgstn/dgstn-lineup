/* eslint-disable no-console */
// Stripe Connect — payment callables (one-off + recurring), member → studio.
//
// Both create a Checkout Session ON THE CONNECTED ACCOUNT (direct charge): money
// settles on the studio's balance and Linyup takes an application fee. The fee is
// always computed centrally (computePlatformFee / takeRatePercent) from the
// studio's plan tier — never hardcoded. Amounts are integer Rappen.
//
// The returned Checkout URL is shared with the member to pay. The resulting
// member_payments / member_subscriptions records are written by the webhook
// (Phase E) from Stripe events — never from client-reported success.

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  computePlatformFee,
  takeRatePercent,
  recurrenceToStripeInterval,
  isRecurringRecurrence,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type SubscriptionType,
} from '@linyup/shared'
import { getHostingUrl } from '../utils/env'
import {
  createOneOffCheckoutSession,
  createSubscriptionCheckoutSession,
} from '../utils/connect/client'
import { assertManager, loadEnabledTeam, requireChargeableAccount } from './access'

// Stripe's minimum charge for CHF is ~0.50 CHF.
const MIN_AMOUNT_RAPPEN = 50
const SUB_INTERVALS = ['month', 'year'] as const
type SubInterval = (typeof SUB_INTERVALS)[number]

function resultUrls(
  locale: string,
  successUrl?: string,
  cancelUrl?: string
): { successUrl: string; cancelUrl: string } {
  const base = `${getHostingUrl()}/${locale}/pay/result`
  return {
    successUrl: successUrl ?? `${base}?status=success`,
    cancelUrl: cancelUrl ?? `${base}?status=cancelled`,
  }
}

function validateAmount(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new HttpsError('invalid-argument', 'amount must be an integer in Rappen')
  }
  if (amount < MIN_AMOUNT_RAPPEN) {
    throw new HttpsError('invalid-argument', `amount must be at least ${MIN_AMOUNT_RAPPEN} Rappen`)
  }
  return amount
}

// ─────────────────────────────────────────────────────────────────────────────
// createMemberPayment — one-off direct charge (drop-in, belt test, shop item).
// ─────────────────────────────────────────────────────────────────────────────
export const createMemberPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as {
    teamId?: string
    amount?: number
    purpose?: string
    productName?: string
    contactId?: string
    customerEmail?: string
    successUrl?: string
    cancelUrl?: string
    locale?: string
    idempotencyKey?: string
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const teamId = data.teamId
  const amount = validateAmount(data.amount)
  const purpose = (data.purpose ?? 'payment').slice(0, 64)
  const locale = data.locale ?? 'en'

  await assertManager(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)
  const { accountId, model } = requireChargeableAccount(team)

  const applicationFeeAmount = computePlatformFee({ tier: team.plan, amount, model })
  const { successUrl, cancelUrl } = resultUrls(locale, data.successUrl, data.cancelUrl)

  const metadata: Record<string, string> = { teamId, purpose, kind: 'one_off' }
  if (data.contactId) metadata.contactId = data.contactId

  const idempotencyKey =
    data.idempotencyKey ??
    `member-pay:${teamId}:${request.auth.uid}:${amount}:${purpose}:${Math.floor(Date.now() / 60000)}`

  try {
    const session = await createOneOffCheckoutSession({
      accountId,
      amount,
      applicationFeeAmount,
      productName: data.productName ?? purpose,
      successUrl,
      cancelUrl,
      customerEmail: data.customerEmail,
      metadata,
      idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, applicationFeeAmount }
  } catch (err) {
    console.error('[connect] createMemberPayment failed:', err)
    throw new HttpsError('internal', 'Failed to create the payment')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// createMemberSubscription — recurring membership (card + TWINT). Fee is taken
// per invoice via application_fee_percent.
//
// TWINT recurring constraint to validate in test mode: only ONE active TWINT
// mandate per studio↔member pair (see the Connect README / brief §6).
// ─────────────────────────────────────────────────────────────────────────────
export const createMemberSubscription = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as {
    teamId?: string
    amount?: number
    interval?: string
    productName?: string
    contactId?: string
    customerEmail?: string
    successUrl?: string
    cancelUrl?: string
    locale?: string
    idempotencyKey?: string
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const teamId = data.teamId
  const amount = validateAmount(data.amount)
  const interval = (data.interval ?? 'month') as SubInterval
  if (!SUB_INTERVALS.includes(interval)) {
    throw new HttpsError('invalid-argument', `interval must be one of: ${SUB_INTERVALS.join(', ')}`)
  }
  const locale = data.locale ?? 'en'

  await assertManager(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)
  const { accountId } = requireChargeableAccount(team)

  const applicationFeePercent = takeRatePercent(team.plan)
  const { successUrl, cancelUrl } = resultUrls(locale, data.successUrl, data.cancelUrl)

  const metadata: Record<string, string> = { teamId, kind: 'subscription' }
  if (data.contactId) metadata.contactId = data.contactId

  const idempotencyKey =
    data.idempotencyKey ??
    `member-sub:${teamId}:${request.auth.uid}:${amount}:${interval}:${Math.floor(Date.now() / 60000)}`

  try {
    const session = await createSubscriptionCheckoutSession({
      accountId,
      amount,
      interval,
      applicationFeePercent,
      productName: data.productName ?? 'Membership',
      successUrl,
      cancelUrl,
      customerEmail: data.customerEmail,
      metadata,
      idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, applicationFeePercent }
  } catch (err) {
    console.error('[connect] createMemberSubscription failed:', err)
    throw new HttpsError('internal', 'Failed to create the subscription')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// createMembershipPayment — sell one of the team's subscription types to a member.
// Resolves the chosen price, routes recurring→subscription / one-off→single charge,
// and embeds metadata so the webhook updates the member's contact membership.
// ─────────────────────────────────────────────────────────────────────────────
export const createMembershipPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as {
    teamId?: string
    subscriptionTypeId?: string
    priceId?: string
    contactId?: string
    customerEmail?: string
    successUrl?: string
    cancelUrl?: string
    locale?: string
    idempotencyKey?: string
  }
  if (!data?.teamId || !data?.subscriptionTypeId || !data?.priceId) {
    throw new HttpsError('invalid-argument', 'teamId, subscriptionTypeId and priceId are required')
  }
  const { teamId, subscriptionTypeId, priceId } = data
  const locale = data.locale ?? 'en'

  await assertManager(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)
  const { accountId, model } = requireChargeableAccount(team)

  // Resolve the subscription type + the chosen price.
  const typeSnap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(SUBSCRIPTION_TYPES_SUBCOLLECTION)
    .doc(subscriptionTypeId)
    .get()
  if (!typeSnap.exists) throw new HttpsError('not-found', 'Subscription type not found')
  const subType = typeSnap.data() as SubscriptionType
  const price = (subType.prices ?? []).find((p) => p.id === priceId)
  if (!price) throw new HttpsError('not-found', 'Price not found on this subscription type')

  // Amount: subscription prices are stored in MAJOR units (e.g. 49.9) → Rappen.
  const amount = Math.round(price.amount * 100)
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_RAPPEN) {
    throw new HttpsError('invalid-argument', `Price must be at least ${MIN_AMOUNT_RAPPEN} Rappen`)
  }

  const { successUrl, cancelUrl } = resultUrls(locale, data.successUrl, data.cancelUrl)
  const productName = price.label ? `${subType.name} — ${price.label}` : subType.name

  // Metadata the webhook reads to update the member's contact membership.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'membership',
    subscriptionTypeId,
    subscriptionTypeName: subType.name,
    priceId,
    recurrence: price.recurrence,
  }
  if (data.contactId) metadata.contactId = data.contactId
  if (price.included_months) metadata.includedMonths = String(price.included_months)

  const interval = recurrenceToStripeInterval(price.recurrence)
  const idempotencyKey =
    data.idempotencyKey ??
    `membership:${teamId}:${request.auth.uid}:${priceId}:${Math.floor(Date.now() / 60000)}`

  try {
    if (isRecurringRecurrence(price.recurrence) && interval) {
      const session = await createSubscriptionCheckoutSession({
        accountId,
        amount,
        interval: interval.interval,
        intervalCount: interval.interval_count,
        applicationFeePercent: takeRatePercent(team.plan),
        productName,
        successUrl,
        cancelUrl,
        customerEmail: data.customerEmail,
        metadata,
        idempotencyKey,
      })
      return { url: session.url, sessionId: session.sessionId, recurring: true }
    }

    // per_class / one_time → single charge.
    const session = await createOneOffCheckoutSession({
      accountId,
      amount,
      applicationFeeAmount: computePlatformFee({ tier: team.plan, amount, model }),
      productName,
      successUrl,
      cancelUrl,
      customerEmail: data.customerEmail,
      metadata,
      idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, recurring: false }
  } catch (err) {
    console.error('[connect] createMembershipPayment failed:', err)
    throw new HttpsError('internal', 'Failed to create the membership payment')
  }
})
