import type { PluginManifest } from '@linyup/shared'

// Promo Codes — discount campaigns applied as a Stage A price modifier.
//
// ONE ANSWER TO "WHY CAN'T I SEE THIS?". The plan requirement lives HERE, in
// `minPlan`, and nowhere else: `createPromoCode` used to also call
// `requirePlan(teamId, 'studio')`, which would have meant a Studio user could be
// refused by the plan gate OR the install gate and get a different explanation
// each time. That call is gone; the runtime gate is install state alone, which
// is how every other plugin-delivered feature behaves (Courses, Referrals — see
// plan.ts).
//
// `PROMO_CODE_LIMITS` (0/0/20/100) survives as the CEILING, not as a second
// door. Coach and Free sit at zero, which now simply agrees with `minPlan`
// rather than duplicating it.
//
// THE GATE IS ON CREATION ONLY, matching the plan gate it replaces: a live code
// stays previewable, reservable, committable and releasable after an uninstall,
// because a visitor part-way through a checkout did nothing wrong.
export const promoCodesManifest: PluginManifest = {
  id: 'promo-codes',
  nameKey: 'promoCodesName',
  descriptionKey: 'promoCodesDescription',
  category: 'commerce',
  minPlan: 'studio',
  status: 'available',
  iconName: 'BadgePercent',
  // No nav contribution: the entry lives in the built-in "Offer" section
  // (see (auth)/layout.tsx), shown only when installed — same as Products.
}
