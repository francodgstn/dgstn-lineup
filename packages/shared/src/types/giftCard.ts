// Gift cards (E3) — CODE-based stored value: the buyer pays, whoever holds the
// code redeems. Cards live at teams/{teamId}/gift_cards/{code} (the readable
// code IS the doc id — treat it as a secret: Firestore rules give managers
// read; the public checks balances only through the checkGiftCard callable).
//
// V1 redemption surface: the ONE-OFF public checkouts (product, course,
// drop-in). Recurring memberships are excluded (stored value can't be mixed
// into a Stripe subscription cleanly). Two redemption shapes:
//  • PARTIAL — the Stripe charge is reduced by the drawdown; the residual must
//    still clear the 0.50 minimum (planGiftCardRedemption enforces it).
//  • FULL COVER — no Stripe at all: the callable applies the manual-rail
//    payment effects directly and commits the drawdown immediately.
// Double-spend safety: a checkout RESERVES its drawdown as a hold on the card
// (keyed by the Checkout Session id); the webhook COMMITS it on payment
// success, and checkout.session.expired / the daily sweep RELEASE stale holds.
// Cards do not expire in v1 (Swiss-friendly default); studios can void.

import type { Timestamp } from './common'
import { MIN_CHARGE_MAJOR } from '../utils/money'

export type GiftCardStatus = 'active' | 'depleted' | 'void'

export interface GiftCardHold {
  /** Drawdown reserved by a pending checkout (major units). */
  amount: number
  /** Hold expiry — aligned with the checkout hold window (+35 min). */
  expires_at: Timestamp
}

export interface GiftCard {
  /** The redeemable code, also the doc id (GC-XXXX-XXXX). */
  code: string
  teamId: string
  /** Face value at purchase (major units, team currency). */
  amount: number
  /** Remaining committed balance (major units) — holds NOT yet subtracted. */
  balance: number
  currency: string
  status: GiftCardStatus
  /** Active reservations, keyed by Stripe Checkout Session id. */
  holds?: Record<string, GiftCardHold>
  purchaserContactId?: string | null
  purchaserEmail?: string | null
  payment_intent_id?: string | null
  created_at?: Timestamp
  updated_at?: Timestamp
  voided_at?: Timestamp | null
}

/** Shop configuration under teams/{id}.settings.giftCards. */
export interface GiftCardSettings {
  enabled: boolean
  /** Purchasable face values (major units), e.g. [50, 100]. */
  amounts: number[]
}

/** Balance a NEW redemption may draw on: committed balance minus live holds. */
export function giftCardAvailable(
  card: Pick<GiftCard, 'status' | 'balance' | 'holds'>,
  nowMs: number = Date.now()
): number {
  if (card.status !== 'active') return 0
  const held = Object.values(card.holds ?? {})
    .filter((h) => h.expires_at.toMillis() > nowMs)
    .reduce((sum, h) => sum + h.amount, 0)
  return Math.max(0, round2(card.balance - held))
}

export interface GiftCardRedemptionPlan {
  /** What the card contributes (major units). */
  drawdown: number
  /** What Stripe still charges (major units). 0 = full cover, skip Stripe. */
  residual: number
}

/**
 * Split a total between the card and Stripe. The residual, when non-zero, must
 * clear Stripe's 0.50 floor — a card that can't full-cover but would leave a
 * sub-minimum residual has its drawdown REDUCED so the charge stays valid.
 * Returns null when the card contributes nothing (no available balance).
 */
export function planGiftCardRedemption(
  availableMajor: number,
  totalMajor: number
): GiftCardRedemptionPlan | null {
  const available = round2(availableMajor)
  const total = round2(totalMajor)
  if (available <= 0 || total <= 0) return null
  if (available >= total) return { drawdown: total, residual: 0 }
  let drawdown = available
  let residual = round2(total - drawdown)
  if (residual < MIN_CHARGE_MAJOR) {
    // Keep the Stripe charge valid: shrink the drawdown to leave the floor.
    residual = MIN_CHARGE_MAJOR
    drawdown = round2(total - residual)
    if (drawdown <= 0) return null // total itself is at/below the floor
  }
  return { drawdown, residual }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** GC-XXXX-XXXX from 8 unambiguous chars (no 0/O/1/I). Caller supplies random
 *  bytes so this stays pure (crypto lives in the functions package). */
export function formatGiftCardCode(randomBytes: Uint8Array): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[randomBytes[i] % ALPHABET.length]
    if (i === 3) out += '-'
  }
  return `GC-${out}`
}
