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
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  computePlatformFee,
  takeRatePercent,
  recurrenceToStripeInterval,
  isRecurringRecurrence,
  resolveProductPrice,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  PRODUCTS_SUBCOLLECTION,
  COURSES_COLLECTION,
  TEAMS_COLLECTION,
  type SubscriptionType,
  type Product,
  type Course,
} from '@linyup/shared'
import { resolveBaseUrl } from '../utils/env'
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
  cancelUrl?: string,
  // Appended to the default result URLs so the page can link back (e.g. &slug=…&seg=shop).
  extraQuery?: string,
  // Caller's origin — prefers localhost in dev, falls back to the hosting URL.
  origin?: string
): { successUrl: string; cancelUrl: string } {
  const base = `${resolveBaseUrl(origin)}/${locale}/pay/result`
  const extra = extraQuery ?? ''
  return {
    successUrl: successUrl ?? `${base}?status=success${extra}`,
    cancelUrl: cancelUrl ?? `${base}?status=cancelled${extra}`,
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
    origin?: string
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
  const { successUrl, cancelUrl } = resultUrls(
    locale,
    data.successUrl,
    data.cancelUrl,
    undefined,
    data.origin
  )

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
    origin?: string
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
  const { successUrl, cancelUrl } = resultUrls(
    locale,
    data.successUrl,
    data.cancelUrl,
    undefined,
    data.origin
  )

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
    origin?: string
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

  const { successUrl, cancelUrl } = resultUrls(
    locale,
    data.successUrl,
    data.cancelUrl,
    undefined,
    data.origin
  )
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHECKOUT_RATE_LIMIT_PER_HOUR = 30

/**
 * Index-free hourly rate limit for the public checkout: an `{ip}:{hourBucket}`
 * counter doc, incremented in a transaction. Avoids composite indexes (and the
 * emulator-hides-missing-index trap). 'unknown' IPs share one bucket.
 */
async function checkoutRateLimit(ipRaw: string | undefined): Promise<void> {
  const ip = (ipRaw ?? 'unknown').replace(/[^\w.:-]/g, '_').slice(0, 60)
  const bucket = Math.floor(Date.now() / 3_600_000)
  const ref = admin.firestore().collection('connect_checkout_attempts').doc(`${ip}:${bucket}`)
  const count = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const next = ((snap.data()?.count as number | undefined) ?? 0) + 1
    tx.set(ref, { ip, bucket, count: next, updated_at: FieldValue.serverTimestamp() }, { merge: true })
    return next
  })
  if (count > CHECKOUT_RATE_LIMIT_PER_HOUR) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Please try again later.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createMembershipCheckout — PUBLIC (unauthenticated) sibling of
// createMembershipPayment for the member-facing shop page. A member picks a
// subscription type + price and their email; we charge on the studio's connected
// account. No contactId is carried — the webhook links/creates the contact by
// email. Guarded by the Connect kill-switch + a chargeable account + rate limit.
// ─────────────────────────────────────────────────────────────────────────────
export const createMembershipCheckout = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    subscriptionTypeId?: string
    priceId?: string
    memberEmail?: string
    slug?: string
    locale?: string
    idempotencyKey?: string
    origin?: string
  }
  if (!data?.teamId || !data?.subscriptionTypeId || !data?.priceId) {
    throw new HttpsError('invalid-argument', 'teamId, subscriptionTypeId and priceId are required')
  }
  const email = (data.memberEmail ?? '').toLowerCase().trim()
  if (!EMAIL_RE.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email is required')
  }
  const { teamId, subscriptionTypeId, priceId } = data
  const locale = data.locale ?? 'en'

  await checkoutRateLimit(request.rawRequest?.ip)

  // No auth: the only gates are the team's Connect kill-switch + chargeable account.
  const team = await loadEnabledTeam(teamId)
  const { accountId, model } = requireChargeableAccount(team)

  const typeSnap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(SUBSCRIPTION_TYPES_SUBCOLLECTION)
    .doc(subscriptionTypeId)
    .get()
  if (!typeSnap.exists) throw new HttpsError('not-found', 'Subscription type not found')
  const subType = typeSnap.data() as SubscriptionType
  // Only public + active types are sellable from the public shop.
  if (subType.public !== true || subType.active === false) {
    throw new HttpsError('failed-precondition', 'This item is not available')
  }
  const price = (subType.prices ?? []).find((p) => p.id === priceId && p.active !== false)
  if (!price) throw new HttpsError('not-found', 'Price not found on this subscription type')

  const amount = Math.round(price.amount * 100)
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_RAPPEN) {
    throw new HttpsError('invalid-argument', `Price must be at least ${MIN_AMOUNT_RAPPEN} Rappen`)
  }

  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=shop` : ''
  const { successUrl, cancelUrl } = resultUrls(locale, undefined, undefined, slugQuery, data.origin)
  const productName = price.label ? `${subType.name} — ${price.label}` : subType.name

  // Webhook reads this to create/link the buyer's contact. No contactId here.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'membership',
    subscriptionTypeId,
    subscriptionTypeName: subType.name,
    priceId,
    recurrence: price.recurrence,
  }
  if (price.included_months) metadata.includedMonths = String(price.included_months)

  const interval = recurrenceToStripeInterval(price.recurrence)
  const idempotencyKey =
    data.idempotencyKey ??
    `membership-pub:${teamId}:${priceId}:${email}:${Math.floor(Date.now() / 60000)}`

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
        customerEmail: email,
        metadata,
        idempotencyKey,
      })
      return { url: session.url, sessionId: session.sessionId, recurring: true }
    }

    const session = await createOneOffCheckoutSession({
      accountId,
      amount,
      applicationFeeAmount: computePlatformFee({ tier: team.plan, amount, model }),
      productName,
      successUrl,
      cancelUrl,
      customerEmail: email,
      metadata,
      idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, recurring: false }
  } catch (err) {
    console.error('[connect] createMembershipCheckout failed:', err)
    throw new HttpsError('internal', 'Failed to start checkout')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// createProductCheckout — PUBLIC (unauthenticated) one-off checkout for the
// member-facing shop's PRODUCTS section. Mirrors createMembershipCheckout but for
// physical products: always a single charge (never recurring) on the studio's
// connected account. The optional variantId selects a size/colour; the price is
// the variant override or the product's base price. The webhook links/creates the
// buyer's contact by email and records the sale (kind === 'product').
// ─────────────────────────────────────────────────────────────────────────────
export const createProductCheckout = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    productId?: string
    variantId?: string
    memberEmail?: string
    slug?: string
    locale?: string
    idempotencyKey?: string
    origin?: string
  }
  if (!data?.teamId || !data?.productId) {
    throw new HttpsError('invalid-argument', 'teamId and productId are required')
  }
  const email = (data.memberEmail ?? '').toLowerCase().trim()
  if (!EMAIL_RE.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email is required')
  }
  const { teamId, productId } = data
  const variantId = data.variantId
  const locale = data.locale ?? 'en'

  await checkoutRateLimit(request.rawRequest?.ip)

  // No auth: the only gates are the team's Connect kill-switch + chargeable account.
  const team = await loadEnabledTeam(teamId)
  const { accountId, model } = requireChargeableAccount(team)

  const productSnap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(PRODUCTS_SUBCOLLECTION)
    .doc(productId)
    .get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found')
  const product = productSnap.data() as Product
  // Only active products are sellable from the public shop.
  if (product.active === false) {
    throw new HttpsError('failed-precondition', 'This item is not available')
  }

  // Resolve the chosen variant (if any) and validate it is active.
  let variantLabel: string | undefined
  if (variantId) {
    const variant = (product.variants ?? []).find((v) => v.id === variantId)
    if (!variant || variant.active === false) {
      throw new HttpsError('not-found', 'Variant not available')
    }
    variantLabel = variant.label
  }

  const amount = Math.round(resolveProductPrice(product, variantId) * 100)
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_RAPPEN) {
    throw new HttpsError('invalid-argument', `Price must be at least ${MIN_AMOUNT_RAPPEN} Rappen`)
  }

  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=shop` : ''
  const { successUrl, cancelUrl } = resultUrls(locale, undefined, undefined, slugQuery, data.origin)
  const productName = variantLabel ? `${product.name} — ${variantLabel}` : product.name

  // Webhook reads this to record the sale + link/create the buyer's contact.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'product',
    purpose: 'product',
    productId,
    productName: product.name,
  }
  if (variantId) metadata.variantId = variantId
  if (variantLabel) metadata.variantLabel = variantLabel

  const idempotencyKey =
    data.idempotencyKey ??
    `product-pub:${teamId}:${productId}:${variantId ?? '_'}:${email}:${Math.floor(Date.now() / 60000)}`

  try {
    const session = await createOneOffCheckoutSession({
      accountId,
      amount,
      applicationFeeAmount: computePlatformFee({ tier: team.plan, amount, model }),
      productName,
      successUrl,
      cancelUrl,
      customerEmail: email,
      metadata,
      idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, recurring: false }
  } catch (err) {
    console.error('[connect] createProductCheckout failed:', err)
    throw new HttpsError('internal', 'Failed to start checkout')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// createCourseCheckout — public, one-off purchase of a 'purchase'-tier online course
// (LMS). No auth: the buyer pays from the shop, then logs into the team's Space with
// the same email to watch. The webhook grants a lifetime entitlement
// (courses/{id}/purchases/{contactId}) + links/creates the buyer's contact by email.
// Mirrors createProductCheckout; the success page lands in the Space (seg=space).
// ─────────────────────────────────────────────────────────────────────────────
export const createCourseCheckout = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    courseId?: string
    memberEmail?: string
    slug?: string
    locale?: string
    idempotencyKey?: string
    origin?: string
  }
  if (!data?.teamId || !data?.courseId) {
    throw new HttpsError('invalid-argument', 'teamId and courseId are required')
  }
  const email = (data.memberEmail ?? '').toLowerCase().trim()
  if (!EMAIL_RE.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email is required')
  }
  const { teamId, courseId } = data
  const locale = data.locale ?? 'en'

  await checkoutRateLimit(request.rawRequest?.ip)

  // No auth: the only gates are the team's Connect kill-switch + chargeable account.
  const team = await loadEnabledTeam(teamId)
  const { accountId, model } = requireChargeableAccount(team)

  const courseSnap = await admin.firestore().collection(COURSES_COLLECTION).doc(courseId).get()
  if (!courseSnap.exists) throw new HttpsError('not-found', 'Course not found')
  const course = courseSnap.data() as Course
  // Only a published, purchase-tier course that belongs to this team is sellable.
  if (course.teamId !== teamId) throw new HttpsError('not-found', 'Course not found')
  if (course.status !== 'published') {
    throw new HttpsError('failed-precondition', 'This course is not available')
  }
  if (course.accessRule?.type !== 'purchase' || typeof course.accessRule.priceAmount !== 'number') {
    throw new HttpsError('failed-precondition', 'This course is not for sale')
  }

  const amount = Math.round(course.accessRule.priceAmount * 100)
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_RAPPEN) {
    throw new HttpsError('invalid-argument', `Price must be at least ${MIN_AMOUNT_RAPPEN} Rappen`)
  }

  // Land the buyer back in the Space (where they watch), not the shop.
  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=space` : ''
  const { successUrl, cancelUrl } = resultUrls(locale, undefined, undefined, slugQuery, data.origin)

  // Webhook reads this to grant the entitlement + link/create the buyer's contact.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'course',
    purpose: 'course',
    courseId,
    courseTitle: course.title,
  }

  const idempotencyKey =
    data.idempotencyKey ??
    `course-pub:${teamId}:${courseId}:${email}:${Math.floor(Date.now() / 60000)}`

  try {
    const session = await createOneOffCheckoutSession({
      accountId,
      amount,
      applicationFeeAmount: computePlatformFee({ tier: team.plan, amount, model }),
      productName: course.title,
      successUrl,
      cancelUrl,
      customerEmail: email,
      metadata,
      idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, recurring: false }
  } catch (err) {
    console.error('[connect] createCourseCheckout failed:', err)
    throw new HttpsError('internal', 'Failed to start checkout')
  }
})
