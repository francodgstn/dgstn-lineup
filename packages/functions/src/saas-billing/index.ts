/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getSecret } from '../utils/secrets'
import { hasTeamRole } from '../utils/teams'
import { getHostingUrl } from '../utils/env'
import { unpublishSiteForTeam, deleteAllCoursePublicProfiles } from '../utils/plugins'
import { StripeAdapter } from '../utils/gateway/stripe'
import type { SaasPlan } from '@linyup/shared'
import {
  PLUGIN_ADDONS,
  pluginIdForAddonLookupKey,
  TRIAL_EXTENSION_DAYS,
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  CONTACTS_COLLECTION,
  SITE_DRAFTS_COLLECTION,
  SITE_PUBLISHED_COLLECTION,
} from '@linyup/shared'
import { sendEmail, buildEmailTemplate } from '../utils/email'

const VALID_PLANS: SaasPlan[] = ['coach', 'studio', 'organization']

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
    secretKey
  )
}

async function assertOwner(uid: string, teamId: string): Promise<void> {
  const isOwner = await hasTeamRole(uid, teamId, 'owner')
  if (!isOwner) throw new HttpsError('permission-denied', 'Owner access required')
}

/** Stripe lookup keys for a team's currently-active add-on plugins (carried
 * into checkout so trial add-ons keep working once the coach pays). */
async function activeAddonLookupKeys(teamId: string): Promise<string[]> {
  const snap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
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
  const recentAttempts = await admin
    .firestore()
    .collection('saas_checkout_attempts')
    .where('teamId', '==', teamId)
    .where('created_at', '>', oneHourAgo)
    .get()
  if (recentAttempts.size >= 3) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many checkout requests. Please try again in an hour.'
    )
  }

  // Get owner email for pre-filling checkout
  const ownerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get()
  const customerEmail: string = ownerDoc.exists ? (ownerDoc.data()!.email ?? '') : ''

  const adapter = await getPlatformStripeAdapter()

  const hostingUrl = getHostingUrl()
  const idempotencyKey = `checkout:${teamId}:${plan}:${Math.floor(Date.now() / 60000)}` // 1-minute window

  // Coach carries any active (trial) add-ons into the paid subscription; Studio/Org
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
  admin
    .firestore()
    .collection('saas_checkout_attempts')
    .add({
      teamId,
      plan,
      sessionId: session.sessionId,
      created_at: FieldValue.serverTimestamp(),
    })
    .catch((err) => console.error('Failed to log checkout attempt:', err))

  return { url: session.url }
})

// ─────────────────────────────────────────────────────────────────────────────
// handleStripeWebhook — onRequest: validates signature, syncs saas_subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export const handleStripeWebhook = onRequest({ invoker: 'public' }, async (req, res) => {
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
        if (event.currentPeriodStart)
          update.current_period_start = Timestamp.fromDate(event.currentPeriodStart)
        if (event.currentPeriodEnd)
          update.current_period_end = Timestamp.fromDate(event.currentPeriodEnd)
        update.cancel_at_period_end = false
        update.trial_ends_at = null
        update['gateway_data.activeAddOns'] = addonActive
        if (!existing.exists) {
          update.created_at = now
        }
        break

      case 'subscription.updated':
        if (event.plan) update.plan = event.plan
        if (event.currentPeriodStart)
          update.current_period_start = Timestamp.fromDate(event.currentPeriodStart)
        if (event.currentPeriodEnd)
          update.current_period_end = Timestamp.fromDate(event.currentPeriodEnd)
        if (event.cancelAtPeriodEnd !== undefined)
          update.cancel_at_period_end = event.cancelAtPeriodEnd
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
    // Reactivation: paying clears any legacy wall-era suspension markers.
    if (update.status === 'active') {
      entityUpdate.suspended_at = FieldValue.delete()
      entityUpdate.purge_at = FieldValue.delete()
    }

    // A cancelled team subscription lands the team on the Free plan (the sub
    // doc keeps status 'cancelled' for billing history). Orgs keep the
    // legacy mirror + propagation below.
    if (entityType === 'team' && update.status === 'cancelled') {
      await downgradeTeamToFree(entityId, { fromTrial: false })
    } else if (entityType === 'org') {
      await admin.firestore().collection('organizations').doc(entityId).update(entityUpdate)
      // When org subscription lapses, propagate to linked teams
      if (update.status === 'cancelled' || update.status === 'past_due') {
        const orgTeamsSnap = await admin
          .firestore()
          .collection('organizations')
          .doc(entityId)
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
    if (
      entityType === 'team' &&
      (event.type === 'subscription.created' || event.type === 'subscription.updated')
    ) {
      const installsCol = admin
        .firestore()
        .collection(TEAMS_COLLECTION)
        .doc(entityId)
        .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
      const activeIds = new Set(addonActive.map((a) => a.pluginId))
      for (const a of addonActive) {
        await installsCol
          .doc(a.pluginId)
          .set(
            {
              pluginId: a.pluginId,
              teamId: entityId,
              status: 'active',
              config: { addonItemId: a.itemId },
              updated_at: now,
            },
            { merge: true }
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
})

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
  if (!subscriptionId)
    throw new HttpsError('failed-precondition', 'Subscription ID not found — contact support')

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
  if (!subscriptionId)
    throw new HttpsError('failed-precondition', 'Subscription ID not found — contact support')

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
  if (!customerId)
    throw new HttpsError('failed-precondition', 'No Stripe customer found — contact support')

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
// Studio/Org include all plugins and install client-side, not via this function.
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
    throw new HttpsError(
      'failed-precondition',
      'Add-ons apply to the Coach plan; Studio/Org include all plugins'
    )
  }

  const installRef = admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
    .doc(pluginId)

  const subSnap = await admin.firestore().collection('saas_subscriptions').doc(teamId).get()
  const sub = subSnap.exists ? subSnap.data()! : null
  const subscriptionId = sub?.gateway_data?.subscription_id as string | undefined
  const status = sub?.status as string | undefined
  const isPaid = !!subscriptionId && (status === 'active' || status === 'past_due')

  if (isPaid) {
    const adapter = await getPlatformStripeAdapter()
    let itemId: string
    try {
      const res = await adapter.addSubscriptionItem({
        subscriptionId: subscriptionId!,
        lookupKey: addon.stripeLookupKey,
      })
      itemId = res.itemId
    } catch (err) {
      console.error('addSubscriptionItem failed:', err)
      throw new HttpsError('internal', 'Failed to add the add-on to your subscription')
    }
    const current = (
      (sub?.gateway_data?.activeAddOns ?? []) as Array<{ pluginId: string; itemId: string }>
    ).filter((a) => a.pluginId !== pluginId)
    await admin
      .firestore()
      .collection('saas_subscriptions')
      .doc(teamId)
      .set(
        {
          gateway_data: { activeAddOns: [...current, { pluginId, itemId }] },
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    await installRef.set(
      {
        pluginId,
        teamId,
        installedAt: FieldValue.serverTimestamp(),
        installedBy: request.auth.uid,
        status: 'active',
        config: { addonItemId: itemId },
      },
      { merge: true }
    )
    return { success: true, billed: true }
  }

  // Trial / no subscription → free during the trial.
  await installRef.set(
    {
      pluginId,
      teamId,
      installedAt: FieldValue.serverTimestamp(),
      installedBy: request.auth.uid,
      status: 'active',
      config: { addonFreeTrial: true },
    },
    { merge: true }
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

  const installRef = admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
    .doc(pluginId)
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
    const current = (
      (subSnap.data()?.gateway_data?.activeAddOns ?? []) as Array<{
        pluginId: string
        itemId: string
      }>
    ).filter((a) => a.pluginId !== pluginId)
    await admin
      .firestore()
      .collection('saas_subscriptions')
      .doc(teamId)
      .set(
        { gateway_data: { activeAddOns: current }, updated_at: FieldValue.serverTimestamp() },
        { merge: true }
      )
  }

  await installRef.delete()
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// extendTrial — one-time self-service trial extension (+TRIAL_EXTENSION_DAYS)
// ─────────────────────────────────────────────────────────────────────────────

export const extendTrial = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  await assertOwner(request.auth.uid, data.teamId)

  const teamRef = admin.firestore().collection(TEAMS_COLLECTION).doc(data.teamId)
  const snap = await teamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Team not found')

  const team = snap.data()!
  if (team.plan_status !== 'trial') {
    throw new HttpsError('failed-precondition', 'Trial extension is only available during a trial')
  }
  if (team.trial_extended === true) {
    throw new HttpsError('failed-precondition', 'The trial has already been extended')
  }

  // Extend from the later of now / current trial end (don't shorten a future end).
  const currentEndMs = (team.trial_ends_at as Timestamp | undefined)?.toMillis() ?? Date.now()
  const base = Math.max(Date.now(), currentEndMs)
  const newEnd = Timestamp.fromMillis(base + TRIAL_EXTENSION_DAYS * 24 * 60 * 60 * 1000)

  await teamRef.update({
    trial_ends_at: newEnd,
    trial_extended: true,
    updated_at: FieldValue.serverTimestamp(),
  })

  return { trial_ends_at: newEnd.toMillis() }
})

// ─────────────────────────────────────────────────────────────────────────────
// Trial lifecycle: lapsed trials (and cancelled paid subscriptions) land on
// the Free plan — data kept, app fully usable within Free's limits. Daily
// scheduled job. The old wall + 90-day purge are retired.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move a team onto the Free plan (trial lapsed or paid subscription cancelled).
 * Clears the legacy wall/purge markers and deactivates plugin installs — Free
 * has no plugin access; install config is preserved so a later upgrade can
 * reactivate without losing settings.
 */
async function downgradeTeamToFree(teamId: string, opts: { fromTrial: boolean }): Promise<void> {
  const db = admin.firestore()
  const update: Record<string, unknown> = {
    plan: 'free',
    plan_status: 'active',
    suspended_at: FieldValue.delete(),
    purge_at: FieldValue.delete(),
    updated_at: FieldValue.serverTimestamp(),
  }
  if (opts.fromTrial) update.downgraded_from_trial_at = FieldValue.serverTimestamp()
  await db.collection(TEAMS_COLLECTION).doc(teamId).update(update)

  const installs = await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
    .where('status', '==', 'active')
    .get()

  const activePluginIds = installs.docs.map((d) => d.id)

  for (const d of installs.docs) {
    await d.ref.set(
      { status: 'inactive', updated_at: FieldValue.serverTimestamp() },
      { merge: true }
    )
  }

  // Tear down plugin-specific public artefacts that would otherwise remain
  // visible after a downgrade (the plugin-status trigger only fires on
  // installed_plugins writes; it runs in parallel with this path so we also
  // tear down here to guarantee the artefacts are removed synchronously).
  const teardowns: Promise<void>[] = []
  if (activePluginIds.includes('website')) {
    teardowns.push(unpublishSiteForTeam(teamId))
  }
  if (activePluginIds.includes('online-courses')) {
    teardowns.push(deleteAllCoursePublicProfiles(teamId))
  }
  await Promise.all(teardowns)
}

// All team-scoped top-level collections keyed by `teamId`. recursiveDelete on
// each matching doc also removes that doc's subcollections (e.g. contact goals,
// session bookings, event attendees).
const TEAM_COLLECTIONS_BY_TEAMID = [
  CONTACTS_COLLECTION,
  'sessions',
  'activities',
  'events',
  'checkins',
  'session_series',
  'courses',
  'coach_availability',
]

/**
 * Hard-delete every team-scoped record (Firestore + Storage). Keeps Auth users.
 * When `dryRun` is true, NOTHING is deleted — it only logs what it would remove
 * (counts per collection).
 *
 * DORMANT: no longer wired to a schedule (the 90-day trial purge was retired
 * when lapsed trials began downgrading to the Free plan). Kept as a manual
 * GDPR / account-deletion utility — exported so the module compiles and so an
 * admin script can import it.
 */
export async function purgeTeam(teamId: string, dryRun: boolean): Promise<void> {
  const db = admin.firestore()
  const tag = dryRun ? '[trial][dry-run]' : '[trial]'

  for (const coll of TEAM_COLLECTIONS_BY_TEAMID) {
    if (dryRun) {
      const c = await db.collection(coll).where('teamId', '==', teamId).count().get()
      console.log(`${tag} team ${teamId}: would delete ${c.data().count} ${coll}`)
    } else {
      const snap = await db.collection(coll).where('teamId', '==', teamId).get()
      for (const d of snap.docs) await db.recursiveDelete(d.ref)
    }
  }

  // referrals key the team via `team_id`, not `teamId`.
  if (dryRun) {
    const c = await db.collection('referrals').where('team_id', '==', teamId).count().get()
    console.log(`${tag} team ${teamId}: would delete ${c.data().count} referrals`)
    console.log(
      `${tag} team ${teamId}: would delete saas_subscription + checkout attempts + site draft + published site + team doc & subcollections + Storage teams/${teamId}/`
    )
    return
  }
  const refSnap = await db.collection('referrals').where('team_id', '==', teamId).get()
  for (const d of refSnap.docs) await db.recursiveDelete(d.ref)

  // Top-level docs keyed by teamId.
  const attempts = await db.collection('saas_checkout_attempts').where('teamId', '==', teamId).get()
  for (const d of attempts.docs) await d.ref.delete()
  await db
    .collection('saas_subscriptions')
    .doc(teamId)
    .delete()
    .catch(() => undefined)
  // Website plugin: private draft + public snapshot (both keyed by teamId).
  await db
    .collection(SITE_DRAFTS_COLLECTION)
    .doc(teamId)
    .delete()
    .catch(() => undefined)
  await db
    .collection(SITE_PUBLISHED_COLLECTION)
    .doc(teamId)
    .delete()
    .catch(() => undefined)

  // Team doc + ALL its subcollections (team_members, installed_plugins, …).
  await db.recursiveDelete(db.collection(TEAMS_COLLECTION).doc(teamId))

  // Team Storage files.
  try {
    await admin
      .storage()
      .bucket()
      .deleteFiles({ prefix: `teams/${teamId}/` })
  } catch (err) {
    console.error(`[trial] storage cleanup failed for ${teamId}:`, err)
  }
}

/** Notify the owner that the trial ended and the team is now on the Free plan. */
async function sendTrialExpiredEmail(
  teamId: string,
  team: FirebaseFirestore.DocumentData
): Promise<void> {
  const db = admin.firestore()
  let ownerEmail: string | undefined

  const ownerUid = team.primaryContact as string | undefined
  if (ownerUid) ownerEmail = (await db.collection('users').doc(ownerUid).get()).data()?.email
  if (!ownerEmail) {
    const m = await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection('team_members')
      .where('role', '==', 'owner')
      .limit(1)
      .get()
    if (!m.empty) {
      const uid = m.docs[0].data().userId as string
      ownerEmail = (await db.collection('users').doc(uid).get()).data()?.email
    }
  }
  if (!ownerEmail) return

  const billingUrl = `${getHostingUrl()}/billing`
  const { html, text } = buildEmailTemplate({
    title: 'Your Linyup trial has ended',
    body:
      `Your free trial of <strong>${team.name ?? 'Linyup'}</strong> has ended, and your ` +
      `account is now on the <strong>Free plan</strong> — up to 10 active contacts, single user. ` +
      `All your data is kept and everything keeps working within those limits. ` +
      `Upgrade any time to lift them.<br><br><a href="${billingUrl}">See plans &amp; upgrade</a>`,
  })
  await sendEmail({ to: ownerEmail, subject: 'Your Linyup trial has ended', html, text })
}

export const handleTrialLifecycle = onSchedule(
  { schedule: 'every day 01:00', timeZone: 'Europe/Zurich', timeoutSeconds: 540, memory: '1GiB' },
  async () => {
    const db = admin.firestore()
    const nowTs = Timestamp.fromMillis(Date.now())

    // Phase 1 — lapsed trials land on the Free plan (data kept, no wall).
    const expiring = await db
      .collection(TEAMS_COLLECTION)
      .where('plan_status', '==', 'trial')
      .where('trial_ends_at', '<=', nowTs)
      .limit(200)
      .get()
    for (const doc of expiring.docs) {
      const teamId = doc.id
      try {
        await downgradeTeamToFree(teamId, { fromTrial: true })
        await sendTrialExpiredEmail(teamId, doc.data()).catch((e) =>
          console.error(`[trial] email failed ${teamId}:`, e)
        )
        console.log(`[trial] downgraded lapsed trial ${teamId} to free`)
      } catch (err) {
        console.error(`[trial] downgrade failed ${teamId}:`, err)
      }
    }

    // Transitional sweep (wall era → free era): convert teams stranded on the
    // legacy 'expired' status to the Free plan. Remove this block once no
    // 'expired' teams remain in any environment.
    const legacy = await db
      .collection(TEAMS_COLLECTION)
      .where('plan_status', '==', 'expired')
      .limit(200)
      .get()
    for (const doc of legacy.docs) {
      try {
        await downgradeTeamToFree(doc.id, { fromTrial: true })
        console.log(`[trial] converted legacy expired team ${doc.id} to free`)
      } catch (err) {
        console.error(`[trial] legacy conversion failed ${doc.id}:`, err)
      }
    }
  }
)
