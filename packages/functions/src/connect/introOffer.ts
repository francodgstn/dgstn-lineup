// The plan's INTRO OFFER, server side: from a stored `SubscriptionType` to a
// coupon on the studio's connected account, plus the metadata the webhook reads
// back.
//
// The three rules this module exists to hold:
//
//  1. THE OFFER IS NOT A PRICE. `resolvePaymentOptions` is not consulted and
//     gains no arm — it returns ONE amount, and an intro offer is a schedule.
//     Nothing here computes a discounted amount for anyone to charge: the
//     Checkout Session is created at the FULL per-period price and Stripe
//     applies the coupon.
//  2. VALIDITY IS DECIDED IN ONE PLACE. `resolveIntroOffer` (@linyup/shared) is
//     the same function the editor, the public mirror and the pricing card use.
//     If it says null, the card shows nothing and this module applies nothing —
//     the two cannot disagree.
//  3. THE COUPON ID IS DERIVED, NEVER GENERATED. See `introCouponId`.

import { createHash } from 'crypto'
import {
  resolveIntroOffer,
  toMinorUnits,
  type ResolvedIntroOffer,
  type SubscriptionType,
} from '@linyup/shared'
import type { IntroCouponSpec } from '../utils/connect/client'

/**
 * The coupon id for one offer, on one studio, in one currency.
 *
 * DERIVED from every field that changes what the coupon promises, so:
 *  • the same offer always maps to the same coupon → a retried checkout REUSES
 *    it instead of littering the account with one coupon per click;
 *  • an EDITED offer maps to a different coupon → the old, immutable coupon is
 *    never reused under new terms (Stripe's `coupons.update` can only change
 *    name/metadata, so "fixing" the old one is not an option);
 *  • an offer edited back to its previous values maps back to the original.
 *
 * The type id scopes it to the plan; the hash covers the terms. A coupon lives
 * on the connected account, so the studio is already implied by WHERE it lives.
 */
export function introCouponId(params: {
  subscriptionTypeId: string
  offer: ResolvedIntroOffer
  currency: string
}): string {
  const { offer } = params
  const terms = [
    offer.priceId,
    offer.periods,
    // Minor units, so 1 and 1.00 cannot hash differently.
    toMinorUnits(offer.amount),
    toMinorUnits(offer.fullAmount),
    params.currency.toLowerCase(),
    offer.stripe.duration,
    offer.stripe.duration === 'repeating' ? offer.stripe.durationInMonths : 0,
  ].join('|')
  const hash = createHash('sha256').update(terms).digest('hex').slice(0, 12)
  return `intro_${params.subscriptionTypeId}_${hash}`
}

/** The coupon to apply, or null when this plan/price has no sellable offer. */
export function introCouponSpec(params: {
  subType: Pick<SubscriptionType, 'introOffer' | 'prices' | 'name'>
  subscriptionTypeId: string
  priceId: string
  currency: string
}): { offer: ResolvedIntroOffer; spec: IntroCouponSpec } | null {
  const offer = resolveIntroOffer(params.subType, params.priceId)
  if (!offer) return null
  const id = introCouponId({
    subscriptionTypeId: params.subscriptionTypeId,
    offer,
    currency: params.currency,
  })
  // A FREE intro is percent_off: 100 — a ZERO invoice, which Stripe does not
  // charge at all. An amount_off that happened to leave 0.20 due would be a
  // charge below Stripe's minimum and would fail; `introOfferProblem` refuses
  // those upstream, so the only two shapes that reach here are "free" and
  // "at or above the floor".
  const amountOffMinor = offer.free
    ? null
    : toMinorUnits(offer.fullAmount) - toMinorUnits(offer.amount)
  return {
    offer,
    spec: {
      id,
      name: introCouponName(params.subType.name, offer),
      amountOffMinor,
      currency: params.currency.toLowerCase(),
      duration: offer.stripe.duration,
      ...(offer.stripe.duration === 'repeating'
        ? { durationInMonths: offer.stripe.durationInMonths }
        : {}),
      metadata: {
        linyup: 'intro_offer',
        subscriptionTypeId: params.subscriptionTypeId,
        priceId: offer.priceId,
        periods: String(offer.periods),
      },
    },
  }
}

/** What the member sees on their Stripe invoice. Stripe caps a coupon name at
 *  40 characters. */
function introCouponName(planName: string, offer: ResolvedIntroOffer): string {
  const what = offer.free ? 'Free' : 'Intro'
  const label = `${what} intro · ${offer.periods}× · ${planName}`
  return label.length > 40 ? label.slice(0, 40) : label
}

/**
 * The stamp the webhook reads back off the Checkout Session: what was promised,
 * so the receipt can be checked against what was actually charged and the
 * payment row can say why the figure is not the plan price.
 *
 * Metadata values are strings — Stripe accepts nothing else.
 */
export function introCheckoutMetadata(offer: ResolvedIntroOffer): Record<string, string> {
  return {
    introPeriods: String(offer.periods),
    introAmount: String(offer.amount),
    // The price it RETURNS TO. Carried because the receipt has to restate the
    // whole schedule ("then CHF 79/month"), and the session itself only knows
    // the discounted first total.
    fullAmount: String(offer.fullAmount),
  }
}
