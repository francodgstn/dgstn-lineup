// The ONE place for minor-unit money math. Every Connect checkout path (and the
// appointment discount clamp) derives its conversion and minimum-charge floor
// from here — never re-declare `50` or `Math.round(x * 100)` at a call site.
//
// Floor rule (codified 2026-07, matches long-standing behavior):
//  • AUTHORED prices below the floor are a configuration error → callers THROW
//    (see requireChargeableAmountFromMajor in functions/connect/checkout.ts);
//  • ARITHMETIC-DERIVED prices (percent discounts) CLAMP UP to the floor and are
//    never free — see the appointment arm of resolvePaymentOptions
//    (utils/paymentOptions.ts).
// All SUPPORTED_CURRENCIES are two-decimal by design (see types/currency.ts), so
// ×100 is safe for every currency the app can be configured with.

/** Stripe's minimum charge in minor units (Rappen/cents) for two-decimal currencies. */
export const MIN_CHARGE_MINOR = 50

/** The same floor in MAJOR units — for clamping arithmetic-derived prices. */
export const MIN_CHARGE_MAJOR = MIN_CHARGE_MINOR / 100

/** Major units (e.g. 49.9) → integer minor units (4990). `Math.round` absorbs
 *  float artifacts like 49.9 * 100 === 4989.999…. */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100)
}

/** True iff `amount` is an integer minor-unit value at or above the charge floor. */
export function isChargeableMinorAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount >= MIN_CHARGE_MINOR
}

/** Round a MAJOR-units amount to two decimals — the one rounding policy for
 *  major-unit arithmetic (benefit discounts, gift-card balances). Keep every
 *  call site on this helper so a policy change can never fork the math. */
export function round2Major(major: number): number {
  return Math.round(major * 100) / 100
}

/**
 * The share of a payment that covers the units NOT yet consumed — the suggested
 * refund for a partly-used credit pack (10 classes for CHF 180, 3 taken →
 * 180 × 7/10 = CHF 126.00). Floors, so rounding never favours the refund over
 * the studio.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO, both of which look like omissions:
 *
 *  • MIN_CHARGE_MINOR IS NOT APPLIED. That is a *charge* floor — Stripe's
 *    minimum for taking money. A refund has no such floor; Stripe refunds any
 *    positive integer, and the refund callable already validates the amount.
 *    Clamping here would silently hand back more than the arithmetic says.
 *  • It is a SUGGESTION, not a validation. The studio may refund less (a
 *    cancellation fee) or more (goodwill); both are its call. The only ceiling
 *    is what is left refundable on the charge, which the caller checks.
 */
export function proRataMinor(
  totalMinor: number,
  remainingUnits: number,
  grantedUnits: number
): number {
  if (!Number.isFinite(totalMinor) || totalMinor <= 0) return 0
  if (!Number.isFinite(grantedUnits) || grantedUnits <= 0) return 0
  if (!Number.isFinite(remainingUnits) || remainingUnits <= 0) return 0
  const remaining = Math.min(remainingUnits, grantedUnits)
  return Math.floor((totalMinor * remaining) / grantedUnits)
}
