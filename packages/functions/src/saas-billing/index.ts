/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { getSecret } from '../utils/secrets'
import { hasTeamRole } from '../utils/teams'
import { getHostingUrl } from '../utils/env'
import { StripeAdapter } from '../utils/gateway/stripe'
import type { SaasPlan } from '@lineup/shared'

setGlobalOptions({ region: 'europe-west6' })

const VALID_PLANS: SaasPlan[] = ['coach', 'club', 'organization']

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a StripeAdapter using Lineup's platform Stripe secret key.
 * SaaS billing always uses Lineup's own Stripe account — never a team-level
 * payment gateway integration (those are for teams charging their own clients).
 */
async function getPlatformStripeAdapter(): Promise<StripeAdapter> {
  const secretKey = await getSecret('stripe-secret-key')
  return StripeAdapter.withSecretKey(
    { type: 'stripe', publishable_key: '', currency: 'chf' },
    secretKey,
  )
}

async function assertOwner(uid: string, teamId: string): Promise<void> {
  const isOwner = await hasTeamRole(uid, teamId, 'owner')
  if (!isOwner) throw new HttpsError('permission-denied', 'Owner access required')
}

// ─────────────────────────────────────────────────────────────────────────────
// createCheckoutSession — redirects team owner to hosted payment page
// ─────────────────────────────────────────────────────────────────────────────

export const createCheckoutSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string; plan?: string; locale?: string }
  if (!data?.teamId || !data?.plan) {
    throw new HttpsError('invalid-argument', 'teamId and plan are required')
  }
  if (!VALID_PLANS.includes(data.plan as SaasPlan)) {
    throw new HttpsError('invalid-argument', `Invalid plan: ${data.plan}`)
  }

  const { teamId, plan, locale = 'en' } = data as { teamId: string; plan: SaasPlan; locale: string }

  await assertOwner(request.auth.uid, teamId)

  // Rate limit: max 3 checkout session requests per team per hour
  const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000)
  const recentAttempts = await admin.firestore()
    .collection('saas_checkout_attempts')
    .where('teamId', '==', teamId)
    .where('created_at', '>', oneHourAgo)
    .get()
  if (recentAttempts.size >= 3) {
    throw new HttpsError('resource-exhausted', 'Too many checkout requests. Please try again in an hour.')
  }

  // Get owner email for pre-filling checkout
  const ownerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get()
  const customerEmail: string = ownerDoc.exists ? (ownerDoc.data()!.email ?? '') : ''

  const adapter = await getPlatformStripeAdapter()

  const hostingUrl = getHostingUrl()
  const idempotencyKey = `checkout:${teamId}:${plan}:${Math.floor(Date.now() / 60000)}` // 1-minute window

  let session: { url: string; sessionId: string }
  try {
    session = await adapter.createCheckoutSession({
      teamId,
      plan,
      customerEmail,
      successUrl: `${hostingUrl}/${locale}/billing?checkout=success`,
      cancelUrl: `${hostingUrl}/${locale}/billing?checkout=cancelled`,
      idempotencyKey,
    })
  } catch (err) {
    console.error('Checkout session creation failed:', err)
    throw new HttpsError('internal', 'Failed to create checkout session')
  }

  // Log attempt for rate limiting (non-blocking)
  admin.firestore().collection('saas_checkout_attempts').add({
    teamId,
    plan,
    sessionId: session.sessionId,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.error('Failed to log checkout attempt:', err))

  return { url: session.url }
})

// ─────────────────────────────────────────────────────────────────────────────
// handleStripeWebhook — onRequest: validates signature, syncs saas_subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export const handleStripeWebhook = onRequest(
  { invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed')
      return
    }

    const signature = req.headers['stripe-signature']
    if (!signature || typeof signature !== 'string') {
      console.error('Missing stripe-signature header')
      res.status(400).send('Missing stripe-signature header')
      return
    }

    let webhookSecret: string
    try {
      webhookSecret = await getSecret('stripe-webhook-secret')
    } catch (err) {
      console.error('Failed to load stripe-webhook-secret:', err)
      res.status(500).send('Internal error')
      return
    }

    const adapter = await getPlatformStripeAdapter()

    let event: Awaited<ReturnType<typeof adapter.parseWebhook>>
    try {
      event = await adapter.parseWebhook({
        payload: req.rawBody ?? req.body,
        signature,
        secret: webhookSecret,
      })
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      res.status(400).send('Invalid webhook signature')
      return
    }

    // teamId must be present in the event metadata to route the update
    if (!event.teamId) {
      console.log(`Webhook event ${event.eventId} has no teamId — skipping`)
      res.status(200).send('ok')
      return
    }

    const subRef = admin.firestore().collection('saas_subscriptions').doc(event.teamId)

    try {
      // Idempotency check
      const existing = await subRef.get()
      if (existing.exists) {
        const lastEventId = existing.data()?.gateway_data?.last_event_id
        if (lastEventId === event.eventId) {
          console.log(`Webhook event ${event.eventId} already processed — skipping`)
          res.status(200).send('ok')
          return
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp()

      // Map event to saas_subscriptions fields
      const update: Record<string, unknown> = {
        teamId: event.teamId,
        updated_at: now,
        'gateway_data.last_event_id': event.eventId,
        gateway_type: 'stripe',
      }

      switch (event.type) {
        case 'subscription.created':
          update.status = 'active'
          update['gateway_data.subscription_id'] = event.subscriptionId
          update['gateway_data.customer_id'] = event.customerId
          if (event.plan) update.plan = event.plan
          if (event.currentPeriodStart) update.current_period_start = admin.firestore.Timestamp.fromDate(event.currentPeriodStart)
          if (event.currentPeriodEnd) update.current_period_end = admin.firestore.Timestamp.fromDate(event.currentPeriodEnd)
          update.cancel_at_period_end = false
          update.trial_ends_at = null
          if (!existing.exists) {
            update.created_at = now
          }
          break

        case 'subscription.updated':
          if (event.plan) update.plan = event.plan
          if (event.currentPeriodStart) update.current_period_start = admin.firestore.Timestamp.fromDate(event.currentPeriodStart)
          if (event.currentPeriodEnd) update.current_period_end = admin.firestore.Timestamp.fromDate(event.currentPeriodEnd)
          if (event.cancelAtPeriodEnd !== undefined) update.cancel_at_period_end = event.cancelAtPeriodEnd
          if (event.subscriptionId) update['gateway_data.subscription_id'] = event.subscriptionId
          if (event.customerId) update['gateway_data.customer_id'] = event.customerId
          break

        case 'subscription.cancelled':
          update.status = 'cancelled'
          update.cancel_at_period_end = false
          break

        case 'payment.succeeded':
          update.status = 'active'
          update['gateway_data.last_invoice_id'] = event.lastInvoiceId
          update['gateway_data.last_payment_status'] = 'succeeded'
          break

        case 'payment.failed':
          update.status = 'past_due'
          update['gateway_data.last_invoice_id'] = event.lastInvoiceId
          update['gateway_data.last_payment_status'] = 'failed'
          break
      }

      await subRef.set(update, { merge: true })

      // Also sync plan + status onto the team doc so usePlan() stays accurate
      const teamUpdate: Record<string, unknown> = { updated_at: now }
      if (update.plan) teamUpdate.plan = update.plan
      if (update.status) teamUpdate.plan_status = update.status
      await admin.firestore().collection('teams').doc(event.teamId).update(teamUpdate)

      console.log(`Processed webhook ${event.type} (${event.eventId}) for team ${event.teamId}`)
    } catch (err) {
      // Log but always return 200 so Stripe doesn't retry forever
      console.error(`Failed to process webhook event ${event.eventId}:`, err)
    }

    res.status(200).send('ok')
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// cancelSaasSubscription — marks subscription to cancel at period end
// ─────────────────────────────────────────────────────────────────────────────

export const cancelSaasSubscription = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  await assertOwner(request.auth.uid, data.teamId)

  const subDoc = await admin.firestore().collection('saas_subscriptions').doc(data.teamId).get()
  if (!subDoc.exists) throw new HttpsError('not-found', 'No active subscription found')

  const subData = subDoc.data()!
  const subscriptionId = subData.gateway_data?.subscription_id as string | undefined
  if (!subscriptionId) throw new HttpsError('failed-precondition', 'Subscription ID not found — contact support')

  const adapter = await getPlatformStripeAdapter()

  try {
    await adapter.cancelSubscription({ subscriptionId })
  } catch (err) {
    console.error('cancelSubscription failed:', err)
    throw new HttpsError('internal', 'Failed to cancel subscription')
  }

  // Webhook will update cancel_at_period_end when Stripe fires the event.
  // Optimistically set it here so the UI updates immediately.
  await admin.firestore().collection('saas_subscriptions').doc(data.teamId).update({
    cancel_at_period_end: true,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// getSaasInvoices — fetches invoice list live from Stripe (not stored in Firestore)
// ─────────────────────────────────────────────────────────────────────────────

export const getSaasInvoices = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string; limit?: number }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  await assertOwner(request.auth.uid, data.teamId)

  const subDoc = await admin.firestore().collection('saas_subscriptions').doc(data.teamId).get()
  if (!subDoc.exists) return { invoices: [] }

  const customerId = subDoc.data()?.gateway_data?.customer_id as string | undefined
  if (!customerId) return { invoices: [] }

  const adapter = await getPlatformStripeAdapter()

  try {
    const invoices = await adapter.fetchInvoices({ customerId, limit: data.limit ?? 10 })
    return { invoices }
  } catch (err) {
    console.error('getSaasInvoices failed:', err)
    throw new HttpsError('internal', 'Failed to fetch invoices')
  }
})
