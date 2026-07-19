/* eslint-disable no-console */
// Gift cards (E3) — CODE-based stored value: teams/{teamId}/gift_cards/{code}.
// The public checkout (createGiftCardCheckout) mints nothing itself — a card is
// minted by the webhook (handleGiftCardCheckout in ./webhook.ts) once payment is
// confirmed. This file owns:
//  • createGiftCardCheckout — the public purchase callable.
//  • mintGiftCard — the collision-safe, idempotent-by-payment-intent minting
//    helper the webhook calls.
//  • reserveGiftCardDrawdown / commitGiftCardHold / releaseGiftCardHold — the
//    hold lifecycle shared by every one-off checkout that accepts a
//    `giftCardCode` (product, course, drop-in — see their call sites).
//  • checkGiftCard / voidGiftCard — public balance check + manager void.
//
// Holds are a map field on the card doc (keyed by a fresh id the caller mints),
// NOT a subcollection — they can't be queried directly. Expiry is therefore
// LAZY: giftCardAvailable() (shared, pure) simply ignores holds whose
// expires_at has passed when computing available balance, and every
// transaction in this file opportunistically drops expired holds it happens to
// see while it already has the doc loaded. There is no sweep job for gift-card
// holds — see dailyTasks/expirePendingBookings.ts's doc comment, which only
// covers the booking-hold shapes.

import crypto from 'crypto'
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  GIFT_CARDS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  formatGiftCardCode,
  giftCardAvailable,
  planGiftCardRedemption,
  round2Major,
  type GiftCard,
  type GiftCardHold,
  type GiftCardRedemptionPlan,
  type GiftCardSettings,
} from '@linyup/shared'
import { assertManager, loadEnabledTeam, requireChargeableAccount } from './access'
import {
  buildResultUrls,
  checkoutRateLimit,
  defaultIdempotencyKey,
  requireChargeableAmountFromMajor,
  startOneOffCheckout,
} from './checkout'
import { requireContactSessionForTeam } from '../utils/contactSession'
import { APP_CHECK_ENFORCE, monitorAppCheck } from '../utils/appCheck'

const DEFAULT_HOLD_MINUTES = 35

const round2 = round2Major

/** Codes are case/space-insensitive to the buyer; the doc id is always the
 *  canonical uppercase form formatGiftCardCode produces. */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

function cardRef(teamId: string, code: string): FirebaseFirestore.DocumentReference {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(GIFT_CARDS_SUBCOLLECTION)
    .doc(normalizeCode(code))
}

/** Drop any holds whose expires_at has passed. Called from inside a
 *  transaction that already has the card loaded — piggybacks the cleanup onto
 *  a write that's happening anyway rather than a dedicated sweep. */
function dropExpiredHolds(
  holds: Record<string, GiftCardHold> | undefined,
  nowMs: number
): Record<string, GiftCardHold> {
  const out: Record<string, GiftCardHold> = {}
  for (const [key, hold] of Object.entries(holds ?? {})) {
    if (hold.expires_at.toMillis() > nowMs) out[key] = hold
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// mintGiftCard — called by the webhook once a gift-card checkout is paid.
// ─────────────────────────────────────────────────────────────────────────────
export async function mintGiftCard(params: {
  teamId: string
  amount: number // major units
  currency: string
  purchaserContactId?: string | null
  purchaserEmail?: string | null
  paymentIntentId: string
}): Promise<GiftCard> {
  const db = admin.firestore()
  const col = db.collection(TEAMS_COLLECTION).doc(params.teamId).collection(GIFT_CARDS_SUBCOLLECTION)

  // Idempotency: a card may already have been minted for this payment intent
  // (webhook redelivery / crash-safe reprocessing) — never mint a second one.
  const existing = await col.where('payment_intent_id', '==', params.paymentIntentId).limit(1).get()
  if (!existing.empty) return existing.docs[0].data() as GiftCard

  const now = FieldValue.serverTimestamp()
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = formatGiftCardCode(crypto.randomBytes(8))
    const ref = col.doc(code)
    const card: GiftCard = {
      code,
      teamId: params.teamId,
      amount: params.amount,
      balance: params.amount,
      currency: params.currency,
      status: 'active',
      purchaserContactId: params.purchaserContactId ?? null,
      purchaserEmail: params.purchaserEmail ?? null,
      payment_intent_id: params.paymentIntentId,
    }
    try {
      await ref.create({ ...card, created_at: now, updated_at: now })
      return card
    } catch (err: unknown) {
      lastErr = err
      // ALREADY_EXISTS (code 6) — code collision, try another one.
      if ((err as { code?: number }).code === 6) continue
      throw err
    }
  }
  console.error(`[giftCards] mint failed after 3 collision retries (team=${params.teamId}):`, lastErr)
  throw new HttpsError('internal', 'Failed to create the gift card')
}

// ─────────────────────────────────────────────────────────────────────────────
// Hold lifecycle — reserve at checkout time, commit on payment success, release
// on checkout expiry (or by finding no hold at commit time — see commit below).
// ─────────────────────────────────────────────────────────────────────────────

/** Reserve a drawdown against a card's available balance. Throws `not-found`
 *  for an invalid/void/other-team code, and `failed-precondition` (reason:
 *  'gift_card_unusable') when the card can't cover any usable amount. */
export async function reserveGiftCardDrawdown(params: {
  teamId: string
  code: string
  totalMajor: number
  holdKey: string
  holdMinutes?: number
}): Promise<GiftCardRedemptionPlan> {
  const db = admin.firestore()
  const ref = cardRef(params.teamId, params.code)
  const holdMinutes = params.holdMinutes ?? DEFAULT_HOLD_MINUTES

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()?.teamId !== params.teamId) {
      throw new HttpsError('not-found', 'Gift card not found')
    }
    const card = snap.data() as GiftCard
    const nowMs = Date.now()
    const holds = dropExpiredHolds(card.holds, nowMs)

    const available = giftCardAvailable({ ...card, holds }, nowMs)
    const plan = planGiftCardRedemption(available, params.totalMajor)
    if (!plan) {
      throw new HttpsError('failed-precondition', 'Gift card cannot be used for this amount', {
        reason: 'gift_card_unusable',
      })
    }

    holds[params.holdKey] = {
      amount: plan.drawdown,
      expires_at: Timestamp.fromMillis(nowMs + holdMinutes * 60_000),
    }
    // update() REPLACES the holds map wholesale — set(..., {merge:true}) would
    // deep-merge it and resurrect every key we dropped (expired-hold cleanup
    // and releases would never persist).
    tx.update(ref, { holds, updated_at: FieldValue.serverTimestamp() })
    return plan
  })
}

/** Commit a reserved hold: subtract the drawdown from the card's balance and
 *  drop the hold. Idempotent per Stripe event (the webhook's event-id ledger
 *  guarantees single delivery). When the hold is MISSING but the caller knows
 *  the drawdown (webhook metadata), the amount is deducted anyway — a payment
 *  that lands after the 35-minute hold expiry must still draw the card down,
 *  or the buyer keeps stored value they already spent. */
export async function commitGiftCardHold(params: {
  teamId: string
  code: string
  holdKey: string
  /** The reserved drawdown (major units), from checkout metadata — used when
   *  the hold has lazily expired before the payment webhook arrived. */
  fallbackAmountMajor?: number
}): Promise<void> {
  const db = admin.firestore()
  const ref = cardRef(params.teamId, params.code)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return // card gone — nothing to commit
    const card = snap.data() as GiftCard
    const nowMs = Date.now()
    const holds = dropExpiredHolds(card.holds, nowMs)
    const hold = holds[params.holdKey]

    const amount = hold?.amount ?? params.fallbackAmountMajor
    if (typeof amount !== 'number') {
      // No hold, no known drawdown — nothing safe to commit; still persist any
      // lazy-expired cleanup we computed.
      tx.update(ref, { holds, updated_at: FieldValue.serverTimestamp() })
      return
    }

    delete holds[params.holdKey]
    const balance = Math.max(0, round2(card.balance - amount))
    // update() replaces the holds map wholesale (merge would resurrect
    // dropped keys) — see reserveGiftCardDrawdown.
    tx.update(ref, {
      holds,
      balance,
      status: balance <= 0 ? 'depleted' : card.status,
      updated_at: FieldValue.serverTimestamp(),
    })
  })
}

/** Restore a previously COMMITTED drawdown (e.g. a duplicate charge that got
 *  refunded after its gift-card portion was already committed). */
export async function restoreGiftCardDrawdown(params: {
  teamId: string
  code: string
  amountMajor: number
}): Promise<void> {
  const db = admin.firestore()
  const ref = cardRef(params.teamId, params.code)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const card = snap.data() as GiftCard
    const balance = round2(card.balance + params.amountMajor)
    tx.update(ref, {
      balance,
      // A void stays void; a depleted card comes back to life.
      status: card.status === 'depleted' && balance > 0 ? 'active' : card.status,
      updated_at: FieldValue.serverTimestamp(),
    })
  })
}

/** Release a reserved hold without committing it (checkout cancelled/expired). */
export async function releaseGiftCardHold(params: {
  teamId: string
  code: string
  holdKey: string
}): Promise<void> {
  const db = admin.firestore()
  const ref = cardRef(params.teamId, params.code)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const card = snap.data() as GiftCard
    const nowMs = Date.now()
    const holds = dropExpiredHolds(card.holds, nowMs)
    delete holds[params.holdKey]
    // update() replaces the holds map wholesale — merge would resurrect the
    // deleted key and the release would never persist.
    tx.update(ref, { holds, updated_at: FieldValue.serverTimestamp() })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// createGiftCardCheckout — public purchase of a gift card. LOGIN-FIRST, same
// shape as createProductCheckout/createCourseCheckout. Mints nothing itself;
// the webhook (handleGiftCardCheckout) mints the card on payment success.
// ─────────────────────────────────────────────────────────────────────────────
export const createGiftCardCheckout = onCall({ enforceAppCheck: APP_CHECK_ENFORCE }, async (request) => {
  monitorAppCheck(request, 'createGiftCardCheckout')
  const data = request.data as {
    teamId?: string
    amount?: number
    slug?: string
    locale?: string
    origin?: string
    idempotencyKey?: string
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const { teamId } = data
  const locale = data.locale ?? 'en'

  await checkoutRateLimit(request.rawRequest?.ip)

  // Login-first: every gift-card purchase runs as a verified contact of this
  // team, same as the other public shop checkouts.
  const session = await requireContactSessionForTeam(request, teamId)
  const email = session.email ?? undefined

  const team = await loadEnabledTeam(teamId)
  requireChargeableAccount(team) // fail before the reads; the orchestrator re-checks

  const settings = (team.data.settings?.giftCards ?? null) as GiftCardSettings | null
  if (!settings?.enabled) {
    throw new HttpsError('failed-precondition', 'Gift cards are not available for this team')
  }
  const amountMajor = data.amount
  if (typeof amountMajor !== 'number' || !settings.amounts.includes(amountMajor)) {
    throw new HttpsError('invalid-argument', 'amount must be one of the configured gift card amounts')
  }
  const amount = requireChargeableAmountFromMajor(amountMajor)

  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=shop` : ''
  const { successUrl, cancelUrl } = buildResultUrls(locale, { extraQuery: slugQuery, origin: data.origin })

  // Webhook reads this to mint the card and email the purchaser.
  const metadata: Record<string, string> = {
    teamId,
    kind: 'gift_card',
    purpose: 'gift_card',
    amount: String(amountMajor),
    contactId: session.contactId,
    ...(email ? { purchaserEmail: email } : {}),
  }

  const idempotencyKey =
    data.idempotencyKey ??
    defaultIdempotencyKey('gift-pub', teamId, session.contactId, String(amountMajor))

  const checkout = await startOneOffCheckout({
    team,
    amountMinor: amount,
    productName: `Gift card CHF ${amountMajor}`,
    successUrl,
    cancelUrl,
    customerEmail: email,
    metadata,
    idempotencyKey,
    label: 'createGiftCardCheckout',
  })
  return { url: checkout.url, sessionId: checkout.sessionId }
})

// ─────────────────────────────────────────────────────────────────────────────
// checkGiftCard — public balance check (never reveals the purchaser).
// ─────────────────────────────────────────────────────────────────────────────
export const checkGiftCard = onCall({ enforceAppCheck: APP_CHECK_ENFORCE }, async (request) => {
  monitorAppCheck(request, 'checkGiftCard')
  const data = request.data as { teamId?: string; code?: string }
  if (!data?.teamId || !data?.code) {
    throw new HttpsError('invalid-argument', 'teamId and code are required')
  }
  await checkoutRateLimit(request.rawRequest?.ip)

  const snap = await cardRef(data.teamId, data.code).get()
  if (!snap.exists || snap.data()?.teamId !== data.teamId) {
    return { valid: false, balance: 0, currency: null }
  }
  const card = snap.data() as GiftCard
  const balance = giftCardAvailable(card)
  return { valid: card.status === 'active' && balance > 0, balance, currency: card.currency }
})

// ─────────────────────────────────────────────────────────────────────────────
// voidGiftCard — manager-only, e.g. lost/fraudulent card.
// ─────────────────────────────────────────────────────────────────────────────
export const voidGiftCard = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const data = request.data as { teamId?: string; code?: string }
  if (!data?.teamId || !data?.code) {
    throw new HttpsError('invalid-argument', 'teamId and code are required')
  }
  await assertManager(request.auth.uid, data.teamId)

  const ref = cardRef(data.teamId, data.code)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.teamId !== data.teamId) {
    throw new HttpsError('not-found', 'Gift card not found')
  }
  await ref.set(
    { status: 'void', voided_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() },
    { merge: true }
  )
  return { ok: true }
})
