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

import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { computePlatformFee, takeRatePercent } from '@linyup/shared'
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
