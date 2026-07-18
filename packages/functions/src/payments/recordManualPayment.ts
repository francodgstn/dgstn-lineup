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
  buildExternalPaymentTxn,
} from '@linyup/shared'
import { assertManager } from '../connect/access'
import { recordFinanceTransaction } from '../finance/journal'
import { applyPaymentEffects, normalizePaymentLineItem } from './effects'

const MAX_COMMENT_LEN = 500
const MAX_MODE_LEN = 60

export interface WriteManualPaymentInput {
  teamId: string
  /** Linked contact, or null for an unassigned payment. */
  contactId: string | null
  /** Gross amount in MINOR units (Rappen/cents). */
  amount: number
  currency?: string
  /** Epoch ms the payment was actually taken; defaults to now. */
  occurredAtMs?: number
  /** Studio-configured mode label (free text), e.g. "Cash". */
  paymentMode?: string | null
  /** Structured "what was bought" — raw, normalised internally. */
  lineItem?: unknown
  comment?: string | null
  /** Stable dedupe key; falls back to a fresh doc id (no dedup) when omitted. */
  idempotencyKey?: string
  /** uid of the manager recording the payment. */
  recordedBy: string
}

/**
 * Core write shared by the recordManualPayment callable AND any other
 * manager-initiated manual-payment path (e.g. the appointments "phone
 * booking" flow — see appointments/staffBooking.ts): a `payment_events` row
 * with gateway:'manual', the finance journal entry, and the purchase effects
 * (subscription fields / course entitlement / credits) when a contact +
 * line-item are both given. Callers are responsible for auth + contact
 * validation; this only writes.
 */
export async function writeManualPaymentEvent(
  input: WriteManualPaymentInput
): Promise<{ id: string; duplicate?: boolean }> {
  const db = admin.firestore()
  const { teamId, contactId } = input

  if (!Number.isInteger(input.amount) || input.amount < 1) {
    throw new HttpsError('invalid-argument', 'amount must be a positive integer in minor units')
  }
  const amount = input.amount
  const paymentMode = (input.paymentMode ?? '').toString().trim().slice(0, MAX_MODE_LEN) || null
  const currency = (input.currency ?? 'CHF').toUpperCase().slice(0, 3)
  const comment = (input.comment ?? '').toString().trim().slice(0, MAX_COMMENT_LEN) || null
  const lineItem = normalizePaymentLineItem(input.lineItem)

  const eventsCol = db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(PAYMENT_EVENTS_SUBCOLLECTION)
  const ref = (input.idempotencyKey?.trim() || eventsCol.doc().id).slice(0, 120)
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
        typeof input.occurredAtMs === 'number' ? Timestamp.fromMillis(input.occurredAtMs) : now,
      recorded_by: input.recordedBy,
      assigned_by: contactId ? input.recordedBy : null,
      assigned_at: contactId ? now : null,
      created_at: now,
    })
  } catch (err: unknown) {
    // ALREADY_EXISTS (code 6) — an idempotent retry; acknowledge without re-applying.
    if ((err as { code?: number }).code === 6) {
      return { id: docRef.id, duplicate: true }
    }
    console.error(`[writeManualPaymentEvent] write failed team=${teamId}:`, err)
    throw new HttpsError('internal', 'Failed to record the payment')
  }

  // Finance journal (core infrastructure, best-effort — a failure never breaks
  // payment recording; the backfill reconciles).
  try {
    await recordFinanceTransaction(
      buildExternalPaymentTxn({
        teamId,
        gateway: 'manual',
        gatewayRef: ref,
        amount,
        currency,
        contactId,
        lineItemKind: lineItem?.kind ?? null,
        description: comment ?? lineItem?.label ?? paymentMode,
        occurredAtMs: typeof input.occurredAtMs === 'number' ? input.occurredAtMs : Date.now(),
      })
    )
  } catch (err) {
    console.error(`[writeManualPaymentEvent] finance journal write failed team=${teamId}:`, err)
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
}

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

  return writeManualPaymentEvent({
    teamId,
    contactId,
    amount: data.amount,
    currency: data.currency,
    occurredAtMs: data.occurredAt,
    paymentMode: data.paymentMode,
    lineItem: data.lineItem,
    comment: data.comment,
    idempotencyKey: data.idempotencyKey,
    recordedBy: request.auth.uid,
  })
})
