/* eslint-disable no-console */
// recordManualPayment — a manager records a cash / bank-transfer payment taken
// OUTSIDE any gateway, into the same unified ledger as the BYO webhooks. It's a
// `payment_events` row with gateway:'manual', so it flows through the Payments
// page, the contact Payments tab, and the reassign/edit path like every other
// external payment. When a contact + line-item are given, it applies the same
// effects a Connect purchase would (subscription fields / course entitlement /
// credits) via applyPaymentEffects.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  TEAMS_COLLECTION,
  CONTACTS_COLLECTION,
  PAYMENT_EVENTS_SUBCOLLECTION,
} from '@linyup/shared'
import { assertManager } from '../connect/access'
import { applyPaymentEffects, normalizePaymentLineItem } from './effects'

const MAX_COMMENT_LEN = 500
const MAX_MODE_LEN = 60

export const recordManualPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as {
    teamId?: string
    contactId?: string | null
    amount?: number // minor units (Rappen/cents)
    currency?: string
    occurredAt?: number // epoch ms
    paymentMode?: string // studio-configured mode label (free text)
    lineItem?: unknown
    comment?: string | null
    idempotencyKey?: string
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const teamId = data.teamId

  if (typeof data.amount !== 'number' || !Number.isInteger(data.amount) || data.amount < 1) {
    throw new HttpsError('invalid-argument', 'amount must be a positive integer in minor units')
  }
  const amount = data.amount
  const paymentMode = (data.paymentMode ?? '').toString().trim().slice(0, MAX_MODE_LEN) || null
  const currency = (data.currency ?? 'CHF').toUpperCase().slice(0, 3)
  const comment = (data.comment ?? '').toString().trim().slice(0, MAX_COMMENT_LEN) || null
  const lineItem = normalizePaymentLineItem(data.lineItem)

  await assertManager(request.auth.uid, teamId)

  const db = admin.firestore()

  // Validate the target contact (when linking).
  let contactId: string | null = null
  if (data.contactId) {
    const cid = String(data.contactId).trim()
    if (cid) {
      const cSnap = await db.collection(CONTACTS_COLLECTION).doc(cid).get()
      if (!cSnap.exists || cSnap.data()?.teamId !== teamId) {
        throw new HttpsError('invalid-argument', 'Contact does not belong to this team')
      }
      if (cSnap.data()?.deleted_at != null) {
        throw new HttpsError('invalid-argument', 'Contact is deleted')
      }
      contactId = cid
    }
  }

  const eventsCol = db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(PAYMENT_EVENTS_SUBCOLLECTION)
  const ref = (data.idempotencyKey?.trim() || eventsCol.doc().id).slice(0, 120)
  const docRef = eventsCol.doc(`manual:${ref}`)
  const now = FieldValue.serverTimestamp()

  try {
    await docRef.create({
      gateway: 'manual',
      payment_mode: paymentMode,
      gatewayRef: ref,
      contact_id: contactId,
      assignment_status: contactId ? 'assigned' : 'unassigned',
      email: null,
      amount,
      currency,
      subscription_type_id:
        lineItem?.kind === 'subscription' ? lineItem.subscriptionTypeId ?? null : null,
      line_item: lineItem,
      membership_expiration: null,
      comment,
      raw_status: 'manual',
      processed_at:
        typeof data.occurredAt === 'number' ? Timestamp.fromMillis(data.occurredAt) : now,
      recorded_by: request.auth.uid,
      assigned_by: contactId ? request.auth.uid : null,
      assigned_at: contactId ? now : null,
      created_at: now,
    })
  } catch (err: unknown) {
    // ALREADY_EXISTS (code 6) — an idempotent retry; acknowledge without re-applying.
    if ((err as { code?: number }).code === 6) {
      return { id: docRef.id, duplicate: true }
    }
    console.error(`[recordManualPayment] write failed team=${teamId}:`, err)
    throw new HttpsError('internal', 'Failed to record the payment')
  }

  // Apply the purchase effects (course unlock / subscription fields / credits).
  if (contactId && lineItem) {
    await applyPaymentEffects(db, {
      teamId,
      contactId,
      lineItem,
      amountRappen: amount,
      currency,
      source: 'manual',
      paymentRef: docRef.id,
    })
  }

  return { id: docRef.id }
})
