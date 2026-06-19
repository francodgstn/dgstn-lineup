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
  MEMBER_PAYMENTS_SUBCOLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type ConnectOnboardingModel,
} from '@linyup/shared'
import { getSecret } from '../utils/secrets'
import { constructConnectWebhookEvent, retrieveAccountStatus } from '../utils/connect/client'
import { persistAccountStatus } from './access'

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
      amount: item?.price?.unit_amount ?? 0,
      currency: sub.currency ?? 'chf',
      application_fee_percent: sub.application_fee_percent ?? null,
      status: sub.status ?? 'incomplete',
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
