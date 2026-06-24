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
} from '@linyup/shared'
import { assertManager } from './access'

const MAX_COMMENT_LEN = 500

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
  if (!changingContact && !changingComment) {
    throw new HttpsError('invalid-argument', 'Nothing to update')
  }

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

  // On (re)assign to a contact, apply best-effort membership + log the activity.
  if (changingContact && newContactId) {
    const contactUpdate: Record<string, unknown> = { last_payment_at: now }
    if (source === 'byo') {
      // BYO docs carry the subscription linkage; re-apply it like the webhook does.
      // Note: membership_expiration is NOT written to the contact — the subscription
      // axis (subscription_type_id) is separate from the affiliation axis.
      const subTypeId = payment.subscription_type_id as string | undefined
      if (subTypeId) contactUpdate.subscription_type_id = subTypeId
    }
    await db.collection(CONTACTS_COLLECTION).doc(newContactId).set(contactUpdate, { merge: true })

    const label = changingComment ? finalComment : (payment.comment as string | undefined) ?? null
    await db
      .collection(CONTACTS_COLLECTION)
      .doc(newContactId)
      .collection('activity_log')
      .add({
        type: 'payment_assigned',
        source: source === 'byo' ? ((payment.gateway as string | undefined) ?? 'byo') : 'stripe_connect',
        message: `Payment assigned to this contact${label ? ` · ${label}` : ''}`,
        timestamp: now,
      })
  }

  return { ok: true, contactId: newContactId, source }
})
