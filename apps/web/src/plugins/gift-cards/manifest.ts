import type { PluginManifest } from '@linyup/shared'

// Gift Cards — sell and mint gift cards, redeemable against anything the studio
// charges for.
//
// WHY A PLUGIN AND NOT A SETTING: it was the biggest first-impression offender
// precisely because it was ungated — every new studio saw a gift-card section
// in Payments before it had a single member. Selling gift cards is a conscious,
// often seasonal decision, which is exactly the shape an install toggle fits.
//
// `minPlan: 'free'` with no `addon` resolves to `included` on every plan
// (pluginAccessForPlan), which PRESERVES today's availability exactly — this
// change adds a step, never a paywall. Making it a paid Coach add-on is a
// plausible future move; it needs a price decision and a `scripts/stripe-sync.ts`
// run, so it is deliberately not made here.
//
// THE GATE IS ON SELLING AND MINTING, NEVER ON REDEEMING. An outstanding gift
// card is money the studio already took, and uninstalling a plugin must not
// void it — see connect/giftCards.ts.
export const giftCardsManifest: PluginManifest = {
  id: 'gift-cards',
  nameKey: 'giftCardsName',
  descriptionKey: 'giftCardsDescription',
  category: 'commerce',
  minPlan: 'free',
  status: 'available',
  iconName: 'Gift',
  // No nav contribution: gift cards are a section of the Payments page, not a
  // page of their own, so installing adds no sidebar clutter either.
}
