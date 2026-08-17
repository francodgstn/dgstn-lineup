/* eslint-disable no-console */
// Stripe Connect — refund a member payment, reversing the platform fee.
//
// The actual fee reversal (refund_application_fee) happens in the client; the
// resulting state (amount_refunded, status) is reconciled onto the member_payments
// doc by the charge.refunded webhook. This callable only authorizes + initiates.
//
// GIFT CARDS. A charge can touch stored value in two opposite ways, and both
// have to be handled here or a refund destroys or duplicates it:
//   • the payment was FUNDED by a card (gift_card_redeemed, stamped by
//     commitGiftCardDrawdown) → giving the cash back must give the drawdown
//     back too, or the customer pays for the booking with value they never get
//     to use again;
//   • the payment BOUGHT a card (giftCardCode, stamped by handleGiftCardCheckout)
//     → giving the cash back must kill the card, or the buyer keeps live stored
//     value they were refunded for.
// A purchase paid ENTIRELY by gift card has no payment intent and therefore no
// member_payments doc at all (see the full-cover branches in connect/payments.ts
// and booking/dropIn.ts), so it cannot be refunded here — the manager path is to
// void or adjust the card and cancel the booking/entitlement. That is a Phase-2
// callable (restoreGiftCardValue), not a silent gap: this one answers not-found.

import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  MEMBER_PAYMENTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  mapCategory,
  type GiftCardStatus,
} from '@linyup/shared'
import * as admin from 'firebase-admin'
import { refundDirectCharge } from '../utils/connect/client'
import { assertManager, loadEnabledTeam, requireChargeableAccount } from './access'
import { reverseGiftCardDrawdown, unvoidGiftCard, voidUntouchedGiftCard } from './giftCards'

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
  const fullRefund = data.amount === undefined

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

  // ── This payment BOUGHT a gift card ────────────────────────────────────────
  const soldCode = (payment.giftCardCode as string | undefined) ?? null
  let voidedFrom: { code: string; previousStatus: GiftCardStatus } | null = null
  if (soldCode) {
    if (!fullRefund) {
      // Half the money back while 100% of the value stays redeemable is a leak
      // with no defensible split — a card is not partially unsold.
      throw new HttpsError(
        'failed-precondition',
        'A gift-card purchase can only be refunded in full',
        { reason: 'gift_card_partial_refund_unsupported' }
      )
    }
    // Void BEFORE the refund, not after: between a check and the Stripe call
    // somebody holding the code could spend it, and then the studio has paid
    // the money back AND delivered the value. Voiding first inverts the failure
    // into a recoverable one — the compensating un-void below, plus a refund
    // the manager can simply retry (refundDirectCharge is idempotent).
    // Throws failed-precondition/gift_card_partially_redeemed when the card has
    // already been drawn on; clawing spent value back is not solvable here.
    const { previousStatus } = await voidUntouchedGiftCard({ teamId, code: soldCode })
    voidedFrom = { code: soldCode, previousStatus }
  }

  try {
    const refund = await refundDirectCharge({
      accountId,
      paymentIntentId,
      amount: data.amount,
      reason: data.reason,
      idempotencyKey: `refund:${paymentIntentId}:${data.amount ?? 'full'}`,
    })

    // ── This payment was FUNDED by a gift card ───────────────────────────────
    const redeemed = payment.gift_card_redeemed as
      | { code?: string; holdKey?: string; amountMajor?: number }
      | undefined
    if (redeemed?.code && redeemed.holdKey) {
      if (fullRefund) {
        // Best-effort by design: the money is already back with the customer,
        // so failing the call now would only invite a second refund. The
        // reversal is idempotent (the card's committed-hold marker gates it),
        // so a retry heals it.
        await reverseGiftCardDrawdown({
          teamId,
          code: redeemed.code,
          holdKey: redeemed.holdKey,
          targetCategory: mapCategory(payment.kind as string | undefined),
          contactId: (payment.contactId as string | undefined) ?? null,
          description: `Refund · ${paymentIntentId}`,
        }).catch((err) =>
          console.error(
            `[connect] gift-card restore after refund failed (pi=${paymentIntentId} code=${redeemed.code}):`,
            err
          )
        )
      } else {
        // A partial refund of a mixed-tender charge has no defensible split
        // between the card and the residual, so the card is left alone.
        console.log(
          `[connect] partial refund on a gift-funded payment (pi=${paymentIntentId}) — card ${redeemed.code} untouched`
        )
      }
    }

    // The charge.refunded webhook reconciles amount_refunded / status / refunds[].
    return { refundId: refund.id, status: refund.status }
  } catch (err) {
    // The card was voided in anticipation of a refund that never happened —
    // put it back, or the buyer loses the value AND keeps paying for it.
    if (voidedFrom) {
      await unvoidGiftCard({
        teamId,
        code: voidedFrom.code,
        previousStatus: voidedFrom.previousStatus,
      }).catch((e) =>
        console.error(`[connect] gift card un-void after failed refund failed (${voidedFrom!.code}):`, e)
      )
    }
    console.error('[connect] refundMemberPayment failed:', err)
    throw new HttpsError('internal', 'Failed to refund the payment')
  }
})
