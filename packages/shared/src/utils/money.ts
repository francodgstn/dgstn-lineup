// The ONE place for minor-unit money math. Every Connect checkout path (and the
// appointment discount clamp) derives its conversion and minimum-charge floor
// from here — never re-declare `50` or `Math.round(x * 100)` at a call site.
//
// Floor rule (codified 2026-07, matches long-standing behavior):
//  • AUTHORED prices below the floor are a configuration error → callers THROW
//    (see requireChargeableAmountFromMajor in functions/connect/checkout.ts);
//  • ARITHMETIC-DERIVED prices (percent discounts) CLAMP UP to the floor and are
//    never free — see resolveEffectiveAppointmentPrice.
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
