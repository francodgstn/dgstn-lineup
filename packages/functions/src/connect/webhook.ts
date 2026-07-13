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
  CONTACT_CREDIT_GRANTS_SUBCOLLECTION,
  COURSES_COLLECTION,
  COURSE_PURCHASES_SUBCOLLECTION,
  MEMBER_PAYMENTS_SUBCOLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  buildConnectChargeTxn,
  buildConnectRefundTxn,
  buildDisputeTxn,
  buildPayoutTxn,
  financeTxnId,
  mapCategory,
  type ConnectOnboardingModel,
  type FinanceCategory,
  type SaasPlan,
} from '@linyup/shared'
import { canCreateContact } from '../utils/contactCap'
import { getSecret } from '../utils/secrets'
import {
  constructConnectWebhookEvent,
  getConnectStripe,
  refundDirectCharge,
  retrieveAccountStatus,
} from '../utils/connect/client'
import { persistAccountStatus } from './access'
import { resolveSingleContact } from '../utils/contacts'
import { writeContactSubscriptionFields } from '../payments/effects'
import {
  linkFinanceTxnContact,
  linkFinanceTxnPayout,
  recordFinanceTransaction,
  retrieveChargeFees,
  upgradeChargeFeesIfDegraded,
} from '../finance/journal'

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

/**
 * Materialise a lesson-credit grant for a paid credit pack (metadata.credits on
 * a one-off membership charge). Doc id = paymentIntentId, so the two webhook
 * events a purchase produces (checkout.session.completed + payment_intent.succeeded)
 * converge on one grant — `create()` refuses the second write. The
 * onCreditGrantWrite sync recomputes Contact.credit_summary.
 */
async function applyCreditGrant(
  teamId: string,
  contactId: string,
  md: Record<string, string>,
  paymentIntentId: string
): Promise<void> {
  const credits = md.credits ? parseInt(md.credits, 10) : 0
  if (!credits || credits <= 0 || !md.subscriptionTypeId) return
  const months = md.includedMonths ? parseInt(md.includedMonths, 10) : 0
  try {
    await admin
      .firestore()
      .collection(CONTACTS_COLLECTION)
      .doc(contactId)
      .collection(CONTACT_CREDIT_GRANTS_SUBCOLLECTION)
      .doc(paymentIntentId)
      .create({
        teamId,
        subscription_type_id: md.subscriptionTypeId,
        subscription_type_name: md.subscriptionTypeName ?? null,
        price_id: md.priceId ?? null,
        credits_total: credits,
        credits_used: 0,
        expires_at: months > 0 ? addMonths(months) : null,
        source: 'stripe',
        payment_intent_id: paymentIntentId,
        created_at: FieldValue.serverTimestamp(),
      })
    console.log(
      `[connect] credit grant: ${credits} credits (type=${md.subscriptionTypeId}) → contact ${contactId}`
    )
  } catch (err: unknown) {
    // ALREADY_EXISTS = the sibling webhook event won the race — expected.
    if ((err as { code?: number }).code === 6) return
    throw err
  }
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
  // Subscription-axis fields via the shared writer (single source of the field list).
  // membership_expiration intentionally not written — subscription axis only.
  void opts.membershipExpiration
  await writeContactSubscriptionFields(db, contactId, {
    subscriptionTypeId: md.subscriptionTypeId,
    subscriptionTypeName: md.subscriptionTypeName ?? null,
    priceId: md.priceId ?? null,
    recurrence: md.recurrence ?? null,
    amountMajor: Math.round(opts.amountRappen) / 100, // contact stores major units
  })
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
  opts: {
    amountRappen: number
    membershipExpiration: Timestamp | null
    fallbackEmail?: string | null
    paymentIntentId?: string | null
  }
): Promise<void> {
  if (md.kind !== 'membership' || !md.subscriptionTypeId) return
  const contactId = await resolveContactId(teamId, md, opts.fallbackEmail)
  if (!contactId) {
    console.log(`[connect] membership: no existing contact matched (team=${teamId})`)
    return
  }
  await writeContactMembership(teamId, contactId, md, opts)
  if (opts.paymentIntentId) await applyCreditGrant(teamId, contactId, md, opts.paymentIntentId)
}

function splitName(full?: string | null): { firstname: string; lastname: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstname: '', lastname: '' }
  if (parts.length === 1) return { firstname: parts[0], lastname: '' }
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') }
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

  // count === 0 → create the contact (cap-aware; shared with shop registration).
  if (!(await canCreateContact(teamId, plan))) {
    console.log(
      `[connect] shop purchase: contact cap reached (team=${teamId}, plan=${plan}) — contact not created`
    )
    return null
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
    // The shop is an OFF-FUNNEL entry route: a buyer who self-creates via the public
    // shop hasn't started the trial→join journey (they may only have bought a one-off
    // product/course, and may never intend to train). So they get NO acquisition_stage
    // ("not applicable"); the purchase is captured on the subscription axis (recurring)
    // or as payment/order history (one-off). If they later book a trial they enter the
    // funnel normally. Their membership (if any) is reflected via active_subscriptions.
    entry: 'shop',
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

/**
 * Resolve the buyer's contact from checkout metadata: a login-first checkout always
 * carries metadata.contactId (the session identity). Re-verified against the team
 * before trusting — metadata is set server-side, but never skip the ownership check.
 * Returns null for legacy sessions without one (caller falls back to email linking).
 */
async function verifiedMetadataContact(
  teamId: string,
  md: Record<string, string>
): Promise<string | null> {
  if (!md.contactId) return null
  const snap = await admin.firestore().collection(CONTACTS_COLLECTION).doc(md.contactId).get()
  return snap.exists && snap.data()?.teamId === teamId ? md.contactId : null
}

/**
 * First successful payment CONFIRMS a provisional contact (a login-first shop
 * registration — see Contact.provisional): clear the flag + purge deadline so the
 * daily purge task leaves it alone. No-op for normal contacts.
 */
async function confirmProvisionalContact(contactId: string): Promise<void> {
  const ref = admin.firestore().collection(CONTACTS_COLLECTION).doc(contactId)
  const snap = await ref.get()
  if (snap.exists && snap.data()?.provisional === true) {
    await ref.update({
      provisional: FieldValue.delete(),
      provisional_expires_at: FieldValue.delete(),
    })
    console.log(`[connect] payment confirmed provisional contact ${contactId}`)
  }
}

// ─── per-event-type handlers ─────────────────────────────────────────────────────

/** Best-effort: mirror a late-resolved buyer contact onto the finance journal
 * charge row (checkout handlers link the contact AFTER payment_intent.succeeded
 * already journaled the charge). Metadata only — never touches amounts. */
async function stampFinanceContact(teamId: string, piId: string, contactId: string): Promise<void> {
  try {
    await linkFinanceTxnContact(teamId, financeTxnId('connect', 'charge', piId), contactId)
  } catch (err) {
    console.warn(`[connect] finance contact stamp failed (pi=${piId}):`, err)
  }
}

/**
 * Structured "what was bought" for the payments dashboard's assign/edit dialog,
 * mirroring the BYO rail's ExternalPayment.line_item (kind 'membership' maps to
 * the line-item spelling 'subscription'). Built from checkout metadata; renewal
 * invoices get theirs stamped by handleInvoice from the subscription doc.
 */
function lineItemFromMetadata(md: Record<string, string>): Record<string, unknown> | null {
  if (md.kind === 'membership' && md.subscriptionTypeId) {
    return {
      kind: 'subscription',
      subscriptionTypeId: md.subscriptionTypeId,
      priceId: md.priceId ?? null,
      label: md.subscriptionTypeName ?? null,
    }
  }
  if (md.kind === 'product' && md.productId) {
    return {
      kind: 'product',
      productId: md.productId,
      variantId: md.variantId ?? null,
      label: md.variantLabel ? `${md.productName ?? 'Product'} · ${md.variantLabel}` : (md.productName ?? null),
    }
  }
  if (md.kind === 'course' && md.courseId) {
    return { kind: 'course', courseId: md.courseId, label: md.courseTitle ?? null }
  }
  if (md.kind === 'drop_in') {
    return { kind: 'drop_in', label: md.activityName ?? null }
  }
  return null
}

/** Human "what was paid" label for the finance journal, from checkout metadata. */
function financeDescription(md: Record<string, string>): string | null {
  if (md.kind === 'product') {
    return md.variantLabel ? `${md.productName ?? 'Product'} · ${md.variantLabel}` : (md.productName ?? null)
  }
  if (md.kind === 'course') return md.courseTitle ?? null
  if (md.kind === 'membership') return md.subscriptionTypeName ?? null
  if (md.kind === 'drop_in') return md.activityName ?? 'Drop-in'
  return md.purpose ?? null
}

async function handlePaymentIntent(
  team: TeamRef,
  pi: any,
  status: 'succeeded' | 'failed',
  eventId: string,
  accountId?: string
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
      // Membership purchases carry the subscription type name so the dashboard row
      // reads "Monthly Unlimited" instead of a bare "payment". (One-off membership
      // prices only — recurring invoice PIs carry no metadata; handleInvoice and the
      // checkout handler stamp those.)
      ...(md.kind === 'membership'
        ? {
            kind: 'membership',
            subscriptionTypeName: md.subscriptionTypeName ?? null,
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
      // Structured "what was bought" — fills the assign/edit dialog's line-item
      // picker, aligned with the BYO rail.
      ...(lineItemFromMetadata(md) ? { line_item: lineItemFromMetadata(md) } : {}),
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

  // A successful one-off membership charge updates the buyer's contact membership
  // (and materialises the credit grant when the price is a credit pack).
  if (status === 'succeeded') {
    const months = md.includedMonths ? parseInt(md.includedMonths, 10) : 0
    await applyMembership(team.teamId, md, {
      amountRappen: pi.amount ?? 0,
      membershipExpiration: months > 0 ? addMonths(months) : null,
      fallbackEmail: (pi.receipt_email as string | undefined) ?? null,
      paymentIntentId: (pi.id as string | undefined) ?? null,
    })

    // Finance journal: fetch the authoritative fee split (Stripe fee + application
    // fee + net) from the charge's balance transaction, then append the charge row.
    // Failures never break payment processing — the backfill reconciles.
    try {
      const chargeId =
        typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? null)
      const fees = accountId && chargeId ? await retrieveChargeFees(accountId, chargeId) : null
      await recordFinanceTransaction(
        buildConnectChargeTxn({
          teamId: team.teamId,
          paymentIntentId: pi.id as string,
          amount: (pi.amount as number) ?? 0,
          currency: pi.currency as string | undefined,
          applicationFeeAmount: (pi.application_fee_amount as number) ?? 0,
          fees,
          kind: md.kind ?? null,
          contactId: md.contactId ?? null,
          description: financeDescription(md),
          occurredAtMs: typeof pi.created === 'number' ? pi.created * 1000 : Date.now(),
          eventId,
        })
      )
      // Mirror the fee split onto the member_payments doc for the dashboard.
      if (fees) {
        await memberPaymentRef(team.teamId, pi.id).set(
          { stripe_fee_amount: fees.stripeFee, balance_txn_id: fees.balanceTxnId },
          { merge: true }
        )
      }
    } catch (err) {
      console.error(`[connect] finance journal write failed (pi=${pi.id}):`, err)
    }
  }
}

async function handleChargeRefunded(
  team: TeamRef,
  charge: any,
  eventId: string,
  accountId?: string
): Promise<void> {
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!piId) return
  const amount: number = charge.amount ?? 0
  const amountRefunded: number = charge.amount_refunded ?? 0
  const appFee: number = charge.application_fee_amount ?? 0

  // The refund list. On current Stripe API versions the charge object in the
  // webhook payload NO LONGER embeds `refunds` — fetch them from the API when
  // absent (without this, refunds[] and the finance-journal refund rows were
  // silently never written even though amount_refunded/status updated).
  let refundObjects = (charge.refunds?.data ?? []) as any[]
  if (refundObjects.length === 0 && amountRefunded > 0 && accountId) {
    try {
      const stripe = await getConnectStripe()
      const list: any = await stripe.refunds.list(
        { payment_intent: piId, limit: 100 },
        { stripeAccount: accountId }
      )
      refundObjects = (list.data ?? []) as any[]
    } catch (err) {
      console.error(`[connect] refund list fetch failed (pi=${piId}):`, err)
    }
  }

  // Proportional application-fee reversal per refund (best-effort: Stripe reverses
  // the fee in proportion to each refund via refund_application_fee).
  const refunds = refundObjects.map((r) => ({
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
      // Don't clobber a previously-written list when the fetch fallback failed.
      ...(refunds.length > 0 ? { refunds } : {}),
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      last_event_id: eventId,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  // Finance journal: one row PER refund object (partials each get a row; the
  // deterministic re_ id makes redeliveries no-ops). Context (kind/contact/label)
  // comes from the payment doc just updated.
  try {
    const paySnap = await memberPaymentRef(team.teamId, piId).get()
    const pay = paySnap.data() ?? {}
    for (const r of refundObjects) {
      await recordFinanceTransaction(
        buildConnectRefundTxn({
          teamId: team.teamId,
          refundId: r.id as string,
          paymentIntentId: piId,
          amount: (r.amount as number) ?? 0,
          feeReversed: amount > 0 ? Math.round((((r.amount as number) ?? 0) / amount) * appFee) : 0,
          currency: (charge.currency as string | undefined) ?? (pay.currency as string | undefined),
          kind: (pay.kind as string | undefined) ?? null,
          contactId: (pay.contactId as string | undefined) ?? null,
          // "Refund · " prefix so refunds read apart from their charge in the
          // entries list / CSV (disputes get the same treatment).
          description: `Refund · ${(pay.comment as string | undefined) ?? (pay.subscriptionTypeName as string | undefined) ?? (pay.productName as string | undefined) ?? (pay.courseName as string | undefined) ?? piId}`,
          occurredAtMs: typeof r.created === 'number' ? r.created * 1000 : Date.now(),
          eventId,
        })
      )
    }
  } catch (err) {
    console.error(`[connect] finance journal refund write failed (pi=${piId}):`, err)
  }
}

async function handleDispute(
  team: TeamRef,
  dispute: any,
  phase: 'created' | 'closed',
  eventId: string
): Promise<void> {
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

  // Finance journal. Funds movement comes from the dispute's balance transactions
  // (an inquiry/early-warning dispute has none — nothing to journal then):
  //   created      → withdrawal entries (net < 0) → 'dispute' row
  //   closed 'won' → reversal entries  (net > 0) → 'dispute_reversal' row
  // The dispute fee is the residual between balance net and the disputed amount,
  // so the row always ties to what actually moved on the studio's balance.
  try {
    const bts = ((dispute.balance_transactions ?? []) as any[]).filter(
      (bt) => typeof bt?.net === 'number'
    )
    const kind = phase === 'closed' && dispute.status === 'won' ? 'dispute_reversal' : 'dispute'
    if (phase === 'closed' && dispute.status !== 'won') return // lost/warning-closed: nothing new moved
    const relevant = bts.filter((bt) => (kind === 'dispute' ? bt.net < 0 : bt.net > 0))
    if (relevant.length === 0) return
    const balanceNet = relevant.reduce((sum, bt) => sum + (bt.net as number), 0)

    const paySnap = await memberPaymentRef(team.teamId, piId).get()
    const pay = paySnap.data() ?? {}
    await recordFinanceTransaction(
      buildDisputeTxn({
        teamId: team.teamId,
        disputeId: dispute.id as string,
        paymentIntentId: piId,
        amount: (dispute.amount as number) ?? 0,
        balanceNet,
        kind,
        currency: (dispute.currency as string | undefined) ?? (pay.currency as string | undefined),
        contactId: (pay.contactId as string | undefined) ?? null,
        category: mapCategory(pay.kind as string | undefined) as FinanceCategory,
        description: dispute.reason ? `Dispute · ${dispute.reason}` : 'Dispute',
        occurredAtMs: typeof dispute.created === 'number' ? dispute.created * 1000 : Date.now(),
        eventId,
      })
    )
  } catch (err) {
    console.error(`[connect] finance journal dispute write failed (dp=${dispute.id}):`, err)
  }
}

/**
 * charge.updated — the fee-enrichment healer. Async payment methods (TWINT, …)
 * succeed WITHOUT a balance transaction, so their journal row is written with
 * fee_source 'recorded' (Stripe fee unknown); Stripe emits charge.updated once
 * balance_transaction is populated — upgrade the row in place then (accounting
 * re-posts via onFinanceTransactionWrite). Card charges no-op here (already
 * authoritative from payment_intent.succeeded).
 * NOTE (ops): the Connect webhook endpoint must be subscribed to charge.updated
 * — see docs/finance-reports.md.
 */
async function handleChargeUpdated(team: TeamRef, charge: any, accountId?: string): Promise<void> {
  const piId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!piId || !accountId || !charge.balance_transaction) return
  try {
    const upgraded = await upgradeChargeFeesIfDegraded(
      team.teamId,
      accountId,
      piId,
      charge.id as string
    )
    if (upgraded) console.log(`[finance] fee split upgraded via charge.updated (pi=${piId})`)
  } catch (err) {
    // Healing must never fail the webhook — the backfill (--force-fees) reconciles.
    console.warn(`[finance] charge.updated fee upgrade failed (pi=${piId}):`, err)
  }
}

/**
 * payout.paid / payout.failed on the connected account — the settlement events
 * that let a studio reconcile Linyup's journal against its bank statement.
 * Writes the payout row, then stamps payout_id onto the charge rows whose
 * balance transactions the payout swept (metadata linkage; rows not yet written
 * are picked up by the backfill's payout pass).
 * NOTE (ops): the Stripe Connect webhook endpoint must be subscribed to
 * payout.paid + payout.failed — see docs/finance-reports.md.
 */
async function handlePayout(
  team: TeamRef,
  payout: any,
  kind: 'paid' | 'failed',
  accountId: string,
  eventId: string
): Promise<void> {
  const created = await recordFinanceTransaction(
    buildPayoutTxn({
      teamId: team.teamId,
      payoutId: payout.id as string,
      amount: (payout.amount as number) ?? 0,
      kind,
      currency: payout.currency as string | undefined,
      occurredAtMs: typeof payout.created === 'number' ? payout.created * 1000 : Date.now(),
      arrivalDateMs: typeof payout.arrival_date === 'number' ? payout.arrival_date * 1000 : null,
      eventId,
    })
  )
  if (!created || kind !== 'paid') return

  // Link the swept charges (bounded pagination; linkage is best-effort metadata).
  try {
    const stripe = await getConnectStripe()
    let startingAfter: string | undefined
    for (let page = 0; page < 20; page += 1) {
      const list: any = await stripe.balanceTransactions.list(
        { payout: payout.id as string, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
        { stripeAccount: accountId }
      )
      for (const bt of (list.data ?? []) as any[]) {
        if (bt.type === 'payout') continue
        await linkFinanceTxnPayout(team.teamId, bt.id as string, payout.id as string)
      }
      if (!list.has_more || !list.data?.length) break
      startingAfter = list.data[list.data.length - 1].id as string
    }
  } catch (err) {
    console.warn(`[connect] payout linkage failed (po=${payout.id}):`, err)
  }
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
      // Identity fields are OMITTED (not nulled) when the event's metadata lacks
      // them: Stripe events are unordered, so a pre-backfill subscription event
      // arriving AFTER checkout.session.completed must never wipe the contactId
      // that handler already stamped (it broke the contact's Stripe-billing view).
      ...(md.contactId ? { contactId: md.contactId } : {}),
      priceId: item?.price?.id ?? null,
      // The studio's stable type identity (from checkout metadata) — priceId above is
      // Stripe's ad-hoc inline price, useless for "same type" comparisons.
      ...(md.subscriptionTypeId ? { subscriptionTypeId: md.subscriptionTypeId } : {}),
      ...(md.subscriptionTypeName ? { subscriptionTypeName: md.subscriptionTypeName } : {}),
      ...(md.recurrence ? { recurrence: md.recurrence } : {}),
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
  const subRef = memberSubscriptionRef(team.teamId, subId)
  await subRef.set(
    {
      status: status === 'paid' ? 'active' : 'past_due',
      last_invoice_id: invoice.id ?? null,
      last_payment_status: status,
      last_event_id: eventId,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  // Link + label the invoice's charge: invoice-generated PaymentIntents carry no
  // metadata, so handlePaymentIntent records them as bare unassigned 'payment' rows.
  // The member_subscriptions doc holds the contact + type name — stamp them on.
  const piId =
    typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id
  if (piId) {
    const subSnap = await subRef.get()
    const s = subSnap.data()
    await memberPaymentRef(team.teamId, piId).set(
      {
        ...(s?.contactId ? { contactId: s.contactId } : {}),
        kind: 'membership',
        subscriptionTypeName: (s?.subscriptionTypeName as string | undefined) ?? null,
        purpose: 'membership',
        ...(s?.subscriptionTypeId
          ? {
              line_item: {
                kind: 'subscription',
                subscriptionTypeId: s.subscriptionTypeId,
                priceId: (s.priceId as string | undefined) ?? null,
                label: (s.subscriptionTypeName as string | undefined) ?? null,
              },
            }
          : {}),
      },
      { merge: true }
    )
    if (s?.contactId) await stampFinanceContact(team.teamId, piId, s.contactId as string)
  }
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

  // Prefer the explicit contactId (login-first shop + manager flow); else
  // resolve/create by email (legacy anonymous sessions).
  let contactId: string | null = await verifiedMetadataContact(team.teamId, md)
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
  await confirmProvisionalContact(contactId)

  // 'full' checkout mode: the buyer owes the FULL signup (profile + consent) after
  // paying. Under login-first the contact already exists at purchase time, so the
  // creation-time flag in resolveOrCreateContact never fires — flag it here instead.
  // Never re-flag someone who already completed the full signup.
  if (md.contactMode === 'full') {
    const pendingSnap = await admin.firestore().collection(CONTACTS_COLLECTION).doc(contactId).get()
    const pc = pendingSnap.data()
    if (pendingSnap.exists && !pc?.signup_completed_at && pc?.pending_signup !== true) {
      await pendingSnap.ref.update({ pending_signup: true, signup_completed_at: null })
      console.log(`[connect] flagged contact ${contactId} as pending signup ('full' checkout)`)
    }
  }

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

    // Link + label the FIRST charge: the invoice-generated PaymentIntent carries no
    // metadata of its own, so handlePaymentIntent recorded it as a bare 'payment'
    // with no contact. Renewal invoices are stamped by handleInvoice.
    if (latestPaymentIntentId) {
      await stampFinanceContact(team.teamId, latestPaymentIntentId, contactId)
      await memberPaymentRef(team.teamId, latestPaymentIntentId).set(
        {
          contactId,
          kind: 'membership',
          subscriptionTypeName: md.subscriptionTypeName ?? null,
          purpose: 'membership',
          ...(lineItemFromMetadata({ ...md, kind: 'membership' })
            ? { line_item: lineItemFromMetadata({ ...md, kind: 'membership' }) }
            : {}),
        },
        { merge: true }
      )
    }
  } else {
    const months = md.includedMonths ? parseInt(md.includedMonths, 10) : 0
    membershipExpiration = months > 0 ? addMonths(months) : null
    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id
    if (piId) {
      await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })
      await stampFinanceContact(team.teamId, piId, contactId)
      // Credit pack purchase → materialise the grant (idempotent vs the
      // payment_intent.succeeded sibling event; doc id = piId).
      await applyCreditGrant(team.teamId, contactId, md, piId)
    }
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
  // Login-first checkouts carry the buyer's exact contact in metadata (e.g. the
  // child a parent selected at sign-in) — prefer it over email matching, which
  // would land on the wrong family member. Email resolution stays as the safety
  // net for in-flight legacy (anonymous) sessions.
  let contactId = await verifiedMetadataContact(team.teamId, md)
  if (!contactId) {
    const email = (session.customer_details?.email ?? session.customer_email ?? '')
      .toLowerCase()
      .trim()
    if (!email) return // nothing to link the sale to; payment is still recorded

    const name = (session.customer_details?.name as string | undefined) ?? null
    const phone = (session.customer_details?.phone as string | undefined) ?? null

    const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(team.teamId).get()
    const plan = (teamSnap.data()?.plan as SaasPlan | undefined) ?? 'free'
    contactId = await resolveOrCreateContact(team.teamId, plan, { email, name, phone })
    if (!contactId) return // cap-blocked — payment still recorded, studio links it later
  }
  await confirmProvisionalContact(contactId)

  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
  if (piId) {
    await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })
    await stampFinanceContact(team.teamId, piId, contactId)
  }

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
  // Login-first: grant the entitlement to the EXACT contact from metadata (the one
  // the buyer was signed in as); email matching only for legacy sessions.
  let contactId = await verifiedMetadataContact(team.teamId, md)
  if (!contactId) {
    const email = (session.customer_details?.email ?? session.customer_email ?? '')
      .toLowerCase()
      .trim()
    if (!email) return // nothing to grant the entitlement to; payment is still recorded

    const name = (session.customer_details?.name as string | undefined) ?? null
    const phone = (session.customer_details?.phone as string | undefined) ?? null

    const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(team.teamId).get()
    const plan = (teamSnap.data()?.plan as SaasPlan | undefined) ?? 'free'
    contactId = await resolveOrCreateContact(team.teamId, plan, { email, name, phone })
    if (!contactId) return // cap-blocked — payment still recorded, studio links it later
  }
  await confirmProvisionalContact(contactId)

  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
  if (piId) {
    await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })
    await stampFinanceContact(team.teamId, piId, contactId)
  }

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
  // A paid drop-in also confirms a provisional (shop-registered) contact.
  if (contact.provisional === true) {
    await cSnap.ref.update({
      provisional: FieldValue.delete(),
      provisional_expires_at: FieldValue.delete(),
    })
  }

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

  if (piId) {
    await memberPaymentRef(team.teamId, piId).set({ contactId }, { merge: true })
    await stampFinanceContact(team.teamId, piId, contactId)
  }

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
          await handlePaymentIntent(team, obj, 'succeeded', event.id, accountId)
          break
        case 'payment_intent.payment_failed':
          await handlePaymentIntent(team, obj, 'failed', event.id, accountId)
          break
        case 'charge.refunded':
          await handleChargeRefunded(team, obj, event.id, accountId)
          break
        case 'charge.updated':
          await handleChargeUpdated(team, obj, accountId)
          break
        case 'charge.dispute.created':
          await handleDispute(team, obj, 'created', event.id)
          break
        case 'charge.dispute.closed':
          await handleDispute(team, obj, 'closed', event.id)
          break
        case 'payout.paid':
          await handlePayout(team, obj, 'paid', accountId!, event.id)
          break
        case 'payout.failed':
          await handlePayout(team, obj, 'failed', accountId!, event.id)
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
