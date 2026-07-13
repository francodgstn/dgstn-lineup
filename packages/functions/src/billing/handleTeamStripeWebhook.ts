/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
// handleTeamStripeWebhook — BYO Stripe gateway: a studio charging its students on
// the studio's OWN Stripe account (no platform fee; money never touches Linyup).
//
// This is the BYO sibling of handlePayrexxWebhook, and is DISTINCT from:
//   • handleStripeWebhook  — Linyup's own SaaS billing (saas-billing/)
//   • handleConnectWebhook — Stripe Connect (member → studio + platform fee)
//
// BYO is deliberately MINIMAL: we only RECORD the payment as an ExternalPayment
// and (when uniquely matched) link it to a contact. Linyup holds NO Stripe
// credentials and makes NO Stripe API calls — the webhook signing secret (stored
// per-team in Firestore, owners only) is all that's needed to verify the signature.
//
// URL: POST /handleTeamStripeWebhook?teamId={teamId}
// Signature: Stripe-Signature header, verified with the team's webhook_signing_secret.
// Idempotency: payment_events/stripe:{paymentRef} written create-or-skip, so a
//   webhook redelivery — or a manager's later reassignment — is never clobbered.

import { onRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { to } from '../utils/async'
import { resolveSingleContact } from '../utils/contacts'
import {
  TEAMS_COLLECTION,
  CONTACTS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  PAYMENT_EVENTS_SUBCOLLECTION,
  buildExternalPaymentTxn,
} from '@linyup/shared'
import type { StripeGatewayConfig } from '@linyup/shared'
import { recordFinanceTransaction } from '../finance/journal'

// Stripe SDK instance used ONLY for webhook signature verification. Verification
// is pure crypto (HMAC of the raw body against the signing secret) — no API key is
// needed for constructEventAsync, so a placeholder satisfies the constructor and
// we never call the Stripe API from the BYO rail.
const stripe = new Stripe('sk_byo_webhook_verification_only')

interface ExtractedPayment {
  /** Stable per-payment reference (PaymentIntent / invoice / session id). */
  ref: string
  email: string | null
  amount: number | null // minor units (Rappen/cents)
  currency: string
  subscriptionTypeId: string | null
}

/**
 * Pull the bits we record from the supported success events. We key on the
 * underlying PAYMENT (not the event id) so checkout.session.completed and the
 * matching payment_intent.succeeded converge to one ExternalPayment doc.
 */
function extractPayment(
  eventType: string,
  obj: any,
  fallbackSubTypeId: string | null
): ExtractedPayment | null {
  const md = (obj.metadata ?? {}) as Record<string, string>
  const subscriptionTypeId =
    (md.subscriptionTypeId && md.subscriptionTypeId.trim()) || fallbackSubTypeId || null

  switch (eventType) {
    case 'checkout.session.completed': {
      if (obj.payment_status && obj.payment_status !== 'paid') return null
      const ref =
        (typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id) ??
        obj.id
      const email = (obj.customer_details?.email ?? obj.customer_email ?? null) as string | null
      return { ref, email, amount: obj.amount_total ?? null, currency: obj.currency ?? 'chf', subscriptionTypeId }
    }
    case 'payment_intent.succeeded': {
      const email = (obj.receipt_email ??
        obj.charges?.data?.[0]?.billing_details?.email ??
        null) as string | null
      return {
        ref: obj.id,
        email,
        amount: obj.amount_received ?? obj.amount ?? null,
        currency: obj.currency ?? 'chf',
        subscriptionTypeId,
      }
    }
    case 'invoice.payment_succeeded': {
      const email = (obj.customer_email ?? null) as string | null
      const ref =
        (typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id) ??
        obj.id
      return { ref, email, amount: obj.amount_paid ?? null, currency: obj.currency ?? 'chf', subscriptionTypeId }
    }
    default:
      return null
  }
}

export const handleTeamStripeWebhook = onRequest({ invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' })
    return
  }

  // ── 1. Identify team ────────────────────────────────────────────────────────
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : null
  if (!teamId) {
    res.status(400).json({ ok: false, reason: 'missing_team_id' })
    return
  }

  const db = admin.firestore()

  // ── 2. Load the team's BYO Stripe integration (Admin SDK) ────────────────────
  const [intErr, intSnap] = await to(
    db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection('integrations')
      .where('type', '==', 'payment_gateway')
      .where('config.type', '==', 'stripe')
      .limit(1)
      .get()
  )
  if (intErr || !intSnap || intSnap.empty) {
    // 200 so Stripe stops retrying for a misconfigured team.
    res.status(200).json({ ok: false, reason: 'no_integration' })
    return
  }
  const cfg = intSnap.docs[0].data().config as StripeGatewayConfig
  const signingSecret = cfg.webhook_signing_secret ?? ''

  // ── 3. Verify signature ──────────────────────────────────────────────────────
  const sig = req.headers['stripe-signature']
  if (!sig || typeof sig !== 'string') {
    res.status(401).json({ ok: false, reason: 'missing_signature' })
    return
  }
  if (!signingSecret) {
    console.warn(`[handleTeamStripeWebhook] No signing secret configured for team=${teamId}`)
    res.status(400).json({ ok: false, reason: 'no_signing_secret' })
    return
  }

  let event: any
  try {
    const rawBody: Buffer =
      (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body))
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, signingSecret)
  } catch (err) {
    console.warn(
      `[handleTeamStripeWebhook] signature verification failed team=${teamId}:`,
      (err as Error).message
    )
    res.status(400).json({ ok: false, reason: 'invalid_signature' })
    return
  }

  // ── 4. Record the payment (always 200 past this point) ───────────────────────
  try {
    const obj = event.data?.object ?? {}
    const extracted = extractPayment(event.type, obj, cfg.default_subscription_type_id ?? null)
    if (!extracted || !extracted.ref || !extracted.amount || extracted.amount <= 0) {
      res.status(200).json({ ok: true, ignored: event.type })
      return
    }

    // Default "what was paid" suggestion: the subscription-type name when mapped,
    // else a generic Stripe label. A manager can edit it via updatePaymentRecord.
    let comment = 'Stripe payment'
    if (extracted.subscriptionTypeId) {
      const [, typeSnap] = await to(
        db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(SUBSCRIPTION_TYPES_SUBCOLLECTION)
          .doc(extracted.subscriptionTypeId)
          .get()
      )
      const name = typeSnap?.exists ? (typeSnap.data()?.name as string | undefined) : undefined
      if (name) comment = name
    }

    // Match the contact (UNIQUE active email match only); none/ambiguous → unassigned.
    const { contactId } = await resolveSingleContact(teamId, extracted.email)
    const assignmentStatus = contactId ? 'assigned' : 'unassigned'

    const eventRef = db.doc(
      `${TEAMS_COLLECTION}/${teamId}/${PAYMENT_EVENTS_SUBCOLLECTION}/stripe:${extracted.ref}`
    )

    const [txErr] = await to(
      db.runTransaction(async (tx) => {
        const existing = await tx.get(eventRef)
        if (existing.exists) throw new Error('already_processed')
        tx.set(eventRef, {
          gateway: 'stripe',
          gatewayRef: extracted.ref,
          contact_id: contactId,
          assignment_status: assignmentStatus,
          email: extracted.email,
          amount: extracted.amount,
          currency: extracted.currency,
          subscription_type_id: extracted.subscriptionTypeId,
          // Structured link — a manager can enrich it (course/product/price) on assign.
          line_item: extracted.subscriptionTypeId
            ? { kind: 'subscription', subscriptionTypeId: extracted.subscriptionTypeId, label: comment }
            : null,
          membership_expiration: null,
          comment,
          raw_status: event.type,
          processed_at: FieldValue.serverTimestamp(),
        })
        if (contactId) {
          const update: Record<string, unknown> = { last_payment_at: FieldValue.serverTimestamp() }
          if (extracted.subscriptionTypeId) update.subscription_type_id = extracted.subscriptionTypeId
          tx.update(db.collection(CONTACTS_COLLECTION).doc(contactId), update)
        }
      })
    )

    if (txErr) {
      if ((txErr as Error).message === 'already_processed') {
        res.status(200).json({ ok: true, contact_id: contactId, duplicate: true })
        return
      }
      console.error(`[handleTeamStripeWebhook] tx failed team=${teamId}:`, txErr)
      res.status(200).json({ ok: false, reason: 'processing_error' })
      return
    }

    // Activity log on first record (assigned only).
    if (contactId) {
      await to(
        db
          .collection(CONTACTS_COLLECTION)
          .doc(contactId)
          .collection('activity_log')
          .add({
            type: 'payment_received',
            source: 'stripe',
            message: 'Payment confirmed via Stripe',
            timestamp: FieldValue.serverTimestamp(),
          })
      )
    }

    console.log(
      `[handleTeamStripeWebhook] team=${teamId} ref=${extracted.ref} ${assignmentStatus}` +
        (contactId ? ` contact=${contactId}` : ` email=${extracted.email ?? 'none'}`)
    )

    // Finance journal (core infrastructure, best-effort — a failure never breaks
    // payment recording; the backfill reconciles). BYO rails are fee-blind.
    try {
      await recordFinanceTransaction(
        buildExternalPaymentTxn({
          teamId,
          gateway: 'stripe',
          gatewayRef: extracted.ref,
          amount: extracted.amount,
          currency: extracted.currency,
          contactId,
          lineItemKind: extracted.subscriptionTypeId ? 'subscription' : null,
          description: comment,
          occurredAtMs: typeof obj.created === 'number' ? obj.created * 1000 : Date.now(),
          eventId: event.id as string | undefined,
        })
      )
    } catch (err) {
      console.error(`[handleTeamStripeWebhook] finance journal write failed team=${teamId}:`, err)
    }
    res.status(200).json({ ok: true, contact_id: contactId, assignment_status: assignmentStatus })
  } catch (err) {
    console.error(`[handleTeamStripeWebhook] processing error team=${teamId}:`, err)
    res.status(200).json({ ok: false, reason: 'processing_error' })
  }
})
