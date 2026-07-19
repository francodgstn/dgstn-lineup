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
  recurrenceToStripeInterval,
  isRecurringRecurrence,
  normalizeBenefit,
  resolveProductPrice,
  resolvePaymentOptions,
  toMinorUnits,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  PRODUCTS_SUBCOLLECTION,
  COURSES_COLLECTION,
  COURSE_PURCHASES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  CONTACTS_COLLECTION,
  type SubscriptionType,
  type Product,
  type Course,
} from '@linyup/shared'
import { loadContactPaymentSnapshot } from '../booking/access'
import { getConnectStripe } from '../utils/connect/client'
import { generateSecureToken } from '../utils/crypto'
import { applyPaymentEffects } from '../payments/effects'
import { assertManager, loadEnabledTeam, requireChargeableAccount } from './access'
import {
  buildResultUrls,
  checkoutRateLimit,
  defaultIdempotencyKey,
  requireChargeableAmountFromMajor,
  requireChargeableMinorAmount,
  SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES,
  startOneOffCheckout,
  startSubscriptionCheckout,
} from './checkout'
import { reserveGiftCardDrawdown, commitGiftCardHold, releaseGiftCardHold } from './giftCards'
import { requireContactSessionForTeam } from '../utils/contactSession'
import { APP_CHECK_ENFORCE, monitorAppCheck } from '../utils/appCheck'

// Amount guards, result URLs, idempotency defaults, fee computation and Stripe
// error mapping all live in ./checkout — the one money core. Kept here: business
// validation + the metadata each webhook kind reads.

const SUB_INTERVALS = ['month', 'year'] as const
type SubInterval = (typeof SUB_INTERVALS)[number]

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
  const amount = requireChargeableMinorAmount(data.amount)
  const purpose = (data.purpose ?? 'payment').slice(0, 64)
  const locale = data.locale ?? 'en'

  await assertManager(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)

  const { successUrl, cancelUrl } = buildResultUrls(locale, {
    successUrl: data.successUrl,
    cancelUrl: data.cancelUrl,
    origin: data.origin,
  })

  const metadata: Record<string, string> = { teamId, purpose, kind: 'one_off' }
  if (data.contactId) metadata.contactId = data.contactId

  return startOneOffCheckout({
    team,
    amountMinor: amount,
    productName: data.productName ?? purpose,
    successUrl,
    cancelUrl,
    customerEmail: data.customerEmail,
    metadata,
    idempotencyKey:
      data.idempotencyKey ??
      defaultIdempotencyKey('member-pay', teamId, request.auth.uid, String(amount), purpose),
    label: 'createMemberPayment',
  })
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
  const amount = requireChargeableMinorAmount(data.amount)
  const interval = (data.interval ?? 'month') as SubInterval
  if (!SUB_INTERVALS.includes(interval)) {
    throw new HttpsError('invalid-argument', `interval must be one of: ${SUB_INTERVALS.join(', ')}`)
  }
  const locale = data.locale ?? 'en'

  await assertManager(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)

  const { successUrl, cancelUrl } = buildResultUrls(locale, {
    successUrl: data.successUrl,
    cancelUrl: data.cancelUrl,
    origin: data.origin,
  })

  const metadata: Record<string, string> = { teamId, kind: 'subscription' }
  if (data.contactId) metadata.contactId = data.contactId

  return startSubscriptionCheckout({
    team,
    amountMinor: amount,
    interval,
    productName: data.productName ?? 'Membership',
    successUrl,
    cancelUrl,
    customerEmail: data.customerEmail,
    metadata,
    idempotencyKey:
      data.idempotencyKey ??
      defaultIdempotencyKey('member-sub', teamId, request.auth.uid, String(amount), interval),
    label: 'createMemberSubscription',
  })
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
  requireChargeableAccount(team) // fail before the reads; the orchestrator re-checks

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
  const amount = requireChargeableAmountFromMajor(price.amount)

  const { successUrl, cancelUrl } = buildResultUrls(locale, {
    successUrl: data.successUrl,
    cancelUrl: data.cancelUrl,
    origin: data.origin,
  })
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
  // Credit pack: the webhook materialises a CreditGrant alongside the membership.
  if (price.credits) metadata.credits = String(price.credits)

  const interval = recurrenceToStripeInterval(price.recurrence)
  const idempotencyKey =
    data.idempotencyKey ??
    defaultIdempotencyKey('membership', teamId, request.auth.uid, priceId)

  if (isRecurringRecurrence(price.recurrence) && interval) {
    const session = await startSubscriptionCheckout({
      team,
      amountMinor: amount,
      interval: interval.interval,
      intervalCount: interval.interval_count,
      productName,
      successUrl,
      cancelUrl,
      customerEmail: data.customerEmail,
      metadata,
      idempotencyKey,
      label: 'createMembershipPayment',
    })
    return { url: session.url, sessionId: session.sessionId, recurring: true }
  }

  // per_class / one_time → single charge.
  const session = await startOneOffCheckout({
    team,
    amountMinor: amount,
    productName,
    successUrl,
    cancelUrl,
    customerEmail: data.customerEmail,
    metadata,
    idempotencyKey,
    label: 'createMembershipPayment',
  })
  return { url: session.url, sessionId: session.sessionId, recurring: false }
})

// ─────────────────────────────────────────────────────────────────────────────
// createMembershipCheckout — the member-facing shop's subscription checkout.
// LOGIN-FIRST: requires a contact session for the team (the buyer signed in or
// registered via the OTP flow before paying); metadata.contactId always links the
// sale to that exact contact. Guarded by the Connect kill-switch + a chargeable
// account + rate limit. Sibling of the manager-side createMembershipPayment.
// ─────────────────────────────────────────────────────────────────────────────
export const createMembershipCheckout = onCall({ enforceAppCheck: APP_CHECK_ENFORCE }, async (request) => {
  monitorAppCheck(request, 'createMembershipCheckout')
  const data = request.data as {
    teamId?: string
    subscriptionTypeId?: string
    priceId?: string
    slug?: string
    locale?: string
    idempotencyKey?: string
    origin?: string
  }
  if (!data?.teamId || !data?.subscriptionTypeId || !data?.priceId) {
    throw new HttpsError('invalid-argument', 'teamId, subscriptionTypeId and priceId are required')
  }
  const { teamId, subscriptionTypeId, priceId } = data
  const locale = data.locale ?? 'en'

  await checkoutRateLimit(request.rawRequest?.ip)

  // Login-first: every shop purchase runs as a verified contact of this team (the
  // sign-in/register flow precedes checkout). The session is the ONLY trusted
  // identity source; its email claim doubles as the Stripe receipt address.
  const session = await requireContactSessionForTeam(request, teamId)
  const email = session.email ?? undefined

  // Remaining gates: the team's Connect kill-switch + chargeable account.
  const team = await loadEnabledTeam(teamId)
  requireChargeableAccount(team) // fail before the reads; the orchestrator re-checks

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
  // Contact-capture mode is read server-side (never trust the client). Under
  // login-first the buyer IS a contact already, so 'off'/'minimal' are moot; only
  // 'full' still matters — it routes the success page to the finish-signup nudge.
  const contactMode = subType.checkout_contact_mode ?? 'minimal'
  const price = (subType.prices ?? []).find((p) => p.id === priceId && p.active !== false)
  if (!price) throw new HttpsError('not-found', 'Price not found on this subscription type')

  const amount = requireChargeableAmountFromMajor(price.amount)

  // Block buying a subscription type the buyer ALREADY actively holds (recurring only —
  // one-off drop-ins may legitimately stack). A contact may hold several *different*
  // types at once, but never two of the same. Login-first gives us the exact contact;
  // races (two tabs) still fall through to the webhook safety net (cancel + refund).
  // Query by contactId only (single-field index, like onMemberSubscriptionWrite) and
  // filter type/status in memory — a contact has few subscriptions.
  if (isRecurringRecurrence(price.recurrence)) {
    const subsSnap = await admin
      .firestore()
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION)
      .where('contactId', '==', session.contactId)
      .get()
    const LIVE = new Set(['active', 'trialing', 'past_due'])
    const holdsSameType = subsSnap.docs.some((d) => {
      const s = d.data()
      return (
        s.subscriptionTypeId === subscriptionTypeId && LIVE.has(s.status as string) && !s.duplicate
      )
    })
    if (holdsSameType) {
      throw new HttpsError('already-exists', 'You already have this subscription.')
    }
  }

  // A 'full' purchase lands the buyer on the signup-finalize page (email prefilled)
  // — the finish-your-profile nudge — but ONLY if this contact hasn't completed
  // registration yet (signup_completed_at unset): a returning buyer shouldn't be
  // asked to register again after every purchase. Everyone else returns to the
  // shop. The result page only honours seg=signup on success.
  let seg = 'shop'
  if (contactMode === 'full') {
    const contactSnap = await admin
      .firestore()
      .collection(CONTACTS_COLLECTION)
      .doc(session.contactId)
      .get()
    if (!contactSnap.data()?.signup_completed_at) seg = 'signup'
  }
  const emailQuery = seg === 'signup' && email ? `&email=${encodeURIComponent(email)}` : ''
  const slugQuery = data.slug
    ? `&slug=${encodeURIComponent(data.slug)}&seg=${seg}${emailQuery}`
    : ''
  const { successUrl, cancelUrl } = buildResultUrls(locale, {
    extraQuery: slugQuery,
    origin: data.origin,
  })
  const productName = price.label ? `${subType.name} — ${price.label}` : subType.name

  // Webhook reads this to link the sale to the buyer's exact contact.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'membership',
    subscriptionTypeId,
    subscriptionTypeName: subType.name,
    priceId,
    recurrence: price.recurrence,
    contactId: session.contactId,
    contactMode,
  }
  if (price.included_months) metadata.includedMonths = String(price.included_months)
  // Credit pack: the webhook materialises a CreditGrant alongside the membership.
  if (price.credits) metadata.credits = String(price.credits)

  const interval = recurrenceToStripeInterval(price.recurrence)
  const idempotencyKey =
    data.idempotencyKey ??
    defaultIdempotencyKey('membership-pub', teamId, priceId, session.contactId)

  if (isRecurringRecurrence(price.recurrence) && interval) {
    const checkout = await startSubscriptionCheckout({
      team,
      amountMinor: amount,
      interval: interval.interval,
      intervalCount: interval.interval_count,
      productName,
      successUrl,
      cancelUrl,
      customerEmail: email,
      metadata,
      idempotencyKey,
      label: 'createMembershipCheckout',
    })
    return { url: checkout.url, sessionId: checkout.sessionId, recurring: true }
  }

  const checkout = await startOneOffCheckout({
    team,
    amountMinor: amount,
    productName,
    successUrl,
    cancelUrl,
    customerEmail: email,
    metadata,
    idempotencyKey,
    label: 'createMembershipCheckout',
  })
  return { url: checkout.url, sessionId: checkout.sessionId, recurring: false }
})

// ─────────────────────────────────────────────────────────────────────────────
// createProductCheckout — one-off checkout for the member-facing shop's PRODUCTS
// section. LOGIN-FIRST (see createMembershipCheckout): the buyer holds a contact
// session; metadata.contactId links the sale. Always a single charge (never
// recurring) on the studio's connected account. The optional variantId selects a
// size/colour; the price is the variant override or the product's base price.
// ─────────────────────────────────────────────────────────────────────────────
export const createProductCheckout = onCall({ enforceAppCheck: APP_CHECK_ENFORCE }, async (request) => {
  monitorAppCheck(request, 'createProductCheckout')
  const data = request.data as {
    teamId?: string
    productId?: string
    variantId?: string
    slug?: string
    locale?: string
    idempotencyKey?: string
    origin?: string
    /** Optional gift-card code to draw down against this purchase. */
    giftCardCode?: string
  }
  if (!data?.teamId || !data?.productId) {
    throw new HttpsError('invalid-argument', 'teamId and productId are required')
  }
  const { teamId, productId } = data
  const variantId = data.variantId
  const locale = data.locale ?? 'en'

  await checkoutRateLimit(request.rawRequest?.ip)

  // Login-first: the buyer is a verified contact of this team (see membership above).
  const session = await requireContactSessionForTeam(request, teamId)
  const email = session.email ?? undefined

  // Remaining gates: the team's Connect kill-switch + chargeable account.
  const team = await loadEnabledTeam(teamId)
  // Chargeable-account gate: a FULL-COVER gift-card redemption moves no money
  // and must work without Stripe onboarding — when a code is supplied, the
  // check is deferred to the orchestrator (which re-checks before any charge;
  // the reserved hold is released if that late check throws).
  if (!data.giftCardCode) requireChargeableAccount(team)

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

  const priceMajor = resolveProductPrice(product, variantId)
  const amount = requireChargeableAmountFromMajor(priceMajor)

  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=shop` : ''
  const { successUrl, cancelUrl } = buildResultUrls(locale, {
    extraQuery: slugQuery,
    origin: data.origin,
  })
  const productName = variantLabel ? `${product.name} — ${variantLabel}` : product.name

  // Webhook reads this to record the sale + link it to the buyer's exact contact.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'product',
    purpose: 'product',
    productId,
    productName: product.name,
    contactId: session.contactId,
  }
  if (variantId) metadata.variantId = variantId
  if (variantLabel) metadata.variantLabel = variantLabel

  const idempotencyKey =
    data.idempotencyKey ??
    defaultIdempotencyKey('product-pub', teamId, productId, variantId ?? '_', session.contactId)

  // Optional gift-card redemption: reserve a drawdown against the total, then
  // either FULL COVER (apply effects directly, no Stripe) or reduce the Stripe
  // charge to the residual and carry the hold through checkout metadata.
  if (data.giftCardCode) {
    const holdKey = generateSecureToken(16)
    const plan = await reserveGiftCardDrawdown({
      teamId,
      code: data.giftCardCode,
      totalMajor: priceMajor,
      holdKey,
    })
    const paymentRef = `gift:${data.giftCardCode.trim().toUpperCase()}:${holdKey}`

    if (plan.residual === 0) {
      await applyPaymentEffects(admin.firestore(), {
        teamId,
        contactId: session.contactId,
        lineItem: { kind: 'product', productId, variantId, label: productName },
        amountRappen: toMinorUnits(plan.drawdown),
        currency: 'CHF',
        source: 'gift_card',
        paymentRef,
      })
      await commitGiftCardHold({ teamId, code: data.giftCardCode, holdKey })
      return { url: null, sessionId: null, recurring: false, paidWithGiftCard: true, amount: 0, drawdown: plan.drawdown }
    }

    metadata.giftCardCode = data.giftCardCode.trim().toUpperCase()
    metadata.giftCardHold = holdKey
    metadata.giftCardDrawdown = String(plan.drawdown)
    const residualAmount = requireChargeableAmountFromMajor(plan.residual)
    let checkout
    try {
      checkout = await startOneOffCheckout({
        team,
        amountMinor: residualAmount,
        productName,
        successUrl,
        cancelUrl,
        customerEmail: email,
        metadata,
        idempotencyKey,
        expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES * 60,
        label: 'createProductCheckout',
      })
    } catch (err) {
      // Don't leave the reserved drawdown dangling until its lazy expiry.
      await releaseGiftCardHold({ teamId, code: data.giftCardCode, holdKey }).catch(() => undefined)
      throw err
    }
    return {
      url: checkout.url,
      sessionId: checkout.sessionId,
      recurring: false,
      amount: residualAmount,
      drawdown: plan.drawdown,
      residual: plan.residual,
    }
  }

  const checkout = await startOneOffCheckout({
    team,
    amountMinor: amount,
    productName,
    successUrl,
    cancelUrl,
    customerEmail: email,
    metadata,
    idempotencyKey,
    label: 'createProductCheckout',
  })
  return { url: checkout.url, sessionId: checkout.sessionId, recurring: false }
})

// ─────────────────────────────────────────────────────────────────────────────
// createCourseCheckout — one-off purchase of a 'purchase'-tier online course (LMS).
// LOGIN-FIRST (see createMembershipCheckout): the buyer holds a contact session,
// so the webhook grants the lifetime entitlement (courses/{id}/purchases/{contactId})
// to exactly that contact — already signed in to watch. Mirrors createProductCheckout;
// the success page lands in the Space (seg=space).
// ─────────────────────────────────────────────────────────────────────────────
export const createCourseCheckout = onCall({ enforceAppCheck: APP_CHECK_ENFORCE }, async (request) => {
  monitorAppCheck(request, 'createCourseCheckout')
  const data = request.data as {
    teamId?: string
    courseId?: string
    slug?: string
    locale?: string
    idempotencyKey?: string
    origin?: string
    /** Optional gift-card code to draw down against this purchase. */
    giftCardCode?: string
  }
  if (!data?.teamId || !data?.courseId) {
    throw new HttpsError('invalid-argument', 'teamId and courseId are required')
  }
  const { teamId, courseId } = data
  const locale = data.locale ?? 'en'

  await checkoutRateLimit(request.rawRequest?.ip)

  // Login-first: the buyer is a verified contact of this team — the entitlement is
  // granted to exactly this contact (e.g. the child a parent selected at sign-in).
  const session = await requireContactSessionForTeam(request, teamId)
  const email = session.email ?? undefined

  // Remaining gates: the team's Connect kill-switch + chargeable account.
  const team = await loadEnabledTeam(teamId)
  // Chargeable-account gate: a FULL-COVER gift-card redemption moves no money
  // and must work without Stripe onboarding — when a code is supplied, the
  // check is deferred to the orchestrator (which re-checks before any charge;
  // the reserved hold is released if that late check throws).
  if (!data.giftCardCode) requireChargeableAccount(team)

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

  // Refuse selling to an already-entitled buyer (owner, or included free via a
  // held subscription) — same principle as the drop-in P1 fix: the entitlement
  // write is idempotent, but a second charge would never be refunded.
  const [contactSnap, purchaseSnap] = await Promise.all([
    admin.firestore().collection(CONTACTS_COLLECTION).doc(session.contactId).get(),
    admin
      .firestore()
      .collection(COURSES_COLLECTION)
      .doc(courseId)
      .collection(COURSE_PURCHASES_SUBCOLLECTION)
      .doc(session.contactId)
      .get(),
  ])
  const courseBenefit = normalizeBenefit(course.benefit)
  const baseSnapshot = await loadContactPaymentSnapshot({
    teamId,
    contact:
      contactSnap.exists && contactSnap.data()?.teamId === teamId
        ? { ...contactSnap.data()!, id: contactSnap.id }
        : null,
    relevantTypeIds: [
      ...(course.accessRule.subscriptionTypeIds ?? []),
      ...(courseBenefit?.subscriptionTypeIds ?? []),
    ],
  })
  const priced = resolvePaymentOptions(
    { ...baseSnapshot, ownsCourse: purchaseSnap.exists },
    { kind: 'course', accessRule: course.accessRule, benefit: courseBenefit }
  )
  const payOption = priced.options[0]
  // Refuse selling only when the buyer's access is GRANTABLE BY THE RULES:
  // owning the course, or coverage via their PRIMARY subscription type (the
  // only one canReadPublishedCourse checks). A resolver-covered-but-not-
  // rules-grantable state (e.g. coverage via a secondary held type) must fall
  // through to a normal sale — refusing would deadlock the buyer between a
  // checkout that says "you already have access" and rules that deny the read.
  const primaryTypeId =
    (contactSnap.exists ? (contactSnap.data()?.subscription_type_id as string | undefined) : undefined) ??
    null
  if (payOption?.type !== 'pay') {
    const via = payOption?.type === 'covered' ? payOption.via : null
    const rulesGrantable =
      via !== null &&
      (via.reason === 'owned' ||
        (('subscriptionTypeId' in via ? via.subscriptionTypeId : null) === primaryTypeId &&
          primaryTypeId !== null))
    if (rulesGrantable) {
      throw new HttpsError('failed-precondition', 'You already have access to this course', {
        reason: 'covered',
      })
    }
  }
  // Effective amount: the pay option's (benefit-discounted) price, or the base
  // course price on the fall-through path above.
  const priceMajor =
    payOption?.type === 'pay' ? payOption.amount : (course.accessRule.priceAmount as number)
  const amount = requireChargeableAmountFromMajor(priceMajor)

  // Land the buyer back in the Space (where they watch), not the shop.
  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=space` : ''
  const { successUrl, cancelUrl } = buildResultUrls(locale, {
    extraQuery: slugQuery,
    origin: data.origin,
  })

  // Webhook reads this to grant the entitlement to the buyer's exact contact.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'course',
    purpose: 'course',
    courseId,
    courseTitle: course.title,
    contactId: session.contactId,
  }

  const idempotencyKey =
    data.idempotencyKey ??
    defaultIdempotencyKey('course-pub', teamId, courseId, session.contactId)

  // Optional gift-card redemption — same shape as createProductCheckout above.
  if (data.giftCardCode) {
    const holdKey = generateSecureToken(16)
    const plan = await reserveGiftCardDrawdown({
      teamId,
      code: data.giftCardCode,
      totalMajor: priceMajor,
      holdKey,
    })
    const paymentRef = `gift:${data.giftCardCode.trim().toUpperCase()}:${holdKey}`

    if (plan.residual === 0) {
      await applyPaymentEffects(admin.firestore(), {
        teamId,
        contactId: session.contactId,
        lineItem: { kind: 'course', courseId, label: course.title },
        amountRappen: toMinorUnits(plan.drawdown),
        currency: 'CHF',
        source: 'gift_card',
        paymentRef,
      })
      await commitGiftCardHold({ teamId, code: data.giftCardCode, holdKey })
      return {
        url: null,
        sessionId: null,
        recurring: false,
        paidWithGiftCard: true,
        amount: 0,
        drawdown: plan.drawdown,
      }
    }

    metadata.giftCardCode = data.giftCardCode.trim().toUpperCase()
    metadata.giftCardHold = holdKey
    metadata.giftCardDrawdown = String(plan.drawdown)
    const residualAmount = requireChargeableAmountFromMajor(plan.residual)
    let checkout
    try {
      checkout = await startOneOffCheckout({
        team,
        amountMinor: residualAmount,
        productName: course.title,
        successUrl,
        cancelUrl,
        customerEmail: email,
        metadata,
        idempotencyKey,
        expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES * 60,
        label: 'createCourseCheckout',
      })
    } catch (err) {
      // Don't leave the reserved drawdown dangling until its lazy expiry.
      await releaseGiftCardHold({ teamId, code: data.giftCardCode, holdKey }).catch(() => undefined)
      throw err
    }
    return {
      url: checkout.url,
      sessionId: checkout.sessionId,
      recurring: false,
      amount: residualAmount,
      drawdown: plan.drawdown,
      residual: plan.residual,
    }
  }

  const checkout = await startOneOffCheckout({
    team,
    amountMinor: amount,
    productName: course.title,
    successUrl,
    cancelUrl,
    customerEmail: email,
    metadata,
    idempotencyKey,
    label: 'createCourseCheckout',
  })
  return { url: checkout.url, sessionId: checkout.sessionId, recurring: false }
})

// ─────────────────────────────────────────────────────────────────────────────
// pause / resume member subscription — the BILLING FREEZE (summer break, injury).
// Suspends invoicing, not belonging. Uses Stripe pause_collection on the connected
// account; also mirrors the flag onto the member_subscriptions record so the
// contact-level subscription_status rollup (onMemberSubscriptionWrite) updates
// immediately, without waiting for the webhook round-trip.
// ─────────────────────────────────────────────────────────────────────────────
async function setSubscriptionPause(
  uid: string,
  teamId: string | undefined,
  subscriptionId: string | undefined,
  pause: boolean
): Promise<{ ok: true; paused: boolean }> {
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!subscriptionId) throw new HttpsError('invalid-argument', 'subscriptionId is required')

  await assertManager(uid, teamId)
  const team = await loadEnabledTeam(teamId)
  const { accountId } = requireChargeableAccount(team)

  const stripe = await getConnectStripe()
  // pause_collection: { behavior: 'void' } freezes invoicing; '' clears it (resume).
  const pauseValue = pause ? { behavior: 'void' as const } : ''
  try {
    await stripe.subscriptions.update(
      subscriptionId,
      { pause_collection: pauseValue },
      { stripeAccount: accountId }
    )
  } catch (err) {
    console.error('[connect] setSubscriptionPause failed:', err)
    throw new HttpsError('internal', `Failed to ${pause ? 'pause' : 'resume'} the subscription`)
  }

  // Optimistic mirror → triggers the rollup recompute right away.
  await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION)
    .doc(subscriptionId)
    .set(
      { pause_collection: pause ? { behavior: 'void' } : null, updated_at: FieldValue.serverTimestamp() },
      { merge: true }
    )

  return { ok: true, paused: pause }
}

export const pauseMemberSubscription = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const data = request.data as { teamId?: string; subscriptionId?: string }
  return setSubscriptionPause(request.auth.uid, data?.teamId, data?.subscriptionId, true)
})

export const resumeMemberSubscription = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const data = request.data as { teamId?: string; subscriptionId?: string }
  return setSubscriptionPause(request.auth.uid, data?.teamId, data?.subscriptionId, false)
})

// Cancel a member's recurring subscription on the studio's connected account. Used when
// a manager reassigns a contact's plan and chooses to STOP their current billing (the
// manual-assign "stop current" path). Idempotent-ish: cancelling an already-cancelled
// sub throws, which we surface as 'internal'.
export const cancelMemberSubscription = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const { teamId, subscriptionId } = (request.data ?? {}) as {
    teamId?: string
    subscriptionId?: string
  }
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!subscriptionId) throw new HttpsError('invalid-argument', 'subscriptionId is required')

  await assertManager(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)
  const { accountId } = requireChargeableAccount(team)

  const stripe = await getConnectStripe()
  try {
    await stripe.subscriptions.cancel(subscriptionId, undefined, { stripeAccount: accountId })
  } catch (err) {
    console.error('[connect] cancelMemberSubscription failed:', err)
    throw new HttpsError('internal', 'Failed to cancel the subscription')
  }

  // Optimistic mirror → onMemberSubscriptionWrite recomputes the rollup + drops it from
  // active_subscriptions immediately (the webhook confirms shortly after).
  await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION)
    .doc(subscriptionId)
    .set({ status: 'canceled', updated_at: FieldValue.serverTimestamp() }, { merge: true })

  return { ok: true, canceled: true }
})
