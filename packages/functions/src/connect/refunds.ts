/* eslint-disable no-console */
// Stripe Connect — refund a member payment, reversing the platform fee.
//
// The actual fee reversal (refund_application_fee) happens in the client; the
// resulting state (amount_refunded, status) is reconciled onto the member_payments
// doc by the charge.refunded webhook. This callable only authorizes + initiates.

import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  MEMBER_PAYMENTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
} from '@linyup/shared'
import * as admin from 'firebase-admin'
import { refundDirectCharge } from '../utils/connect/client'
import { assertManager, loadEnabledTeam, requireChargeableAccount } from './access'

export const refundMemberPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as {
    teamId?: string
    paymentIntentId?: string
    amount?: number // partial refund in Rappen; omit for full
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  }
  if (!data?.teamId || !data?.paymentIntentId) {
    throw new HttpsError('invalid-argument', 'teamId and paymentIntentId are required')
  }
  const { teamId, paymentIntentId } = data

  if (data.amount !== undefined && (!Number.isInteger(data.amount) || data.amount <= 0)) {
    throw new HttpsError('invalid-argument', 'amount must be a positive integer in Rappen')
  }

  await assertManager(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)
  const { accountId } = requireChargeableAccount(team)

  // The payment must belong to this team (prevents refunding another team's charge).
  const paymentSnap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_PAYMENTS_SUBCOLLECTION)
    .doc(paymentIntentId)
    .get()
  if (!paymentSnap.exists) {
    throw new HttpsError('not-found', 'Payment not found for this team')
  }
  const payment = paymentSnap.data()!
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
    throw new HttpsError('failed-precondition', 'Only a succeeded payment can be refunded')
  }
  if (data.amount !== undefined) {
    const already = (payment.amount_refunded as number) ?? 0
    const total = (payment.amount as number) ?? 0
    if (already + data.amount > total) {
      throw new HttpsError('invalid-argument', 'Refund exceeds the remaining refundable amount')
    }
  }

  try {
    const refund = await refundDirectCharge({
      accountId,
      paymentIntentId,
      amount: data.amount,
      reason: data.reason,
      idempotencyKey: `refund:${paymentIntentId}:${data.amount ?? 'full'}`,
    })
    // The charge.refunded webhook reconciles amount_refunded / status / refunds[].
    return { refundId: refund.id, status: refund.status }
  } catch (err) {
    console.error('[connect] refundMemberPayment failed:', err)
    throw new HttpsError('internal', 'Failed to refund the payment')
  }
})
