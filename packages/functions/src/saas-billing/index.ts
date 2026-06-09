/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { getSecret } from '../utils/secrets'
import { hasTeamRole } from '../utils/teams'
import { getHostingUrl } from '../utils/env'
import { StripeAdapter } from '../utils/gateway/stripe'
import type { SaasPlan } from '@linyup/shared'
import {
  PLUGIN_ADDONS,
  pluginIdForAddonLookupKey,
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
} from '@linyup/shared'


const VALID_PLANS: SaasPlan[] = ['coach', 'club', 'organization']

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a StripeAdapter using Linyup's platform Stripe secret key.
 * SaaS billing always uses Linyup's own Stripe account — never a team-level
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

/** Stripe lookup keys for a team's currently-active add-on plugins (carried
 * into checkout so trial add-ons keep working once the coach pays). */
async function activeAddonLookupKeys(teamId: string): Promise<string[]> {
  const snap = await admin.firestore()
    .collection(TEAMS_COLLECTION).doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
    .where('status', '==', 'active')
    .get()
  const keys: string[] = []
  for (const d of snap.docs) {
    const addon = PLUGIN_ADDONS[d.id]
    if (addon) keys.push(addon.stripeLookupKey)
  }
  return keys
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
  const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000)
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

  // Coach carries any active (trial) add-ons into the paid subscription; Club/Org
  // include all plugins, so no add-on line items are needed for them.
  const addonLookupKeys = plan === 'coach' ? await activeAddonLookupKeys(teamId) : []

  let session: { url: string; sessionId: string }
  try {
    session = await adapter.createCheckoutSession({
      teamId,
      plan,
      customerEmail,
      successUrl: `${hostingUrl}/${locale}/billing?checkout=success`,
      cancelUrl: `${hostingUrl}/${locale}/billing?checkout=cancelled`,
      idempotencyKey,
      addonLookupKeys,
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
    created_at: FieldValue.serverTimestamp(),
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

    // Either teamId or orgId must be present in the event metadata to route the update
    const entityId = event.teamId ?? event.orgId
    const entityType = event.orgId ? 'org' : 'team'
    if (!entityId) {
      console.log(`Webhook event ${event.eventId} has no teamId or orgId — skipping`)
      res.status(200).send('ok')
      return
    }

    const subRef = admin.firestore().collection('saas_subscriptions').doc(entityId)

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

      const now = FieldValue.serverTimestamp()

      // Add-on subscription items present on this subscription (Coach plugins).
      const addonActive = (event.items ?? [])
        .map((it) => ({
          itemId: it.itemId,
          pluginId: it.lookupKey ? pluginIdForAddonLookupKey(it.lookupKey) : undefined,
        }))
        .filter((x): x is { itemId: string; pluginId: string } => !!x.pluginId)

      // Map event to saas_subscriptions fields
      const update: Record<string, unknown> = {
        entity_type: entityType,
        entity_id: entityId,
        teamId: entityId, // kept for backwards compatibility
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
          if (event.currentPeriodStart) update.current_period_start = Timestamp.fromDate(event.currentPeriodStart)
          if (event.currentPeriodEnd) update.current_period_end = Timestamp.fromDate(event.currentPeriodEnd)
          update.cancel_at_period_end = false
          update.trial_ends_at = null
          update['gateway_data.activeAddOns'] = addonActive
          if (!existing.exists) {
            update.created_at = now
          }
          break

        case 'subscription.updated':
          if (event.plan) update.plan = event.plan
          if (event.currentPeriodStart) update.current_period_start = Timestamp.fromDate(event.currentPeriodStart)
          if (event.currentPeriodEnd) update.current_period_end = Timestamp.fromDate(event.currentPeriodEnd)
          if (event.cancelAtPeriodEnd !== undefined) update.cancel_at_period_end = event.cancelAtPeriodEnd
          if (event.subscriptionId) update['gateway_data.subscription_id'] = event.subscriptionId
          if (event.customerId) update['gateway_data.customer_id'] = event.customerId
          update['gateway_data.activeAddOns'] = addonActive
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

      // Sync plan + status to the owning entity so usePlan() / useOrg() stays accurate
      const entityUpdate: Record<string, unknown> = { updated_at: now }
      if (update.plan) entityUpdate.plan = update.plan
      if (update.status) entityUpdate.plan_status = update.status

      if (entityType === 'org') {
        await admin.firestore().collection('organizations').doc(entityId).update(entityUpdate)
        // When org subscription lapses, propagate to linked teams
        if (update.status === 'cancelled' || update.status === 'past_due') {
          const orgTeamsSnap = await admin.firestore()
            .collection('organizations').doc(entityId)
            .collection('org_teams')
            .where('status', '==', 'active')
            .get()
          const batch = admin.firestore().batch()
          for (const doc of orgTeamsSnap.docs) {
            batch.update(admin.firestore().collection('teams').doc(doc.id), {
              plan_status: update.status,
              updated_at: now,
            })
          }
          await batch.commit()
        }
      } else {
        await admin.firestore().collection('teams').doc(entityId).update(entityUpdate)
      }

      // Reconcile plugin add-on installs against the subscription's items.
      // Handles trial→paid conversion (carried add-ons become paid items) and
      // external removals. Only touches paid add-on installs (config.addonItemId).
      if (entityType === 'team' && (event.type === 'subscription.created' || event.type === 'subscription.updated')) {
        const installsCol = admin.firestore()
          .collection(TEAMS_COLLECTION).doc(entityId)
          .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
        const activeIds = new Set(addonActive.map((a) => a.pluginId))
        for (const a of addonActive) {
          await installsCol.doc(a.pluginId).set(
            { pluginId: a.pluginId, teamId: entityId, status: 'active', config: { addonItemId: a.itemId }, updated_at: now },
            { merge: true },
          )
        }
        const installsSnap = await installsCol.get()
        for (const d of installsSnap.docs) {
          const cfg = (d.data().config ?? {}) as { addonItemId?: string }
          if (cfg.addonItemId && !activeIds.has(d.id)) {
            await installsCol.doc(d.id).delete()
          }
        }
      }

      console.log(`Processed webhook ${event.type} (${event.eventId}) for ${entityType} ${entityId}`)
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
    updated_at: FieldValue.serverTimestamp(),
  })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// reactivateSaasSubscription — removes cancel_at_period_end flag
// ─────────────────────────────────────────────────────────────────────────────

export const reactivateSaasSubscription = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  await assertOwner(request.auth.uid, data.teamId)

  const subDoc = await admin.firestore().collection('saas_subscriptions').doc(data.teamId).get()
  if (!subDoc.exists) throw new HttpsError('not-found', 'No subscription found')

  const subData = subDoc.data()!
  const subscriptionId = subData.gateway_data?.subscription_id as string | undefined
  if (!subscriptionId) throw new HttpsError('failed-precondition', 'Subscription ID not found — contact support')

  const adapter = await getPlatformStripeAdapter()

  try {
    await adapter.reactivateSubscription({ subscriptionId })
  } catch (err) {
    console.error('reactivateSubscription failed:', err)
    throw new HttpsError('internal', 'Failed to reactivate subscription')
  }

  await admin.firestore().collection('saas_subscriptions').doc(data.teamId).update({
    cancel_at_period_end: false,
    updated_at: FieldValue.serverTimestamp(),
  })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// getBillingPortalUrl — creates a Stripe billing portal session for payment management
// ─────────────────────────────────────────────────────────────────────────────

export const getBillingPortalUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string; returnUrl?: string }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  await assertOwner(request.auth.uid, data.teamId)

  const subDoc = await admin.firestore().collection('saas_subscriptions').doc(data.teamId).get()
  if (!subDoc.exists) throw new HttpsError('not-found', 'No subscription found')

  const customerId = subDoc.data()?.gateway_data?.customer_id as string | undefined
  if (!customerId) throw new HttpsError('failed-precondition', 'No Stripe customer found — contact support')

  const adapter = await getPlatformStripeAdapter()
  const hostingUrl = getHostingUrl()
  const returnUrl = data.returnUrl ?? `${hostingUrl}/billing`

  let session: { url: string }
  try {
    session = await adapter.createBillingPortalSession({ customerId, returnUrl })
  } catch (err) {
    console.error('createBillingPortalSession failed:', err)
    throw new HttpsError('internal', 'Failed to open billing portal')
  }

  if (!session.url.startsWith('https://billing.stripe.com/')) {
    throw new HttpsError('internal', 'Unexpected billing portal URL')
  }

  return { url: session.url }
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

// ─────────────────────────────────────────────────────────────────────────────
// activatePluginAddon — Coach activates a paid add-on plugin
//   • paid coach → adds a Stripe subscription item + writes the install
//   • trialing / no subscription → writes the install free (exploration)
// Club/Org include all plugins and install client-side, not via this function.
// ─────────────────────────────────────────────────────────────────────────────

export const activatePluginAddon = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string; pluginId?: string }
  if (!data?.teamId || !data?.pluginId) {
    throw new HttpsError('invalid-argument', 'teamId and pluginId are required')
  }
  const { teamId, pluginId } = data

  const addon = PLUGIN_ADDONS[pluginId]
  if (!addon) throw new HttpsError('invalid-argument', `${pluginId} is not an add-on plugin`)

  await assertOwner(request.auth.uid, teamId)

  const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(teamId).get()
  const plan = teamSnap.data()?.plan as SaasPlan | undefined
  if (plan !== 'coach') {
    throw new HttpsError('failed-precondition', 'Add-ons apply to the Coach plan; Club/Org include all plugins')
  }

  const installRef = admin.firestore()
    .collection(TEAMS_COLLECTION).doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION).doc(pluginId)

  const subSnap = await admin.firestore().collection('saas_subscriptions').doc(teamId).get()
  const sub = subSnap.exists ? subSnap.data()! : null
  const subscriptionId = sub?.gateway_data?.subscription_id as string | undefined
  const status = sub?.status as string | undefined
  const isPaid = !!subscriptionId && (status === 'active' || status === 'past_due')

  if (isPaid) {
    const adapter = await getPlatformStripeAdapter()
    let itemId: string
    try {
      const res = await adapter.addSubscriptionItem({ subscriptionId: subscriptionId!, lookupKey: addon.stripeLookupKey })
      itemId = res.itemId
    } catch (err) {
      console.error('addSubscriptionItem failed:', err)
      throw new HttpsError('internal', 'Failed to add the add-on to your subscription')
    }
    const current = ((sub?.gateway_data?.activeAddOns ?? []) as Array<{ pluginId: string; itemId: string }>)
      .filter((a) => a.pluginId !== pluginId)
    await admin.firestore().collection('saas_subscriptions').doc(teamId).set(
      { gateway_data: { activeAddOns: [...current, { pluginId, itemId }] }, updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    )
    await installRef.set(
      { pluginId, teamId, installedAt: FieldValue.serverTimestamp(), installedBy: request.auth.uid, status: 'active', config: { addonItemId: itemId } },
      { merge: true },
    )
    return { success: true, billed: true }
  }

  // Trial / no subscription → free during the trial.
  await installRef.set(
    { pluginId, teamId, installedAt: FieldValue.serverTimestamp(), installedBy: request.auth.uid, status: 'active', config: { addonFreeTrial: true } },
    { merge: true },
  )
  return { success: true, billed: false }
})

// ─────────────────────────────────────────────────────────────────────────────
// deactivatePluginAddon — removes the add-on (and its Stripe item if billed)
// ─────────────────────────────────────────────────────────────────────────────

export const deactivatePluginAddon = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string; pluginId?: string }
  if (!data?.teamId || !data?.pluginId) {
    throw new HttpsError('invalid-argument', 'teamId and pluginId are required')
  }
  const { teamId, pluginId } = data

  await assertOwner(request.auth.uid, teamId)

  const installRef = admin.firestore()
    .collection(TEAMS_COLLECTION).doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION).doc(pluginId)
  const installSnap = await installRef.get()
  if (!installSnap.exists) return { success: true }

  const itemId = (installSnap.data()?.config as { addonItemId?: string } | undefined)?.addonItemId

  if (itemId) {
    const adapter = await getPlatformStripeAdapter()
    try {
      await adapter.removeSubscriptionItem({ itemId })
    } catch (err) {
      console.error('removeSubscriptionItem failed:', err)
      throw new HttpsError('internal', 'Failed to remove the add-on from your subscription')
    }
    const subSnap = await admin.firestore().collection('saas_subscriptions').doc(teamId).get()
    const current = ((subSnap.data()?.gateway_data?.activeAddOns ?? []) as Array<{ pluginId: string; itemId: string }>)
      .filter((a) => a.pluginId !== pluginId)
    await admin.firestore().collection('saas_subscriptions').doc(teamId).set(
      { gateway_data: { activeAddOns: current }, updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    )
  }

  await installRef.delete()
  return { success: true }
})
