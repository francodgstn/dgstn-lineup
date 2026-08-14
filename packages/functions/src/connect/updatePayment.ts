/* eslint-disable no-console */
// updatePaymentRecord — the one manager action that spans both payment rails:
// (re)assign the contact and/or edit the free-text "what was paid" comment.
//
//   • Connect → teams/{teamId}/member_payments/{paymentId} (contactId, comment)
//   • BYO     → teams/{teamId}/payment_events/{paymentId}  (contact_id,
//               assignment_status, comment)
//
// On assigning a contact we stamp last_payment_at and write an activity-log entry;
// BYO docs additionally carry the subscription linkage (subscription_type_id /
// membership_expiration) so we re-apply the membership — Connect member_payments
// don't persist that detail, so only last_payment_at is touched there.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  TEAMS_COLLECTION,
  CONTACTS_COLLECTION,
  MEMBER_PAYMENTS_SUBCOLLECTION,
  PAYMENT_EVENTS_SUBCOLLECTION,
  type PaymentLineItem,
} from '@linyup/shared'
import { assertManager } from './access'
import { applyPaymentEffects, normalizePaymentLineItem } from '../payments/effects'

const MAX_COMMENT_LEN = 500

/** Re-attach the system-stamped promo code to a manager's edited line-item.
 *
 * `line_item` is REPLACED wholesale on edit, and the picker
 * (PaymentLineItemPicker) builds a fresh object on every change, so without this
 * the first "what was paid" correction on a discounted sale would erase the only
 * record that a code was used — the payments row is that record, by decision:
 * a promo writes no journal row and no CSV column (docs/promo-codes.md).
 *
 * The value comes from the STORED document, never from the request, which is the
 * other half of the rule `normalizePaymentLineItem` states: not forgeable by a
 * client, not loseable by an edit. */
function carryPromoStamp(
  next: PaymentLineItem | null,
  payment: FirebaseFirestore.DocumentData
): PaymentLineItem | null {
  if (!next) return next
  const stored = (payment.line_item as PaymentLineItem | undefined)?.promoCode
  return stored ? { ...next, promoCode: stored } : next
}

/** The line-item to apply on assign: the manager's explicit pick, else the row's
 * stored line_item, else a bare subscription link derived from subscription_type_id. */
function effectiveLineItem(
  explicit: PaymentLineItem | null,
  payment: FirebaseFirestore.DocumentData
): PaymentLineItem | null {
  if (explicit) return explicit
  if (payment.line_item) return normalizePaymentLineItem(payment.line_item)
  const subTypeId = payment.subscription_type_id as string | undefined
  if (subTypeId) return { kind: 'subscription', subscriptionTypeId: subTypeId }
  return null
}

export const updatePaymentRecord = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as {
    teamId?: string
    source?: 'connect' | 'byo'
    paymentId?: string
    // contactId: a non-empty id assigns; '' or null unassigns; omit → unchanged.
    contactId?: string | null
    // comment: any string sets it; omit → unchanged.
    comment?: string | null
    // lineItem: structured "what was bought"; omit → unchanged.
    lineItem?: unknown
  }
  if (!data?.teamId || !data?.paymentId) {
    throw new HttpsError('invalid-argument', 'teamId and paymentId are required')
  }
  const source = data.source ?? 'connect'
  if (source !== 'connect' && source !== 'byo') {
    throw new HttpsError('invalid-argument', 'source must be "connect" or "byo"')
  }
  const { teamId, paymentId } = data

  const changingContact = Object.prototype.hasOwnProperty.call(data, 'contactId')
  const changingComment = Object.prototype.hasOwnProperty.call(data, 'comment')
  const changingLineItem = Object.prototype.hasOwnProperty.call(data, 'lineItem')
  if (!changingContact && !changingComment && !changingLineItem) {
    throw new HttpsError('invalid-argument', 'Nothing to update')
  }
  const newLineItem = changingLineItem ? normalizePaymentLineItem(data.lineItem) : null

  await assertManager(request.auth.uid, teamId)

  const db = admin.firestore()
  const docRef =
    source === 'byo'
      ? db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(PAYMENT_EVENTS_SUBCOLLECTION)
          .doc(paymentId)
      : db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(MEMBER_PAYMENTS_SUBCOLLECTION)
          .doc(paymentId)

  const snap = await docRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Payment not found')
  const payment = snap.data()!
  // The manager's line-item, with the system-stamped promo code carried across
  // (the picker rebuilds the object from scratch, so it never round-trips).
  const finalLineItem = carryPromoStamp(newLineItem, payment)

  // Validate the target contact when assigning a non-empty id.
  let newContactId: string | null = null
  if (changingContact) {
    const cid = (data.contactId ?? '').trim()
    if (cid) {
      const cSnap = await db.collection(CONTACTS_COLLECTION).doc(cid).get()
      if (!cSnap.exists || cSnap.data()?.teamId !== teamId) {
        throw new HttpsError('invalid-argument', 'Contact does not belong to this team')
      }
      if (cSnap.data()?.deleted_at != null) {
        throw new HttpsError('invalid-argument', 'Contact is deleted')
      }
      newContactId = cid
    }
  }

  const now = FieldValue.serverTimestamp()
  const update: Record<string, unknown> = { updated_at: now }

  let finalComment: string | null | undefined
  if (changingComment) {
    finalComment = (data.comment ?? '').toString().trim().slice(0, MAX_COMMENT_LEN) || null
    update.comment = finalComment
  }
  if (changingLineItem) {
    update.line_item = finalLineItem
    if (finalLineItem?.kind === 'subscription') {
      update.subscription_type_id = finalLineItem.subscriptionTypeId ?? null
    }
  }

  if (changingContact) {
    if (source === 'byo') {
      update.contact_id = newContactId
      update.assignment_status = newContactId ? 'assigned' : 'unassigned'
      update.assigned_by = request.auth.uid
      update.assigned_at = now
    } else {
      update.contactId = newContactId
    }
  }

  await docRef.set(update, { merge: true })

  // Who this row is (now) linked to, and whether we should (re)apply effects.
  const existingContact = (source === 'byo' ? payment.contact_id : payment.contactId) as
    | string
    | null
    | undefined
  const targetContactId = changingContact ? newContactId : (existingContact ?? null)
  const shouldApply = !!targetContactId && (changingContact ? !!newContactId : changingLineItem)

  if (shouldApply && targetContactId) {
    const rowSource =
      source === 'byo' ? ((payment.gateway as string | undefined) ?? 'byo') : 'stripe_connect'
    const li = effectiveLineItem(finalLineItem, payment)
    if (li) {
      // Full effects: subscription fields / course entitlement / credits + activity.
      await applyPaymentEffects(db, {
        teamId,
        contactId: targetContactId,
        lineItem: li,
        amountRappen: typeof payment.amount === 'number' ? payment.amount : null,
        currency: (payment.currency as string | undefined) ?? 'CHF',
        source: rowSource,
        paymentRef: docRef.id,
      })
    } else {
      // No structured item — just stamp + log the bare assignment.
      await db.collection(CONTACTS_COLLECTION).doc(targetContactId).set({ last_payment_at: now }, { merge: true })
      const label = changingComment ? finalComment : (payment.comment as string | undefined) ?? null
      await db
        .collection(CONTACTS_COLLECTION)
        .doc(targetContactId)
        .collection('activity_log')
        .add({
          type: 'payment_assigned',
          source: rowSource,
          message: `Payment assigned to this contact${label ? ` · ${label}` : ''}`,
          payment_id: docRef.id,
          timestamp: now,
        })
    }
  }

  return { ok: true, contactId: newContactId, source }
})
