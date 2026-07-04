// Inbound webhook trigger — external systems POST to a team's unique secret URL
// to fire automation rules against a matching contact.
//
// URL: POST /inboundWebhook/{secretKey}
//
// The {secretKey} is stored on the webhook_endpoint doc. Because it is globally
// unique we can collectionGroup-query for it without knowing the teamId upfront.
//
// Body (JSON): must contain an email address in one of these locations:
//   { email }  |  { data: { email } }  |  { payload: { email } }  |  { contact: { email } }
//
// Response: always 200 (prevents retry storms from calling services).
//   { ok: true,  contact_id }           — matched and rules fired
//   { ok: false, reason: string }       — skipped; reason explains why

import { onRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { fireEventRules, type ContactData } from '../utils/automationEngine'

setGlobalOptions({ region: 'europe-west6' })

export const inboundWebhook = onRequest(
  { invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, reason: 'method_not_allowed' })
      return
    }

    // Secret key is the first path segment: /secretKey or /secretKey/extra
    const secretKey = req.path.split('/').filter(Boolean)[0]
    if (!secretKey) {
      res.status(200).json({ ok: false, reason: 'missing_key' })
      return
    }

    const db = admin.firestore()

    // Look up the endpoint by secret key across all teams
    const [endpointErr, endpointSnap] = await to(
      db.collectionGroup('webhook_endpoints')
        .where('secret_key', '==', secretKey)
        .where('active', '==', true)
        .limit(1)
        .get()
    )
    if (endpointErr || !endpointSnap || endpointSnap.empty) {
      // Never log the raw secret key — it is the bearer credential for this
      // capability URL and would leak into log sinks.
      console.log('[inboundWebhook] Unknown or inactive endpoint key') // eslint-disable-line no-console
      res.status(200).json({ ok: false, reason: 'unknown_endpoint' })
      return
    }

    const endpointDoc = endpointSnap.docs[0]
    // teamId is the grandparent: teams/{teamId}/webhook_endpoints/{endpointId}
    const teamId = endpointDoc.ref.parent.parent?.id
    if (!teamId) {
      res.status(200).json({ ok: false, reason: 'invalid_endpoint' })
      return
    }

    // Extract email from the payload — try the most common shapes
    const body = req.body as Record<string, unknown>
    const email =
      (body.email as string | undefined) ||
      ((body.data as Record<string, unknown>)?.email as string | undefined) ||
      ((body.payload as Record<string, unknown>)?.email as string | undefined) ||
      ((body.contact as Record<string, unknown>)?.email as string | undefined)

    if (!email) {
      console.log(`[inboundWebhook] No email in payload endpoint=${endpointDoc.id}`) // eslint-disable-line no-console
      res.status(200).json({ ok: false, reason: 'no_email_in_payload' })
      return
    }

    // Find contact by teamId + email (skip if not found — caller always gets 200)
    const [contactErr, contactSnap] = await to(
      db.collection('contacts')
        .where('teamId', '==', teamId)
        .where('email', '==', email)
        .limit(1)
        .get()
    )
    if (contactErr || !contactSnap || contactSnap.empty) {
      console.log(`[inboundWebhook] Contact not found email=${email} team=${teamId}`) // eslint-disable-line no-console
      res.status(200).json({ ok: false, reason: 'contact_not_found' })
      return
    }

    const contactDoc = contactSnap.docs[0]
    const contact: ContactData = {
      id: contactDoc.id,
      ...(contactDoc.data() as Omit<ContactData, 'id'>),
    }

    // Dedup: external callers often retry on timeout. Skip if same email triggered this
    // endpoint within the last 30 seconds to prevent duplicate automation rule firings.
    const endpointData = endpointDoc.data()
    const lastTriggeredMs = (endpointData.last_triggered_at as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0
    if (Date.now() - lastTriggeredMs < 30_000 && endpointData.last_triggered_email === email) {
      console.log(`[inboundWebhook] deduplicated contact=${contact.id} endpoint=${endpointDoc.id}`) // eslint-disable-line no-console
      res.status(200).json({ ok: false, reason: 'deduplicated' })
      return
    }

    console.log(`[inboundWebhook] contact=${contact.id} team=${teamId} endpoint=${endpointDoc.id}`) // eslint-disable-line no-console

    await fireEventRules(teamId, 'inbound_webhook', [contact], {
      webhook_endpoint_id: endpointDoc.id,
    })

    // Update endpoint stats — best effort, don't fail the request if this errors
    await to(
      endpointDoc.ref.update({
        last_triggered_at: FieldValue.serverTimestamp(),
        last_triggered_email: email,
        trigger_count: FieldValue.increment(1),
      })
    )

    res.status(200).json({ ok: true, contact_id: contact.id })
  }
)
