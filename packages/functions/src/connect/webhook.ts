/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Stripe Connect — webhook handler (member → studio payments).
//
// Separate endpoint + signing secret from the SaaS-billing webhook
// (handleStripeWebhook). Connect events carry `event.account` (the connected
// account id), which we map back to a team via connect_accounts/{acctId}.
//
// Invariants:
//   • Verify the signature (constructConnectWebhookEvent).
//   • Idempotent: a per-event marker doc guards against duplicate delivery.
//   • Always return 200 after signature verification so Stripe stops retrying;
//     processing errors are logged, not surfaced as 5xx (except signature/secret).
//   • Reconcile local state from events only — never trust client-reported success.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import {
  CONNECT_ACCOUNTS_COLLECTION,
  CONNECT_WEBHOOK_EVENTS_COLLECTION,
  CONTACTS_COLLECTION,
  COURSES_COLLECTION,
  COURSE_PURCHASES_SUBCOLLECTION,
  MEMBER_PAYMENTS_SUBCOLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  PLAN_PRICING,
  planHasHardContactCap,
  type ConnectOnboardingModel,
  type SaasPlan,
} from '@linyup/shared'
import { getSecret } from '../utils/secrets'
import {
  constructConnectWebhookEvent,
  getConnectStripe,
  refundDirectCharge,
  retrieveAccountStatus,
} from '../utils/connect/client'
import { persistAccountStatus } from './access'
import { resolveSingleContact } from '../utils/contacts'

// Account/capability events → re-fetch the account (source of truth) and persist.
// Covers classic Connect account events and v2 thin account events.
function isAccountEvent(type: string): boolean {
  return (
    type === 'account.updated' ||
    type === 'capability.updated' ||
    type.startsWith('v2.core.account')
  )
}

interface TeamRef {
  teamId: string
  model: ConnectOnboardingModel
}

async function resolveTeam(accountId: string | undefined): Promise<TeamRef | null> {
  if (!accountId) return null
  const snap = await admin.firestore().collection(CONNECT_ACCOUNTS_COLLECTION).doc(accountId).get()
  if (!snap.exists) return null
  const d = snap.data()!
  return { teamId: d.teamId as string, model: (d.model as ConnectOnboardingModel) ?? 'managed' }
}

function memberPaymentRef(teamId: string, paymentIntentId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_PAYMENTS_SUBCOLLECTION)
    .doc(paymentIntentId)
}

function memberSubscriptionRef(teamId: string, subscriptionId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION)
    .doc(subscriptionId)
}

/** True if the contact holds a LIVE (active/trialing/past_due) member subscription of
 * the given type OTHER than excludeSubId (and not an already-flagged duplicate). The
 * checkout safety net uses this to detect a same-type double purchase. Queries by
 * contactId only (single-field index, like onMemberSubscriptionWrite) and filters in
 * memory — a contact has few subscriptions. */
async function contactHasOtherLiveSameType(
  teamId: string,
  contactId: string,
  subscriptionTypeId: string,
  excludeSubId: string
): Promise<boolean> {
  const snap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION)
    .where('contactId', '==', contactId)
    .get()
  const live = new Set(['active', 'trialing', 'past_due'])
  return snap.docs.some((d) => {
    if (d.id === excludeSubId) return false
    const s = d.data()
    return s.subscriptionTypeId === subscriptionTypeId && live.has(s.status as string) && !s.duplicate
  })
}

// ─── contact membership linkage (mirror of handlePayrexxWebhook) ─────────────────
// A membership payment carries metadata.kind === 'membership' + subscriptionTypeId.
// On success we update the buying contact's membership, just like Payrexx does.

function addMonths(months: number): Timestamp {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return Timestamp.fromDate(d)
}

/** Resolve the contact: prefer metadata.contactId (verified to belong to the team),
 * else fall back to a UNIQUE email match (none/ambiguous → null, never guess). */
async function resolveContactId(
  teamId: string,
  md: Record<string, string>,
  fallbackEmail?: string | null
): Promise<string | null> {
  if (md.contactId) {
    const snap = await admin.firestore().collection(CONTACTS_COLLECTION).doc(md.contactId).get()
    if (snap.exists && snap.data()?.teamId === teamId) return md.contactId
  }
  if (fallbackEmail) {
    const { contactId } = await resolveSingleContact(teamId, fallbackEmail)
    return contactId
  }
  return null
}

/** Write the subscription fields onto a known contact + an activity-log entry.
 * Note: membership_expiration is NOT written here — the subscription axis
 * (subscription_type_id etc.) is separate from the affiliation axis. */
async function writeContactMembership(
  teamId: string,
  contactId: string,
  md: Record<string, string>,
  opts: { amountRappen: number; membershipExpiration: Timestamp | null }
): Promise<void> {
  const db = admin.firestore()
  const update: Record<string, unknown> = {
    last_payment_at: FieldValue.serverTimestamp(),
    subscription_type_id: md.subscriptionTypeId,
    subscription_type_name: md.subscriptionTypeName ?? null,
    subscription_price_id: md.priceId ?? null,
    subscription_recurrence: md.recurrence ?? null,
    subscription_amount: Math.round(opts.amountRappen) / 100, // contact stores major units
    subscription_type_updated_at: FieldValue.serverTimestamp(),
  }
  // membership_expiration intentionally not written — subscription axis only
  void opts.membershipExpiration
  await db.collection(CONTACTS_COLLECTION).doc(contactId).set(update, { merge: true })
  await db
    .collection(CONTACTS_COLLECTION)
    .doc(contactId)
    .collection('activity_log')
    .add({
      type: 'payment_received',
      source: 'stripe_connect',
      message: `Membership payment received${md.subscriptionTypeName ? ` · ${md.subscriptionTypeName}` : ''}`,
      timestamp: FieldValue.serverTimestamp(),
    })
}

/** Apply membership to an EXISTING contact (resolved by id/email). Used by the
 * payment_intent / subscription handlers (incl. renewals). No contact creation. */
async function applyMembership(
  teamId: string,
  md: Record<string, string>,
  opts: { amountRappen: number; membershipExpiration: Timestamp | null; fallbackEmail?: string | null }
): Promise<void> {
  if (md.kind !== 'membership' || !md.subscriptionTypeId) return
  const contactId = await resolveContactId(teamId, md, opts.fallbackEmail)
  if (!contactId) {
    console.log(`[connect] membership: no existing contact matched (team=${teamId})`)
    return
  }
  await writeContactMembership(teamId, contactId, md, opts)
}

function splitName(full?: string | null): { firstname: string; lastname: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstname: '', lastname: '' }
  if (parts.length === 1) return { firstname: parts[0], lastname: '' }
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') }
}

/** Active (non-archived, non-deleted) contact count — cap basis (matches admin). */
async function activeContactCount(teamId: string): Promise<number> {
  const agg = await admin
    .firestore()
    .collection(CONTACTS_COLLECTION)
    .where('teamId', '==', teamId)
    .where('deleted_at', '==', null)
    .where('archived_at', '==', null)
    .count()
    .get()
  return agg.data().count
}

/**
 * Resolve a contact by a UNIQUE email match, or CREATE one from the buyer's
 * checkout details. Matching mirrors resolveSingleContact: exactly one active
 * match links; >1 (a shared family email) returns null so the studio assigns it,
 * never the wrong child. Cap-aware: on a plan with a hard contact cap (Free), if
 * the team is already at the limit the contact is NOT created (returns null) — the
 * payment is still recorded; the studio links it after upgrading/freeing a slot.
 */
async function resolveOrCreateContact(
  teamId: string,
  plan: SaasPlan,
  info: {
    email: string
    name?: string | null
    phone?: string | null
    firstname?: string | null
    lastname?: string | null
  },
  pendingSignup = false
): Promise<string | null> {
  const db = admin.firestore()
  const { contactId, count } = await resolveSingleContact(teamId, info.email)
  if (contactId) return contactId
  if (count > 1) {
    console.log(
      `[connect] shop purchase: ${count} contacts share ${info.email} (team=${teamId}) — left unassigned`
    )
    return null
  }

  // count === 0 → create the contact (cap-aware).
  if (planHasHardContactCap(plan)) {
    const cap = PLAN_PRICING[plan].includedContacts
    if (cap != null && (await activeContactCount(teamId)) >= cap) {
      console.log(
        `[connect] shop purchase: contact cap reached (team=${teamId}, plan=${plan}) — contact not created`
      )
      return null
    }
  }

  // Prefer the first/last name captured in the shop modal (passed via checkout
  // metadata); fall back to splitting Stripe's single `name` (unreliable — e.g. empty
  // for TWINT, or "First Last" merged on the card).
  const metaFirst = (info.firstname ?? '').trim()
  const metaLast = (info.lastname ?? '').trim()
  const { firstname, lastname } =
    metaFirst || metaLast ? { firstname: metaFirst, lastname: metaLast } : splitName(info.name)
  const ref = db.collection(CONTACTS_COLLECTION).doc()
  await ref.set({
    teamId,
    email: info.email,
    firstname,
    lastname,
    ...(info.phone ? { phone: info.phone } : {}),
    // A buyer who self-creates via the public shop has crossed into the community.
    acquisition_stage: 'joined',
    acquisition_stage_updated_at: FieldValue.serverTimestamp(),
    converted_at: FieldValue.serverTimestamp(),
    entry: 'signup',
    // 'full' checkout: paid but the buyer still has to finish signup (consent + the
    // studio's required fields). Flag it so the dashboard shows "pending signup" and the
    // signup-finalize page completes it. Set only on CREATE — never flip a returning member.
    ...(pendingSignup ? { pending_signup: true, signup_completed_at: null } : {}),
    archived_at: null,
    deleted_at: null,
    created_at: FieldValue.serverTimestamp(),
  })
  return ref.id
}

// ─── per-event-type handlers ─────────────────────────────────────────────────────

async function handlePaymentIntent(
  team: TeamRef,
  pi: any,
  status: 'succeeded' | 'failed',
  eventId: string
): Promise<void> {
  const md = (pi.metadata ?? {}) as Record<string, string>
  const now = FieldValue.serverTimestamp()
  await memberPaymentRef(team.teamId, pi.id).set(
    {
      teamId: team.teamId,
      paymentIntentId: pi.id,
      chargeId: typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? null),
      contactId: md.contactId ?? null,
      purpose: md.purpose ?? 'payment',
      // Product sales (kind === 'product') carry the catalogue reference so the
      // payments dashboard can show what was bought + which variant.
      ...(md.kind === 'product'
        ? {
            kind: 'product',
            productId: md.productId ?? null,
            productName: md.productName ?? null,
            variantLabel: md.variantLabel ?? null,
          }
        : {}),
      // Course sales (kind === 'course') carry the course reference so the payments
      // dashboard can show which course was bought.
      ...(md.kind === 'course'
        ? {
            kind: 'course',
            courseId: md.courseId ?? null,
            courseName: md.courseTitle ?? null,
          }
        : {}),
      // Drop-in (pay-per-class) charges carry the booked session so the payments
      // dashboard can show what the charge was for.
      ...(md.kind === 'drop_in'
        ? {
            kind: 'drop_in',
            sessionId: md.sessionId ?? null,
          }
        : {}),
      amount: pi.amount ?? 0,
      currency: pi.currency ?? 'chf',
      application_fee_amount: pi.application_fee_amount ?? 0,
      status,
      ...(status === 'succeeded' ? { amount_refunded: 0 } : {}),
      last_event_id: eventId,
      updated_at: now,
      created_at: now,
    },
    { merge: true }
  )

  // A successful one-off membership charge updates the buyer's contact membership.
  if (status === 'succeeded') {
    const months = md.includedMonths ? parseInt(md.includedMonths, 10) : 0
    await applyMembership(team.teamId, md, {
      amountRappen: pi.amount ?? 0,
      membershipExpiration: months > 0 ? addMonths(months) : null,
      fallbackEmail: (pi.receipt_email as string | undefined) ?? null,
    })
  }
}

async function handleChargeRefunded(team: TeamRef, charge: any, eventId: string): Promise<void> {
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!piId) return
  const amount: number = charge.amount ?? 0
  const amountRefunded: number = charge.amount_refunded ?? 0
  const appFee: number = charge.application_fee_amount ?? 0

  // Proportional application-fee reversal per refund (best-effort: Stripe reverses
  // the fee in proportion to each refund via refund_application_fee).
  const refunds = ((charge.refunds?.data ?? []) as any[]).map((r) => ({
    refundId: r.id as string,
    amount: (r.amount as number) ?? 0,
    feeReversed: amount > 0 ? Math.round((((r.amount as number) ?? 0) / amount) * appFee) : 0,
    reason: (r.reason as string) ?? null,
    created_at: r.created ? Timestamp.fromMillis((r.created as number) * 1000) : FieldValue.serverTimestamp(),
  }))

  const fullyRefunded = amountRefunded >= amount && amount > 0
  await memberPaymentRef(team.teamId, piId).set(
    {
      amount_refunded: amountRefunded,
      refunds,
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      last_event_id: eventId,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

async function handleDispute(team: TeamRef, dispute: any, eventId: string): Promise<void> {
  const piId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id
  if (!piId) return
  await memberPaymentRef(team.teamId, piId).set(
    {
      dispute_status: dispute.status ?? 'unknown',
      dispute_reason: dispute.reason ?? null,
      dispute_amount: dispute.amount ?? null,
      last_event_id: eventId,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

async function handleSubscription(team: TeamRef, sub: any, eventId: string): Promise<void> {
  const md = (sub.metadata ?? {}) as Record<string, string>
  const item = sub.items?.data?.[0]
  const now = FieldValue.serverTimestamp()
  await memberSubscriptionRef(team.teamId, sub.id).set(
    {
      teamId: team.teamId,
      subscriptionId: sub.id,
      customerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null),
      contactId: md.contactId ?? null,
      priceId: item?.price?.id ?? null,
      // The studio's stable type identity (from checkout metadata) — priceId above is
      // Stripe's ad-hoc inline price, useless for "same type" comparisons.
      subscriptionTypeId: md.subscriptionTypeId ?? null,
      subscriptionTypeName: md.subscriptionTypeName ?? null,
      recurrence: md.recurrence ?? null,
      amount: item?.price?.unit_amount ?? 0,
      currency: sub.currency ?? 'chf',
      application_fee_percent: sub.application_fee_percent ?? null,
      status: sub.status ?? 'incomplete',
      // Billing freeze (summer break / injury). When set, the rollup → 'paused'.
      pause_collection: sub.pause_collection ?? null,
      current_period_end: sub.current_period_end
        ? Timestamp.fromMillis((sub.current_period_end as number) * 1000)
        : null,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      last_event_id: eventId,
      updated_at: now,
      created_at: now,
    },
    { merge: true }
  )

  // While the recurring membership is active, keep the contact's membership in
  // sync (expiry tracks the current period end). Cancellations don't extend it.
  if (sub.status === 'active' || sub.status === 'trialing') {
    await applyMembership(team.teamId, md, {
      amountRappen: item?.price?.unit_amount ?? 0,
      membershipExpiration: sub.current_period_end
        ? Timestamp.fromMillis((sub.current_period_end as number) * 1000)
        : null,
    })
  }
}

async function handleInvoice(
  team: TeamRef,
  invoice: any,
  status: 'paid' | 'failed',
  eventId: string
): Promise<void> {
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subId) return
  await memberSubscriptionRef(team.teamId, subId).set(
    {
      status: status === 'paid' ? 'active' : 'past_due',
      last_invoice_id: invoice.id ?? null,
      last_payment_status: status,
      last_event_id: eventId,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

/**
 * checkout.session.completed — the authoritative point for linking the buyer's
 * contact (it carries customer_details: email, name, phone). Resolves/creates the
 * contact and applies membership. For subscriptions it also backfills contactId
 * into the Stripe subscription metadata so RENEWAL events (handleSubscription) link
 * the same contact. Covers both the public shop (email only) and the manager flow
 * (metadata.contactId). Idempotent with the payment_intent/subscription handlers.
 */
async function handleCheckoutCompleted(
  team: TeamRef,
  session: any,
  accountId: string | undefined,
  _eventId: string
): Promise<void> {
  const md = (session.metadata ?? {}) as Record<string, string>
  if (md.kind === 'product') {
    await handleProductCheckout(team, session, md)
    return
  }
  if (md.kind === 'course') {
    await handleCourseCheckout(team, session, md)
    return
  }
  if (md.kind === 'drop_in') {
    await handleDropInCheckout(team, session, accountId, md)
    return
  }
  if (md.kind !== 'membership' || !md.subscriptionTypeId) return

  const email = (session.customer_details?.email ?? session.customer_email ?? '')
    .toLowerCase()
    .trim()
  const name = (session.customer_details?.name as string | undefined) ?? null
  const phone = (session.customer_details?.phone as string | undefined) ?? null

  // Prefer an explicit contactId (manager flow); else resolve/create by email.
  let contactId: string | null = null
  if (md.contactId) {
    const snap = await admin.firestore().collection(CONTACTS_COLLECTION).doc(md.contactId).get()
    if (snap.exists && snap.data()?.teamId === team.teamId) contactId = md.contactId
  }
  if (!contactId && email) {
    const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(team.teamId).get()
    const plan = (teamSnap.data()?.plan as SaasPlan | undefined) ?? 'free'
    contactId = await resolveOrCreateContact(
      team.teamId,
      plan,
      {
        email,
        name,
        phone,
        firstname: md.firstname ?? null,
        lastname: md.lastname ?? null,
      },
      md.contactMode === 'full'
    )
  }
  if (!contactId) return // cap-blocked or no email — payment is still recorded by other handlers

  const amountRappen = (session.amount_total as number | undefined) ?? 0
  let membershipExpiration: Timestamp | null = null

  if (session.mode === 'subscription' && session.subscription) {
    const subId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id
    let latestPaymentIntentId: string | null = null
    if (accountId) {
      try {
        const stripe = await getConnectStripe()
        await stripe.subscriptions.update(
          subId,
          { metadata: { ...md, contactId } },
          { stripeAccount: accountId }
        )
        const sub: any = await stripe.subscriptions.retrieve(
          subId,
          { expand: ['latest_invoice.payment_intent'] },
          { stripeAccount: accountId }
        )
        const cpe = sub.current_period_end as number | undefined
        membershipExpiration = cpe ? Timestamp.fromMillis(cpe * 1000) : null
        const pi = sub.latest_invoice?.payment_intent
        latestPaymentIntentId = typeof pi === 'string' ? pi : (pi?.id ?? null)
      } catch (err) {
        console.error('[connect] subscription backfill/retrieve failed:', err)
      }
    }
    await memberSubscriptionRef(team.teamId, subId).set(
      { contactId, subscriptionTypeId: md.subscriptionTypeId ?? null },
      { merge: true }
    )

    // Safety net: if the contact already holds a LIVE subscription of THIS SAME type (a
    // duplicate that slipped past the checkout guard — two tabs, or a late email link),
    // cancel this new subscription and refund its charge. A contact may hold several
    // *different* types at once, never two of the same.
    if (
      md.subscriptionTypeId &&
      (await contactHasOtherLiveSameType(team.teamId, contactId, md.subscriptionTypeId, subId))
    ) {
      if (accountId) {
        try {
          const stripe = await getConnectStripe()
          await stripe.subscriptions.cancel(subId, undefined, { stripeAccount: accountId })
          if (latestPaymentIntentId) {
            await refundDirectCharge({
              accountId,
              paymentIntentId: latestPaymentIntentId,
              reason: 'duplicate',
              idempotencyKey: `dup-refund:${subId}`,
            })
          }
        } catch (err) {
          console.error('[connect] duplicate subscription cancel/refund failed:', err)
        }
      }
      await memberSubscriptionRef(team.teamId, subId).set(
        { status: 'canceled', duplicate: true, updated_at: FieldValue.serverTimestamp() },
        { merge: true }
      )
      console.log(
        `[connect] duplicate same-type subscription ${subId} (type=${md.subscriptionTypeId}, contact=${contactId}) — cancelled + refunded`
      )
      return // do NOT snapshot the refunded duplicate onto the contact
    }
  } else {
    const months = md.includedMonths ? parseInt(md.includedMonths, 10) : 0
    membershipExpiration = months > 0 ? addMonths(months) : null
    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id
    if (piId) await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })
  }

  await writeContactMembership(team.teamId, contactId, md, { amountRappen, membershipExpiration })
}

/**
 * Product purchase (kind === 'product') — a one-off shop charge for a physical
 * product. The payment_intent handler already records the member_payments doc
 * (with productId/variant). Here we link/create the buyer's contact by email
 * (cap-aware, same as a membership shop purchase), stamp contactId onto the
 * payment, and log a purchase activity entry so the studio sees who bought what.
 * No membership/subscription state changes — products are merch, not memberships.
 */
async function handleProductCheckout(
  team: TeamRef,
  session: any,
  md: Record<string, string>
): Promise<void> {
  const email = (session.customer_details?.email ?? session.customer_email ?? '')
    .toLowerCase()
    .trim()
  if (!email) return // nothing to link the sale to; payment is still recorded

  const name = (session.customer_details?.name as string | undefined) ?? null
  const phone = (session.customer_details?.phone as string | undefined) ?? null

  const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(team.teamId).get()
  const plan = (teamSnap.data()?.plan as SaasPlan | undefined) ?? 'free'
  const contactId = await resolveOrCreateContact(team.teamId, plan, { email, name, phone })
  if (!contactId) return // cap-blocked — payment still recorded, studio links it later

  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
  if (piId) await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })

  const label = md.variantLabel ? `${md.productName ?? 'Product'} · ${md.variantLabel}` : (md.productName ?? 'Product')
  await admin
    .firestore()
    .collection(CONTACTS_COLLECTION)
    .doc(contactId)
    .collection('activity_log')
    .add({
      type: 'product_purchased',
      source: 'stripe_connect',
      message: `Product purchased · ${label}`,
      timestamp: FieldValue.serverTimestamp(),
    })
}

/**
 * Course purchase (kind === 'course') — a one-off shop charge for a 'purchase'-tier
 * online course. Like products, the payment_intent handler already records the
 * member_payments doc (with courseId/courseName). Here we link/create the buyer's
 * contact by email (cap-aware), grant a LIFETIME entitlement
 * (courses/{courseId}/purchases/{contactId} — what the security rules check to unlock
 * the course in the Space), stamp contactId onto the payment, and log the purchase.
 */
async function handleCourseCheckout(
  team: TeamRef,
  session: any,
  md: Record<string, string>
): Promise<void> {
  if (!md.courseId) return
  const email = (session.customer_details?.email ?? session.customer_email ?? '')
    .toLowerCase()
    .trim()
  if (!email) return // nothing to grant the entitlement to; payment is still recorded

  const name = (session.customer_details?.name as string | undefined) ?? null
  const phone = (session.customer_details?.phone as string | undefined) ?? null

  const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(team.teamId).get()
  const plan = (teamSnap.data()?.plan as SaasPlan | undefined) ?? 'free'
  const contactId = await resolveOrCreateContact(team.teamId, plan, { email, name, phone })
  if (!contactId) return // cap-blocked — payment still recorded, studio links it later

  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
  if (piId) await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })

  // Grant the lifetime entitlement. Doc id = contactId → idempotent on redelivery.
  await admin
    .firestore()
    .collection(COURSES_COLLECTION)
    .doc(md.courseId)
    .collection(COURSE_PURCHASES_SUBCOLLECTION)
    .doc(contactId)
    .set(
      {
        courseId: md.courseId,
        teamId: team.teamId,
        contactId,
        paymentIntentId: piId ?? null,
        amount: (session.amount_total as number | undefined) ?? null,
        currency: (session.currency as string | undefined) ?? null,
        purchasedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

  await admin
    .firestore()
    .collection(CONTACTS_COLLECTION)
    .doc(contactId)
    .collection('activity_log')
    .add({
      type: 'course_purchased',
      source: 'stripe_connect',
      message: `Course purchased · ${md.courseTitle ?? 'Course'}`,
      timestamp: FieldValue.serverTimestamp(),
    })
}

/**
 * Drop-in booking (kind === 'drop_in') — a pay-per-class charge that confirms a
 * PENDING booking hold created by createDropInCheckout. The payment_intent handler
 * already recorded the member_payments doc (with sessionId). Here we flip the pending
 * booking to confirmed/paid, count it toward the session, stamp contactId on the
 * payment, and log it. The contact was resolved at checkout time and passed via
 * metadata.contactId (re-verified to belong to the team). Idempotent on redelivery.
 */
async function handleDropInCheckout(
  team: TeamRef,
  session: any,
  accountId: string | undefined,
  md: Record<string, string>
): Promise<void> {
  const { sessionId, contactId } = md
  if (!sessionId || !contactId) return
  const db = admin.firestore()

  const cSnap = await db.collection(CONTACTS_COLLECTION).doc(contactId).get()
  if (!cSnap.exists || cSnap.data()?.teamId !== team.teamId) return
  const contact = cSnap.data()!

  const bookingRef = db.collection('sessions').doc(sessionId).collection('bookings').doc(contactId)
  const bSnap = await bookingRef.get()
  const piId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id

  // Already confirmed: an idempotent redelivery of the SAME charge, OR a second
  // (duplicate) charge for a booking that's already paid — refund the duplicate so
  // the buyer is never charged twice for one seat.
  if (bSnap.exists && bSnap.data()?.status === 'confirmed') {
    const existingPi = (bSnap.data()?.payment_intent_id as string | undefined) ?? null
    if (piId && existingPi && existingPi !== piId && accountId) {
      try {
        await refundDirectCharge({
          accountId,
          paymentIntentId: piId,
          reason: 'duplicate',
          idempotencyKey: `dropin-dup:${piId}`,
        })
        await memberPaymentRef(team.teamId, piId).set(
          { contactId, status: 'refunded', updated_at: FieldValue.serverTimestamp() },
          { merge: true }
        )
        console.log(`[connect] drop-in duplicate charge ${piId} refunded (booking already confirmed)`)
      } catch (err) {
        console.error('[connect] drop-in duplicate refund failed:', err)
      }
    }
    return
  }

  // Confirm the pending hold — or recreate the booking from metadata if the hold was
  // already swept before payment landed (a paid charge must never be lost).
  const isNew = !bSnap.exists
  await bookingRef.set(
    {
      firstname: (contact.firstname as string) ?? '',
      lastname: (contact.lastname as string) ?? '',
      email: (contact.email as string) ?? '',
      phone: (contact.phone as string) ?? null,
      contact: contactId,
      session: sessionId,
      teamId: team.teamId,
      status: 'confirmed',
      payment_status: 'paid',
      payment_intent_id: piId ?? null,
      expires_at: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
      ...(isNew
        ? { joinedAt: FieldValue.serverTimestamp(), fromBioLink: true, is_new_contact: false }
        : {}),
    },
    { merge: true }
  )

  // Now that it's paid, count it toward the session's bookings.
  await db
    .collection('sessions')
    .doc(sessionId)
    .set(
      {
        has_bookings: true,
        bio_link_bookings_count: FieldValue.increment(1),
        last_booking_at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

  if (piId) await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })

  await db
    .collection(CONTACTS_COLLECTION)
    .doc(contactId)
    .collection('activity_log')
    .add({
      type: 'drop_in_booked',
      source: 'stripe_connect',
      message: `Drop-in booking · ${md.activityName ?? 'Class'}`,
      timestamp: FieldValue.serverTimestamp(),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// handleConnectWebhook
// ─────────────────────────────────────────────────────────────────────────────
export const handleConnectWebhook = onRequest({ invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed')
    return
  }

  const signature = req.headers['stripe-signature']
  if (!signature || typeof signature !== 'string') {
    res.status(400).send('Missing stripe-signature header')
    return
  }

  let secret: string
  try {
    secret = await getSecret('stripe-connect-webhook-secret')
  } catch (err) {
    console.error('[connect] failed to load stripe-connect-webhook-secret:', err)
    res.status(500).send('Internal error')
    return
  }

  let event: any
  try {
    event = await constructConnectWebhookEvent({
      payload: req.rawBody ?? req.body,
      signature,
      secret,
    })
  } catch (err) {
    console.error('[connect] webhook signature verification failed:', err)
    res.status(400).send('Invalid webhook signature')
    return
  }

  // Idempotency: claim the event id; a duplicate delivery fails the create and
  // short-circuits without reprocessing.
  try {
    await admin
      .firestore()
      .collection(CONNECT_WEBHOOK_EVENTS_COLLECTION)
      .doc(event.id)
      .create({ type: event.type, account: event.account ?? null, at: FieldValue.serverTimestamp() })
  } catch {
    console.log(`[connect] duplicate event ${event.id} — skipping`)
    res.status(200).send('ok')
    return
  }

  try {
    const accountId: string | undefined = event.account
    const obj = event.data?.object ?? {}

    if (isAccountEvent(event.type)) {
      const team = await resolveTeam(accountId)
      if (team) {
        const status = await retrieveAccountStatus(accountId!)
        await persistAccountStatus(team.teamId, accountId!, team.model, status)
      } else {
        console.log(`[connect] account event for untracked account ${accountId}`)
      }
    } else {
      const team = await resolveTeam(accountId)
      if (!team) {
        console.log(`[connect] event ${event.type} for untracked account ${accountId} — skipping`)
        res.status(200).send('ok')
        return
      }
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(team, obj, accountId, event.id)
          break
        case 'payment_intent.succeeded':
          await handlePaymentIntent(team, obj, 'succeeded', event.id)
          break
        case 'payment_intent.payment_failed':
          await handlePaymentIntent(team, obj, 'failed', event.id)
          break
        case 'charge.refunded':
          await handleChargeRefunded(team, obj, event.id)
          break
        case 'charge.dispute.created':
        case 'charge.dispute.closed':
          await handleDispute(team, obj, event.id)
          break
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscription(team, obj, event.id)
          break
        case 'customer.subscription.deleted':
          await handleSubscription(team, { ...obj, status: 'canceled' }, event.id)
          break
        case 'invoice.paid':
          await handleInvoice(team, obj, 'paid', event.id)
          break
        case 'invoice.payment_failed':
          await handleInvoice(team, obj, 'failed', event.id)
          break
        default:
          console.log(`[connect] unhandled event type ${event.type}`)
      }
    }
    console.log(`[connect] processed ${event.type} (${event.id}) account=${accountId}`)
  } catch (err) {
    // Log but return 200 — Stripe should not retry forever for our errors. The
    // event marker has already been written; manual reconcile via getConnectStatus
    // / Stripe dashboard if needed.
    console.error(`[connect] failed to process event ${event.id}:`, err)
  }

  res.status(200).send('ok')
})
