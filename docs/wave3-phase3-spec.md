# Wave 3 — Phase 3 implementation spec: PROMO CODES

Implementable spec produced by surveying the pricing resolver, the gift-card
code lifecycle and every purchase surface in this worktree, then reconciling
them against the resolved design in `docs/fareharbor-analysis.md` §7.
Predecessors: `docs/wave3-phase01-spec.md` (gift cards),
`docs/wave3-phase2-spec.md` (waitlist). Surrounding patterns:
`docs/waitlist.md`, `docs/appointments.md`, `docs/payment-contact-studio.md`,
`docs/accounting.md`.

> **Citations are pinned to commit `4b3177f` and were re-read on 2026-08-14.**
> Every `file:line` below was opened in this tree after Phase 2 landed. Line
> numbers in the three surveys that fed this document and in the earlier phase
> specs are pre-`4b3177f` in places — do not carry those forward; carry these.
>
> **Revision 2 (2026-08-14)** folds in three adversarial reviews (money,
> concurrency, product-and-abuse). Where they disagreed, §0.5 records which
> reading was followed and why. Nine claims in revision 1 were factually wrong
> against this tree; each is corrected in place and named in §0.5.

**Scope.** Promo codes on the ONE-OFF purchase rails: class drop-ins (including
the waitlist claim, which *is* a drop-in), appointments, courses and products.
Recurring memberships are out (§11). This is also the phase that repays a debt:
`createProductCheckout` bypasses `resolvePaymentOptions` entirely today, and a
promo on merchandise cannot exist without fixing that — the one genuine
one-resolver repair, which only promo requires
(`docs/fareharbor-analysis.md:463-466`).

**The governing rule, restated because everything below depends on it**
(`docs/fareharbor-analysis.md:350-352`, with the Stage A / Stage B block at
`:354-361`):

> A price **modifier** belongs in Stage A (inside `resolvePaymentOptions`).
> A **tender** belongs in Stage B (at the checkout callable). Nothing may be both.

A promo code is a MODIFIER: it changes the price. A gift card is a TENDER: it
pays a price. Getting this backwards is the single biggest way this phase goes
wrong, and §2 proves the separation holds for the case a user hits on day one —
a promo code *and* a gift card on the same purchase.

---

## 0. Ground truth

### 0.1 What exists that this phase builds on

| Piece | Where | What Phase 3 does with it |
|---|---|---|
| The ONE resolver | `packages/shared/src/utils/paymentOptions.ts:355` | Gains an optional third parameter and a fifth target arm |
| The discount math | `paymentOptions.ts:238-335` (`applyBenefitToPrice`) — `percent_off` at `:301-318`, `fixed_price` at `:320-333` | The clamp/round half is extracted and shared with the promo path. **`applyBenefitToPrice` no longer exists**: P3-C replaced it in place with `applyModifiers` and carved `priceAfterModifier` (the clamp/round site) and `resolveBenefitCandidate` (the benefit's half) out of it. Every mention of the old name in this document is pinned history — grep for the three new ones |
| Effect vocabulary | `packages/shared/src/types/benefit.ts:30` (`BenefitEffect`), `:32-41` (`Benefit`), `:48-67` (`normalizeBenefit`) | Reused verbatim; a promo uses `percent_off` \| `fixed_price` and **no new effect** |
| Effect allow-sets per arm | `paymentOptions.ts:337-351` (`APPOINTMENT_EFFECTS` / `DROP_IN_EFFECTS` / `COURSE_EFFECTS`) | Gains `PRODUCT_EFFECTS` and `PROMO_EFFECTS` in the same shape |
| Money core | `packages/shared/src/utils/money.ts` — `MIN_CHARGE_MINOR = 50` (`:15`), `MIN_CHARGE_MAJOR = 0.5` (`:18`), `round2Major` (`:34`); `packages/functions/src/connect/checkout.ts:41-48` (`requireChargeableAmountFromMajor`, authored → THROW) | Unchanged. Promo derives prices, so it CLAMPS; authored promo values THROW at creation |
| Snapshot loaders | `packages/functions/src/booking/access.ts:182` (`loadContactPaymentContext`), `:273` (`loadContactPaymentSnapshot`); `apps/web/src/lib/paymentSnapshot.ts:20`; `apps/web/src/lib/pricingSurface.ts:82` | Untouched — a promo is not a property of the contact (§2.1) |
| Reserve → commit → release, worked | `packages/functions/src/connect/giftCards.ts:201-266`, `:403-502`, `:658-677` | The **shape** is reused; the balance arithmetic is not (§0.4(b)) |
| Claim-first serialisation | `giftCards.ts:926-984` (`gift_card_issues`) | The idiom for "N claimants, one finite counter" |
| Lazy expiry, no sweep | `giftCards.ts:22-29`, `:99-108` (`dropExpiredHolds`) | Promo reservations expire lazily too — no sweep job |
| `tx.update`, never `set(merge)`, on a map field | `giftCards.ts:260-262`, repeated at `:369-375` and `:673-675` | Binding for the reservations map (N7) |
| Redemption UI | `apps/web/src/components/booking/GiftCardRedeemField.tsx` — `AppliedGiftCard` (`:30-34`), `apply()` (`:89-115`), `giftCardCheckoutErrorMessage` (`:58-69`) | The template for `PromoCodeField`, mounted **alongside**, never instead |
| Rate-limit buckets | `checkout.ts:163-189` (`checkoutRateLimit`), `:137-149` (`assertUnderCheckoutRateLimit`). Taken: default `'checkout'`, `'gift-buy'` (`giftCards.ts:707`), `'gift-check'` (`giftCards.ts:1035`), the waitlist bucket (`dropIn.ts:149-153`, `claim.ts:76`) | A new `'promo-check'` bucket |
| Stage A → Stage B seam, already correct | `dropIn.ts:467` → `:552`; `payments.ts:723-725` → `:749-758`; `payments.ts:505-506` (the exception) | Proof the gift-card call sites need **no edit** (§2.5) |
| One-writer counter discipline | `docs/wave3-phase2-spec.md` §1 invariant 7 | Applied verbatim to `usage_count` (N8) |
| Plan gate | `packages/functions/src/utils/plan.ts:19-44` (`requirePlan`), whose docblock (`:11-17`) requires public callers to map `plan_required` / `plan_inactive` | Creation only (N16) |
| Per-plan cap precedent | `packages/shared/src/types/product.ts:77-86` (`PRODUCT_LIMITS` / `getProductLimits`) | `PROMO_CODE_LIMITS` in the same shape |
| Test gate | `packages/functions/src/booking/paymentOptions.test.ts` — `runRows` at `:34-40`, one whole-object `assert.deepEqual` per row (`:37`), 60 rows over six `describe` blocks | Must stay green **unchanged**; new blocks are added (§9 GROUP A) |

**Baseline gates, measured in this tree on 2026-08-14:**
`pnpm --filter @linyup/functions test` → **551 passing / 8 pending / 0 failing**.
`pnpm typecheck` 6/6, `pnpm lint` 0 errors.

### 0.2 The four hooks Phases 0–2 deliberately left for this phase

1. **`checkoutRateLimit(ip, prefix, limitPerHour)`** — the `prefix` parameter was
   added in Phase 0 explicitly so a promo preview gets its own bucket
   (`checkout.ts:163-189`, and the docblock at `:150-162` states the reason in
   as many words: one shared counter means a burst from a gym NAT locks the same
   IP out of an unrelated public surface).
2. **`details: { reason }` on every refusal** — Phase 2's P2-A made this the
   vocabulary every public page renders. Promo refusals join it (§7.3).
3. **The waitlist claim page is the one surface that resolves money for a
   waitlisted seat.** `claim.ts:211-215` already says in a comment that the page
   "takes a gift card **or a promo**"; `docs/wave3-phase2-spec.md` §8 hook 1 says
   Phase 3 adds a promo field "to it and nothing else changes". A comment is not
   a decision, though: this rail has the longest and only studio-configurable
   checkout window, and its session deadline cannot be shortened without
   re-breaking Phase 2's one-deadline invariant, so a code applied here locks a
   use for the whole claim window (§5.3). **§10 Q11** asks for an explicit yes.
4. **`commitGiftCardDrawdown({ promoRedemptionId })`** — declared, unused, at
   `giftCards.ts:418-427`. **This phase deletes it.** See §0.4(a): it is a trap,
   and Phase 2 already killed its sibling for the same reason.

### 0.3 Pre-existing bugs this design pass uncovered

None of these are promo features. All were live at `4b3177f` and each was
confirmed against the code, not inferred. Phase 2 found five and fixing them
alongside was the right call; the same applies here — B1, B2, B3, B3b and B7 are
all on the exact code paths Phase 3 rewrites, so fixing them elsewhere would mean
touching the same lines twice. B3b and B7 were surfaced by the adversarial
reviews of revision 1 and are new here.

---

**B1 — a `fixed_price` member benefit ABOVE the base price makes the customer
pay MORE.** `paymentOptions.ts:320-333` returns
`Math.max(MIN_CHARGE_MAJOR, benefit.amount)` with **no comparison against
`base`**. A drop-in priced at 25 with a member benefit of
`{effect: 'fixed_price', amount: 999}` charges the *member* 999 and the
non-member 25, and stamps `appliedBenefit` on it so the UI renders 25 struck
through above 999.

It is authorable today: `benefitAmountInvalid`
(`apps/web/src/components/pricing/BenefitEditor.tsx:83-88`) validates only
`amount >= 0.5`; there is no upper bound and no cross-check against the target's
price. No fixture pins the behaviour — the two `fixed_price` rows
(`paymentOptions.test.ts:423-441`, `:445-464`) are both *below* base — so the
fix is free of fixture churn.

**Fix (P3-C).** The winner-selection helper takes the base price as a candidate:
a benefit that would **raise** the price does not apply. This is the same helper
the promo needs (§3.2), so B1's fix and the promo's comparator are one piece of
code, not two.

**The equal-value case is decided deliberately, not as a side effect.** "Strictly
lower wins" would also drop a benefit priced *exactly at* base — a live and
ordinary configuration (a studio sets `{effect:'fixed_price', amount:25}` on an
activity whose drop-in is also 25.00, as a placeholder before it decides the
member rate). Dropping `appliedBenefit` there is a real behaviour change on
existing data: `/offer/pricing` stops rendering the member badge
(`pricingSurface.ts:180-185` reads `appliedBenefit` for `baseAmount` and
`viaTypeId`) and `createAppointmentCheckout` writes `subscription_type_id: null`
onto the booking (`appointments/checkout.ts:173`) where it previously recorded
which membership priced it.

So the comparator is **deliberately asymmetric**, and §3.2 states the rule:

- a **benefit** applies (and stamps `appliedBenefit`) whenever it does not
  RAISE the price — i.e. `benefitPrice <= base`;
- a **promo** applies (and stamps `appliedPromo`) only when it is **strictly
  lower** than the incumbent.

The asymmetry has a reason, not a preference: `appliedBenefit` answers *which
membership priced this booking* (provenance, read downstream), while
`appliedPromo` answers *did a code change the price* (an event). A benefit at
exactly base priced the booking; a promo at exactly base changed nothing.
Fixtures pin both (P3-E).

---

**B2 — `createProductCheckout` bypasses the resolver, and `PriceCell` already
carries the union member that proves it.**
`payments.ts:505-506` prices merchandise as
`resolveProductPrice(product, variantId)` → `requireChargeableAmountFromMajor`,
never entering `resolvePaymentOptions`. Meanwhile
`apps/web/src/lib/pricingSurface.ts:138` already declares
`source: 'base' | 'drop_in' | 'trial' | 'course_price' | 'product'` while
`PaymentOption['source']` (`paymentOptions.ts:129`) has no `'product'` member —
a dead union arm left behind by the same gap. Recorded in the settled design at
`docs/fareharbor-analysis.md:463-466`.

**Fix (P3-D).** The `product` arm, and `createProductCheckout` routed through
it. The dead union member becomes live.

---

**B3 — on a waitlist claim, the gift-card hold expires long before the Stripe
session it is guarding.** Introduced by Phase 2, which made the Stripe expiry
*variable* while the gift-card hold stayed a *constant*.

- `dropIn.ts:840-842` sets the Checkout Session's `expires_at` to
  `claimCheckout.expiresAtEpochSeconds`, i.e. `claim_expires_at`, clamped only
  by `STRIPE_MAX_CHECKOUT_EXPIRY_MINUTES` (24 h) —
  `resolveClaimCheckoutWindow`, `booking/waitlist/constants.ts:259-270`.
- `dropIn.ts:549-557` calls `reserveGiftCardDrawdown` **without** `holdMinutes`,
  so the hold takes `DEFAULT_HOLD_MINUTES = 35` (`giftCards.ts:72`).
- The default claim window is 120 minutes
  (`WAITLIST_DEFAULT_CLAIM_MINUTES`, `docs/wave3-phase2-spec.md` §3.3).

So on a default-configured waitlist claim paid by gift card, the hold dies at
+35 min and the session stays payable until +120 min. Between those, the held
value is available again (`giftCardAvailable` ignores expired holds,
`types/giftCard.ts:116-118`) and another purchase can spend it. When the claim's
payment lands, `commitGiftCardDrawdown` finds no hold and falls back to
`md.giftCardDrawdown` (`webhook.ts:946-951`) — either double-spending value the
other purchase already took, or clamping at zero (`applyGiftCardCommit`,
`types/giftCard.ts:162-168`) so the studio silently absorbs the difference.

**Fix (P3-B2).** Derive the hold window from the same instant the Stripe session
got, plus a margin — the generalisation of the existing 35-vs-31 ordering
(`giftCards.ts:72` vs `checkout.ts:98`). `reserveGiftCardDrawdown` already takes
`holdMinutes?: number` (`giftCards.ts:206`), so this is a call-site change.
Phase 3 needs the identical rule for its own reservation (N9), which is why it
lands here rather than as a stray patch.

---

**B3b — the plain product and course checkouts take Stripe's 24-hour default,
and revision 1 of this spec asserted the opposite.** All three reviews caught
this and they are right; the claim "their sessions are fixed at 31 minutes" was
false and every timer conclusion built on it was wrong.

`SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES` reaches `startOneOffCheckout` **only inside
the gift-card sub-branches** — `payments.ts:585` (product) and `payments.ts:806`
(course). The plain branches (`payments.ts:602-614`, `payments.ts:823-835`) pass
no `expiresAtEpochSeconds` at all, so Stripe applies its documented 24-hour
default, which `checkout.ts:92-98`'s own docblock states. The drop-in rail closed
this hole in Phase 2 for itself only — `dropIn.ts:826-842`'s comment says so:
*"the plain path was the 24-hour hole"*.

**Fix (P3-B2).** Any one-off checkout that carries a **reservation of a finite
thing** — a gift-card hold, a promo reservation, or both — gets a SHORT expiry.
The promo-carrying product/course branches therefore pass
`expiresAtEpochSeconds` exactly as the gift-card branches already do. The
no-instrument path keeps its 24 hours untouched. §5.3 states the resulting rule
two-sidedly, and §10 Q10 puts the customer-facing half of it (a code shortens the
payment window from 24 h to ~31 min) to Franco.

---

**B7 — `releaseReservedGiftCard`'s own comment names a caller that does not
exist.** `dropIn.ts:535-537` says it is *"Called on EVERY failure after the
reservation — the capacity refusal below as well as a Stripe failure"*. The
capacity refusal is at `dropIn.ts:515-519`, **above** the helper's definition at
`:538`, and it precedes the gift-card reservation entirely; the only callers are
`:638`, `:767` and `:847`. Phase 2 moved the capacity pre-flight above the
reservation (P2-C, correctly) and left the comment behind.

Cosmetic today, load-bearing tomorrow: this is the third live instance of §8.1
shape 3 in this tree, and revision 1 of this spec cited that stale comment as
evidence for where the promo release should go (§5.3), which is how a wrong
comment becomes a wrong design. **Fixed in P3-H**, in the same edit that
introduces `releaseReservedPromo`.

---

**B4 — the gift-card hold-key comments assert a precondition the code does not
establish.** `packages/shared/src/types/giftCard.ts:76` says holds are *"keyed
by Stripe Checkout Session id"*, and the file header repeats it at `:13-15`. All
three call sites mint the key with `generateSecureToken(16)` **before any Stripe
session exists** — `payments.ts:535`, `payments.ts:750`, `dropIn.ts:548`. The
comments are stale.

This matters here beyond hygiene: it is the exact Phase-2 failure shape
("comments asserting preconditions the code did not establish"), and the promo
reservation faces the same ordering constraint — its key must also be
caller-minted, because the session it will be committed against does not exist
yet. **Fix the comments in P3-A**, in the same commit that lifts the shared code
normaliser, so the next reader is not misled into keying a promo reservation off
a session id.

---

**B5 — `MemberPayment.kind` is narrower than what the webhook writes.**
`packages/shared/src/types/connect.ts:189` declares
`kind?: 'product' | 'course' | 'drop_in' | 'membership'`. `handlePaymentIntent`
is the ONLY writer of that field, and it writes **three** members the union does
not have: `'appointment'` (`webhook.ts:510`), `'gift_card'` (`:517`) and
`'policy_fee'` (`:520`). Revision 1 named only two of the three.

**Widen the union in P3-M to all seven**, and record on the line that the union
is derived from `webhook.ts:472-520` — the single writer — so the next reader
checks the source rather than the last spec. Do not invent behaviour around it.

**B6 — `mapCategory` has no `'appointment'` case** (`types/finance.ts:205-224`),
so appointment revenue lands in `'other'`. Harmless for promo (a promo writes no
journal row — §6) and out of scope, but named here so the next reader does not
assume Phase 3 blessed it.

### 0.4 Where a source or a survey is mistaken (evidence cited)

**(a) The `promoRedemptionId` rider at `giftCards.ts:418-427` must be DELETED,
not implemented — and its own comment already contains the disproof.** The
comment says *"A rider only fits here when it must happen AFTER the money
moves"*. Three reasons it does not fit, in ascending order of decisiveness:

1. `commitGiftCardDrawdown` returns early when `!outcome || committedMajor <= 0`
   (`giftCards.ts:430-432`) — anything placed after that never runs for a card
   with nothing left to commit.
2. It returns early again for an `admin_comp` card (`giftCards.ts:466`) — a
   comped full-cover purchase is an ordinary case.
3. **Decisive:** it only runs when a gift-card code was supplied at all —
   `webhook.ts:946` gates on `md.giftCardCode && md.giftCardHold`, and each
   callable branch gates on `data.giftCardCode` (`payments.ts:534`,
   `payments.ts:749`, `dropIn.ts:547`). A promo used *without* a gift card — the
   overwhelmingly common case — would **never commit its reservation**, and the
   reservation would silently lapse while the customer got the discount. That is
   a give-away-the-discount-and-lose-the-count bug with no error and no alarm.

`docs/wave3-phase2-spec.md` §0.3(c) reached exactly this conclusion for
`waitlistEntryId` and removed it. Phase 3 does the same for its own rider and
records why on the line where it stood, so nobody re-adds a third.

**(b) Survey 2 is right that the gift-card *balance arithmetic* must not be
reused, and wrong on one detail: the currency guard.** `planGiftCardRedemption`,
`applyGiftCardCommit`, the depleted↔active resurrection and the reclass pair are
all balance mechanics with no promo analogue — correct, and §11 records them as
out of scope. But the survey concludes that
`reserveGiftCardDrawdown`'s currency tripwire (`giftCards.ts:236-244`) would be
"cargo-culting" for promo, on the grounds that a promo is "applied to a price
already in the team's currency". That holds for `percent_off` — a percentage has
no currency — and **fails for `fixed_price`**, which is an authored money amount
stored at creation time and applied at redemption time. Those are two reads of
`team.default_currency` at two different moments, and a team that changes its
currency between them gets a `fixed_price` promo applied 1:1 across currencies —
the identical failure the card's tripwire exists to stop. So: stamp `currency`
on the promo doc at creation and guard **only** the `fixed_price` path (N12).

**(c) Survey 3's read that promo authoring should follow the Products pattern
(client `addDoc`/`updateDoc`, `firestore.rules:526-531`) is rejected.** Products
are authored content with no global counter. A promo carries `usage_count`, a
`max_uses` cap and a plan-tiered creation gate; a client write bypasses all
three, and "these fields yes, that field no" rules are exactly the fragile
surface this codebase has avoided on every coded instrument (`gift_cards`
`allow write: if false`, `firestore.rules:610-611`; `referral_codes` read+write
false, `firestore.rules:1206-1209`). Writes go through manager callables (§1.1,
N14).

### 0.5 Adjudication record — where the three reviews disagreed

Revision 2 folds in three adversarial reviews. Most findings were unanimous or
non-overlapping; these are the ones where a choice had to be made, and the one
place I pushed back.

| Question | money | concurrency | product-and-abuse | Followed, and why |
|---|---|---|---|---|
| Where the promo commits, given four system-initiated auto-refunds | move it after the dispatch **or** add reversals beside `reverseGiftCardDrawdown` | — | — | **Neither, exactly: commit at each per-kind CONFIRM point.** "After the dispatch" is unreachable — every handler `return`s internally. A reversal would be a **second writer of `usage_count`**, the §8.1 shape-2 defect this phase exists to foreclose. Committing at the confirm point keeps one writer and makes the rule true by construction: *a use is consumed by a completed sale, never by an attempt* (§5.2) |
| The reservation window | "decide explicitly: short expiry (needs sign-off) **or** a hard cap re-check at commit" | "make every promo-carrying checkout pass a SHORT expiry; state the invariant as *never exceeds SHORT_HOLD + MARGIN*" | same as concurrency | **concurrency + abuse (2 of 3), plus money's cap re-check as a tripwire.** N9 becomes two-sided (§5.3). The one exception is the waitlist claim, which keeps its own deadline — clamping it would re-break Phase 2's one-deadline invariant, a worse trade — and the resulting lock length is stated and put to Franco (§10 Q11) |
| The retry that refuses its own buyer | deterministic key **or** exclude the caller's own live reservations | deterministic key (preferred) or exclude | — | **Deterministic key** — both reviews' first choice, and it fixes the global cap too (a retry cannot take a second slot). §5.1 |
| What identity the per-contact cap binds to | "state it is advisory **or** key on normalised email" | same | "key the cap on normalised email — a second doc get, so the phantom-free read set survives" | **abuse's fix, implemented as ONE doc, not two.** The redemption doc id becomes an `identityKey` derived from the normalised email (falling back to `contactId`), so the read set stays at **two** single-doc gets rather than three. §5.1 |
| The `committed` map | — | "drop it, or bound it to ~7 days" | — | **Dropped entirely.** Replay on the Stripe path is already guaranteed by the `connect_webhook_events` ledger (`webhook.ts:2026-2038`), which claims the event id *before* dispatch; the full-cover path runs once, synchronously, inside a callable. Dropping it also removes the deterministic key's only collision hazard. §5.2 |
| Audience scoping ("new customers only") | — | — | add it, or at least ask | **Asked, not built (§10 Q12), with the cheapest definition named.** A field whose semantics nobody has agreed is worse than no field; but the question is put prominently because retrofitting it after codes are live is a semantic change to live data |

**Where I pushed back, and on what evidence.** Nothing was rejected outright,
but two findings are narrower than they read:

1. money's BLOCKER 1 says the four auto-refund branches "each already restore the
   gift card via `reverseGiftCardDrawdown`". Only **two** do — the drop-in
   duplicate (`webhook.ts:1464`) and the drop-in oversell (`:1592`). The two
   appointment branches (`apt-dup:` at `:1717`, `apt-refund:` at `:1863`) restore
   nothing, because appointments take no gift card by design (§2.6). The
   *conclusion* stands unchanged and is adopted in full — all four refund the
   whole charge, so on all four the purchase provably did not happen.
2. money's MINOR on the finance gate is correct and adopted, and its parenthetical
   is worth keeping: the §6 argument itself survived all three reviews intact.
   The gross is `pi.amount` post-promo, `computePlatformFee` is applied to the
   post-promo post-drawdown amount, and `gross + stripe_fee + platform_fee ===
   net` holds on every traced path. **§6 is not relitigated.**

**Factual corrections carried from revision 1** (each verified in this tree, each
fixed in place): the plain product/course session expiry (B3b); the
`MemberPayment.kind` inventory (B5); the rounding worked example (§4); the
`releaseReservedGiftCard` call-site citation (B7); the count of resolver call
sites in `createDropInCheckout` (§9 P3-H); the claim that `willCharge` excludes a
priced trial (§7.2); the claim that the member and promo breakdown rows are
structurally exclusive on the client (§7.2); the claim that
`promoGlobalUsesLeft` decides the whole cap boundary (§5.6); and the finance
checklist line that forbade a `gift_card` reclass on the flagship case (§12).

---

## 1. The model

### 1.1 Where it lives, and why

```
teams/{teamId}/promo_codes/{CODE}                           ← the doc id IS the code
teams/{teamId}/promo_codes/{CODE}/redemptions/{identityKey} ← durable per-PERSON ledger
```

**The ledger is keyed by identity, not by `contactId`, and that is a correction.**
Revision 1 keyed it on `contactId` and described the per-contact cap as an
enforced "once per person" guarantee. It is not: on the two rails a guest can
reach, the contact document is minted **by the visitor, for free, at purchase
time**. `createDropInCheckout` reuses an existing contact only on an exact
`teamId + email + lowercased firstname + lowercased lastname` match
(`dropIn.ts:396-407`) and otherwise creates a new one (`:429-447`);
`resolveOrCreateAppointmentContact` matches on email alone and otherwise creates
(`appointments/booking.ts:311-315`). So `contactId` makes the cap "once per
(email, exact name) tuple" on drop-ins — "Ann Smith" and "A. Smith" are two
people — while App Check is monitor-only by default (`utils/appCheck.ts:14`), so
the probe is scriptable.

```ts
/** The strongest identity a one-off purchase rail actually has. Email, because
 *  every rail collects one and every rail normalises it the same way
 *  (lowercase + trim). Hashed so the ledger's DOC IDS are not a harvestable
 *  list of a studio's customer emails, and hex so the id is always safe as a
 *  Firestore doc id, a map key and a FieldPath segment. */
export function promoIdentityKey(input: { email?: string | null; contactId: string }): string
// email present → 'e_' + sha256(lowercase(trim(email))).slice(0, 32)
// else           → 'c_' + contactId
```

Two things this does and does not buy, stated so nobody over-claims it again:

- **It does** make the cap bind across the name-spelling evasion, across a
  contact document deleted and recreated (`purgeProvisionalContacts` runs
  nightly), and across the same person arriving signed-in on one purchase and as
  a guest on the next.
- **It does not** make the cap unforgeable. A second mailbox, or a `+1` alias, is
  a different identity. That residual is stated in the admin UI copy
  (`perContactHint`, §7.6) — *"counted per email address; pair a public code with
  a total cap"* — rather than being presented as a guarantee, and §10 Q13 asks
  whether guest-reachable codes should carry a per-contact cap at all.

`clearPromoRedemption` (§5.4) therefore takes `{ code, contactId }` **or**
`{ code, email }` and resolves the same key from either.

Add to `packages/shared/src/paths.ts`, beside `GIFT_CARDS_SUBCOLLECTION`
(`:195`) and `GIFT_CARD_ISSUES_SUBCOLLECTION` (`:200`):

```ts
export const PROMO_CODES_SUBCOLLECTION = 'promo_codes'
export const PROMO_REDEMPTIONS_SUBCOLLECTION = 'redemptions'
```

Both are nested under `teams/`, so **no `tenantData.ts` registration is
required** — the completeness test classifies top-level `*_COLLECTION`
constants only (`packages/shared/src/tenantData.ts:6-9`), and per-team teardown
uses `db.recursiveDelete`. Same finding as `docs/wave3-phase2-spec.md` §0.2 #15;
do not add a constant to `tenantData.ts`.

**Is the code the doc id, as with gift cards? Yes — for the dedupe, not for the
secrecy.** The reasons diverge and the divergence is load-bearing:

| | Gift card | Promo code |
|---|---|---|
| Doc id is the code | Yes | **Yes** — free case-insensitive dedupe, no lookup query, no index, no query-then-write race |
| Is it a secret? | **Yes** — it is stored value; `firestore.rules:609-612` denies public reads | **No** — it is printed on a flyer. But the *doc* still is not public (it carries `max_uses`, `usage_count`, internal labels, and lists every code a scraper could harvest) |
| Public read path | `checkGiftCard` callable only | `previewPromoCode` callable only |
| Who may write | Nobody (Admin SDK) | Nobody (Admin SDK) — manager callables (§0.4(c)) |
| Collision handling | **Retry with a new random code** (`giftCards.ts:160-188`) | **Refuse** — `already-exists`, `reason: 'code_taken'` |

**The collision rule is where copying the gift card would be a bug.** A gift
card's code is *generated*, so minting a different one on collision is correct.
A promo code is *chosen by a manager* — silently minting `SUMMER26-X7` when they
typed `SUMMER26` would put a code on the flyer that nobody can redeem. So:
`.create()`, and `ALREADY_EXISTS` (gRPC code 6) is a **user-facing refusal**, not
a retry.

**Case sensitivity.** Codes are case- and space-insensitive to the visitor and
canonically uppercase on disk — the identical rule gift cards already use.
`normalizeCode` (`giftCards.ts:83-85`) is module-private today; **P3-A lifts it**
to `packages/shared/src/utils/codes.ts` as
`normalizeRedemptionCode(raw): string` and has `giftCards.ts` delegate, so the
two instruments can never fork on what "the same code" means.

**Format.** After normalisation: `/^[A-Z0-9][A-Z0-9-]{2,23}$/` (3–24 chars,
uppercase alphanumerics and hyphens, no leading hyphen). Additionally, a code
matching `/^GC-/` is **refused at creation** and reported distinctly by the
preview (`reason: 'looks_like_gift_card'`), because a visitor pasting a gift card
into the promo field is a real event and "invalid code" is the wrong answer to
it.

### 1.2 The type

`packages/shared/src/types/promoCode.ts`, exported from
`packages/shared/src/index.ts` beside `./types/benefit` and `./types/giftCard`
(currently lines 48-49). Pure helpers live in the file with the type, exactly as
`giftCardAvailable` / `planGiftCardRedemption` / `applyGiftCardCommit` do
(`types/giftCard.ts:111`, `:135`, `:162`) — crypto and Firestore stay out.

```ts
import type { Timestamp } from './common'
import type { BenefitEffect } from './benefit'

/** A promo is a MODIFIER, so only the price-modifying half of the Benefit
 *  vocabulary applies. 'included' and 'spend_credits' are coverage answers —
 *  a promo that made a booking free would bypass the 0.50 charge floor and
 *  invent a payment-less purchase path (§4). */
export type PromoEffect = Extract<BenefitEffect, 'percent_off' | 'fixed_price'>

export type PromoCodeStatus = 'active' | 'disabled'

/** WHICH rails a code may be typed into. Deliberately coarse: these are the
 *  four one-off checkouts, not entity ids. Entity-level narrowing is the
 *  optional *_ids allow-lists below. */
export type PromoScopeKind = 'drop_in' | 'appointment' | 'course' | 'product'

export interface PromoReservation {
  /** The buying contact — AUTHORITATIVE for the commit (§5.2), because the
   *  callable that minted this reservation knew exactly who was buying, while
   *  the webhook may not (the contact can be purged before the payment lands). */
  contactId: string
  /** promoIdentityKey(...) — what BOTH caps are counted against (§1.1). */
  identityKey: string
  /** Bounded on BOTH sides (N9): at or after the Checkout Session this
   *  reservation guards, and never more than PROMO_RESERVATION_MARGIN_MINUTES
   *  past it.
   *  CORRECTED post-implementation: the promo's upper bound is
   *  PROMO_RESERVATION_BACKSTOP_MINUTES (60), not the gift card's 4 — see the
   *  N9 correction. The shipped shape also carries `sessionId`, the ONE
   *  Checkout Session that may be paid against this slot (§5.2 CORRECTION 2). */
  expires_at: Timestamp
  /** The quoted price at reservation time, in major units. AUDIT ONLY — never
   *  read for a decision. (Revision 1's comment here claimed it prevented a
   *  commit booking a different figure; nothing implemented that comparison, and
   *  nothing needs to: the price the caller was shown is enforced at the
   *  callable by the `quotedAmount` guard, §2.4, BEFORE anything is reserved.) */
  amountMajor: number
  /** The list price the discount was taken from. Audit only, same rule. */
  baseAmount: number
  /** Reservation → purchase, so the admin list can say WHAT is in checkout. */
  targetKey: string
}

export interface PromoCode {
  /** The redeemable code, also the doc id (canonical uppercase). */
  code: string
  teamId: string
  status: PromoCodeStatus

  // ── The discount ──
  effect: PromoEffect
  /** percent_off only: integer 1–99. 100 is not expressible — see §4. */
  percent?: number
  /** fixed_price only: "this thing costs X with this code", major units ≥ 0.50. */
  amount?: number
  /** Stamped at creation from giftCardCurrency(team.default_currency).
   *  Guarded at reserve time for fixed_price ONLY — §0.4(b), N12. */
  currency?: string

  // ── The window ──
  valid_from?: Timestamp | null   // absent ⇒ open-ended in the past
  valid_until?: Timestamp | null  // absent ⇒ never expires

  // ── The caps ──
  /** Global cap, counted against COMMITTED + LIVE RESERVATIONS (§5.1).
   *  REQUIRED at creation: `null` means unlimited and must be chosen
   *  explicitly, because an uncapped code that leaks is unbounded liability
   *  with no alert behind it (§7.1, §8.1 shape 4). */
  max_uses: number | null
  /** Per-IDENTITY cap (§1.1), not per contact document. Absent ⇒ 1 (a code is
   *  an offer to a person, not a standing discount). null = unlimited. */
  max_uses_per_contact?: number | null
  /** Bind the code to ONE person — the service-recovery shape ("sorry you got
   *  bumped, here's 20% off"), which is the most common manual discount a
   *  studio issues and had no expression at all in revision 1. When set, the
   *  reserve refuses any other caller and the preview reports a bare `invalid`
   *  (never "this code is not yours" — that would confirm the code exists to
   *  whoever guessed it). */
  restrict_to_contact_id?: string | null
  /** WHO the code is for. Added by the §10 Q12 decision, which post-dates the
   *  rest of this block — §1.2 as written had no audience axis. Absent ⇒ 'all'.
   *  Built in P3-B (field + predicate), P3-G (loader + refusal), P3-K (admin
   *  UI), P3-L (copy) and P3-N (keys). */
  audience?: PromoAudience
  /** Committed redemptions. Written by ONE transaction, as an absolute value
   *  from its own read set. NEVER FieldValue.increment — see N8. */
  usage_count: number

  // ── What it applies to ──
  applies_to: PromoScopeKind[]          // non-empty
  activity_ids?: string[] | null        // null/absent ⇒ every activity of the listed kinds
  course_ids?: string[] | null
  product_ids?: string[] | null

  // ── Redemption lifecycle state ──
  /** Live reservations ONLY. Keyed deterministically (§5.1), so one person can
   *  hold at most ONE reservation per target — which is what makes a retry a
   *  refresh rather than a second use, and what bounds this map's size (N20).
   *  There is NO `committed` map: see §5.2 for why replay protection does not
   *  need one, and why revision 1's version was an unbounded field. */
  reservations?: Record<string, PromoReservation>

  // ── Audit ──
  label?: string | null                 // internal note ("autumn flyer")
  created_at?: Timestamp
  updated_at?: Timestamp
  created_by?: string | null            // uid
  created_by_name?: string | null       // snapshot, survives a rename
  disabled_at?: Timestamp | null
}

/** One durable row per PERSON —
 *  teams/{t}/promo_codes/{CODE}/redemptions/{identityKey} (§1.1).
 *  This subcollection is the per-person cap's ONLY source of truth; the promo
 *  doc holds no committed history at all (§5.2). */
export interface PromoRedemption {
  teamId: string
  code: string
  identityKey: string
  /** The most recent contact doc this identity resolved to — for the admin list
   *  and for clearPromoRedemption. Never the cap's key. */
  contactId: string
  /** Committed redemptions by this identity. Absolute write, one writer. */
  count: number
  first_at: Timestamp
  last_at: Timestamp
  /** Denormalised for the admin list; never read for a decision. */
  last_amount_major?: number
  last_target?: PromoScopeKind
}
```

Pure helpers in the same file. **Four signatures below were corrected against
the code while building P3-B; the corrections are marked and are what shipped:**

```ts
export function promoWindowOpen(p: Pick<PromoCode,'valid_from'|'valid_until'>, nowMs: number): boolean
// CORRECTED: returns a MAP, not a list. §5.1's own transaction body indexes it
// by key (`live[reservationKey]`) and spreads it (`{...live, [key]: …}`), and
// the idiom it says to follow — dropExpiredHolds — returns a map too.
export function promoLiveReservations(p: Pick<PromoCode,'reservations'>, nowMs: number): Record<string, PromoReservation>
export function promoAppliesTo(p: PromoCode, scope: PromoTargetScope): boolean
// AND the audience half, which needs the CALLER, not the target (§10 Q12).
// `joined` is exactly ContactPaymentSnapshot.joined — the same fact the
// `members` access rule runs on, deliberately not a second definition.
export function promoAudienceMatches(p: Pick<PromoCode,'audience'>, caller: { joined: boolean }): boolean
export function promoModifier(p: PromoCode): PromoModifier                  // the resolver's input (§2.1)
// CORRECTED: both key derivations TAKE a hasher rather than importing one.
// This module ships to the browser through the shared barrel, so it cannot
// import node:crypto — the same split formatGiftCardCode uses for its random
// bytes. The one implementation is `sha256Hex` in functions/utils/crypto.ts.
export type Sha256Hex = (input: string) => string
export function promoIdentityKey(i: { email?: string|null; contactId: string }, sha256Hex: Sha256Hex): string   // §1.1
export function promoReservationKey(i: { code: string; identityKey: string; targetKey: string }, sha256Hex: Sha256Hex): string

/** THE cap predicate — the WHOLE boundary, both halves, one expression.
 *  Revision 1 had `promoGlobalUsesLeft(p, nowMs)` and then re-derived the
 *  per-person half inline in the transaction and again in the preview, which is
 *  exactly the §8.1 shape-1 defect it claimed to foreclose: two answers to
 *  "has this person used it, counting a live-but-unpaid reservation?".
 *  Infinity on either field means uncapped. */
// CORRECTED: a fifth, optional parameter — the caller's OWN reservation key for
// the target they are buying. Without it the helper cannot express the property
// P3-B's own verify list demands ("the caller's own live reservation does not
// count against them"): the transaction gets that from checking REFRESH first,
// but the PREVIEW has no such ordering, so a visitor who reached Stripe and came
// back would be told `promo_already_used` for the purchase she is holding.
export function promoUsesLeft(
  p: PromoCode,
  nowMs: number,
  identityKey: string,
  perIdentityCommitted: number,
  excludeReservationKey?: string | null
): { global: number; perIdentity: number; liveTotal: number }

export interface PromoTargetScope {
  kind: PromoScopeKind
  activityId?: string | null
  courseId?: string | null
  productId?: string | null
  /** True for the paid-trial door. A trial NEVER takes a promo — §3.4. */
  isTrial?: boolean
}

/** Hard ceiling on LIVE reservations for one code, independent of max_uses.
 *  Without it a capped campaign can be held permanently exhausted for free:
 *  reservations cost nothing to create, count toward max_uses, and the rate
 *  limit is 30/hour/IP (CHECKOUT_RATE_LIMIT_PER_HOUR, checkout.ts:108). With
 *  the identity key (§1.1) each concurrent reservation costs a distinct email,
 *  and this bounds the promo document's size besides (N20). */
export const PROMO_MAX_LIVE_RESERVATIONS = 25
```

> **CORRECTION (post-implementation) — "each concurrent reservation costs a
> distinct email" is FALSE as a general claim, and the shipped docblock says so.**
> It holds only at the DEFAULT `max_uses_per_contact` of 1, where a second live
> reservation by the same identity drives `promoUsesLeft().perIdentity` to 0 and
> is refused whatever the target. At any finite N one email may hold N, and at
> `null` — "unlimited per person", which the admin form offers as a checkbox —
> `perIdentity` is `Infinity`, so ONE email can hold up to this ceiling by
> starting checkouts on that many different sessions/products. The same wording
> is repeated at §5.1 and §10 Q9 below; read all three against this note.
>
> **The value stays 25.** The size half of its job (≈5 KB, forever) is
> unconditional; the abuse half is carried by things an unlimited per-person cap
> does not weaken — a reservation is only taken inside a checkout callable (the
> preview reserves nothing), each costs a Stripe Checkout Session, the rate limit
> is 30/hour/IP, and every window is short — so the residual is a transient
> denial that self-heals on expiry, never an over-issue (Q9's direction). If it
> ever needs closing, the fix is a per-identity LIVE ceiling (`promoUsesLeft`
> already counts `liveForIdentity`), not a smaller number here.

**`promoUsesLeft` is the single expression of both caps**, and the reserve
transaction, the preview and the admin list all call it, so the boundary case
("the last use is reserved but not yet paid") is answered once, not three times
(§8.1 shape 1). Its `global` arm counts **committed + live reservations**;
§10 Q9 puts the *direction* of that choice (refuse vs. bounded over-issue) to
Franco, because it is a business call and both directions are cheap to hold.

### 1.3 What it applies to, and what it never touches

| Rail | Callable | Promo in v1? |
|---|---|---|
| Class drop-in | `createDropInCheckout` (`booking/dropIn.ts:97`) | **Yes** — `applies_to: 'drop_in'` |
| Waitlist claim (paid) | `createDropInCheckout({ waitlistToken })` | **Yes** — it *is* a drop-in; no separate scope kind |
| Paid trial | `createDropInCheckout({ trial: true })` | **No** — §3.4 |
| Appointment | `createAppointmentCheckout` (`appointments/checkout.ts:37`) | **Yes** |
| Course (purchase tier) | `createCourseCheckout` (`payments.ts:624`) | **Yes** |
| Product | `createProductCheckout` (`payments.ts:447`) | **Yes** — requires the new arm (B2) |
| Membership, one-off | `createMembershipPayment` (`payments.ts:182`) | **No** — §10 Q8 |
| Membership, recurring | `createMembershipCheckout` (`payments.ts:288`) → `startSubscriptionCheckout` (`:409-423`) | **No** — a modifier on a Stripe subscription is a Stripe *coupon*, not an amount we compute (§11) |
| Gift-card purchase | `createGiftCardCheckout` (`giftCards.ts:687`) | **No** — a discount on stored value mints value the studio was not paid for; `createGiftCardCheckout` already refuses a gift card for the same reason (`:696-699`) |
| Free class booking | `bookSession` | **No** — nothing to discount; the `class_booking` arm never prices (§2.2) |

**Exclusions inside a permitted rail.** A promo scoped to `drop_in` still does
not apply when the target is the trial door (`asTrial === true`), and a promo
listing `product` on a team without the products plugin is simply never reached.
Both are structural, not checks to remember.

### 1.4 Plan caps

`packages/shared/src/types/promoCode.ts`, in the shape of `PRODUCT_LIMITS`
(`types/product.ts:77-86`):

```ts
export const PROMO_CODE_LIMITS: Record<SaasPlan, { maxActiveCodes: number }> = {
  free:         { maxActiveCodes: 0 },
  coach:        { maxActiveCodes: 0 },
  studio:       { maxActiveCodes: 20 },
  organization: { maxActiveCodes: 100 },
}
export function getPromoCodeLimits(plan: SaasPlan | null): { maxActiveCodes: number }
```

Zero on free/coach is the same statement as the `requirePlan(teamId, 'studio')`
gate, expressed as data so the client can render "0 of 20" without a second
rule. §10 Q3 asks Franco to confirm the numbers and whether Coach should get a
small non-zero allowance instead of zero.

### 1.5 What a promo is NOT

Recorded because each of these is a thing the gift-card machinery does that a
promo must not inherit (Survey 2 §6, adopted):

- **Not stored value.** No balance, no `planGiftCardRedemption`, no depleted
  status, no `voidGiftCardValue` / `unvoidGiftCard`, no
  `reverseGiftCardDrawdown`. A promo reservation is a **slot**: taken, released
  or consumed.
- **Not a tender.** It never appears in the residual split and never reaches
  `applyPaymentEffects(..., source: 'gift_card')`.
- **Not a journal event.** No `FinanceCategory` member, no reclass pair, no
  `finance_transactions` row (§6).
- **Not sold.** No purchase payment intent, no `issue_kind`, no
  `payment_event_id`, no comp-vs-paid axis, no `MAX_ISSUE_AMOUNT_MAJOR`.
- **Not refundable.** Refunding a promo booking returns the cash the customer
  actually paid, which is already handled.

---

## 2. Stage A / Stage B

### 2.1 The new resolver signature

```ts
/** A promo that has ALREADY passed every impure gate — it exists, is active,
 *  is inside its window, is in scope for THIS target, and (fixed_price) matches
 *  the charge currency. The resolver decides exactly one thing about it:
 *  whether it beats the member benefit and the list price. */
export interface PromoModifier {
  /** Canonical uppercase — carried into the display and the reservation key. */
  code: string
  effect: 'percent_off' | 'fixed_price'
  percent?: number
  amount?: number
}

export interface PaymentContext {
  promo?: PromoModifier | null
}

export function resolvePaymentOptions(
  snapshot: ContactPaymentSnapshot,
  target: PaymentTarget,
  context?: PaymentContext          // ← the only signature change
): PaymentOptionsResult
```

**Why a third parameter and not the snapshot or the target.**

- **Not the snapshot.** `ContactPaymentSnapshot` is documented as "what the
  resolver may know about the *caller*" (`paymentOptions.ts:28-53`) and is built
  once per contact and reused across many targets —
  `pricingSurface.resolveAppointmentCells` (`:216`) calls the resolver once per
  duration with one snapshot. A promo there would silently apply to every cell.
  It would also force edits to three snapshot factories (`access.ts:260-269`,
  `paymentSnapshot.ts:30-36`, `pricingSurface.ts:87-116`), the spread-widening
  at `payments.ts:695`, and the `contact()` helper every one of the 60 fixtures
  uses (`paymentOptions.test.ts:17`).
- **Not the target.** `benefit` lives on the target because it is *configuration
  authored on that entity*. A promo is a runtime input the buyer typed. Putting
  it on the target means adding and threading the same optional field through
  five arms.
- **Optional third parameter → zero edits at the existing call sites.** They
  compile unchanged and behave identically, which is what keeps the test baseline
  green.

  **CORRECTED in P3-C: the count and the citation were both wrong.** Revision 2
  said "the 13 existing call sites (six in functions, five in web, plus the
  fixture harness — enumerated in §0.1's blast-radius row)". Six plus five plus
  one is twelve, not thirteen; §0.1 has no blast-radius row; and the real counts
  are **seven in functions and eight in web**. Enumerated here so the next reader
  greps rather than trusting a number (`grep -n 'resolvePaymentOptions('`, this
  tree, after Group A):

  | Where | Sites |
  |---|---|
  | functions | `booking/dropIn.ts:93`, `booking/dropIn.ts:450`, `booking/access.ts:303`, `booking/waitlist/claim.ts:200`, `connect/payments.ts:714`, `connect/payments.ts` (product — **new in P3-D**), `appointments/window.ts:362`, `appointments/checkout.ts:96` |
  | web | `lib/pricingSurface.ts:192`, `:216`, `:228`, `space/SpaceHome.tsx:73`, `appointments/AppointmentPicker.tsx:316`, `shop/ShopHome.tsx:472`, `booking/BookingForm.tsx:721`, `booking/BookingForm.tsx:986` |
  | mobile | **none.** `apps/mobile` does not depend on `@linyup/shared` at all — it MIRRORS the shapes locally (`apps/mobile/src/types/index.ts:165`, `:181`, both saying so in as many words). Anything the phase needs on mobile is a separate port, not a call-site edit |
  | tests | the fixture harness, `booking/paymentOptions.test.ts:37` |

  Every one of them reads only `options` and `denial`; none enumerates the
  result's keys, which is why an added optional field is invisible to all of
  them. The one behaviour that *does* reach them is B1's fix, and it can only
  ever lower a price (§0.3).

**The scope check is deliberately NOT in the resolver.** `PaymentTarget` carries
no entity ids today (`ClassBookingTarget` has only an accessRule;
`DropInTarget` has no activityId). Widening every target to carry ids would
touch every construction site. Instead the impure half — exists / active /
window / scope / currency — is resolved by a **loader**, exactly as
`loadContactPaymentContext` (`access.ts:182`) resolves the impure half of the
snapshot. The resolver stays pure and receives a `PromoModifier` that is already
known to apply. This is the established division of labour in this file
(`paymentOptions.ts:14-18`) and it is what makes the promo's boundary cases
decidable in ONE place (§8.1 shape 1).

### 2.2 What the result gains

```ts
export type PromoOutcome =
  | { code: string; status: 'applied' }
  // CORRECTED in P3-C: this arm needs a DISCRIMINATOR, and revision 2's version
  // could not carry one. §3.3 says the superseded distinction "is derived inside
  // the resolver (which candidate held the incumbent position), not re-derived
  // by the client from two numbers", and §7.6 declares TWO keys for it
  // (`supersededByBenefit` / `supersededByBase`) — but `{code, status}` alone
  // gives the client nothing to switch on, so it would have had to re-derive it
  // from `appliedBenefit` after all. That is §8.1 shape 1 in miniature: one
  // question, two answers.
  /** A member benefit — or the plain list price — was as good or better. */
  | { code: string; status: 'superseded'; by: 'benefit' | 'base' }
  /** The caller pays nothing anyway (covered / spend_credits). PREVIEW-ONLY in
   *  practice — see §3.3: every checkout callable refuses a covered caller
   *  before the pay option is read, so this outcome never reaches a checkout. */
  | { code: string; status: 'not_needed' }
  /** This arm takes no promo (class_booking, a trial), or the modifier is
   *  malformed, or the loader found the code out of scope for this target,
   *  or — CORRECTED in P3-C — there is no pay option at all because the arm
   *  DENIED. §3.3's table listed three causes and omitted the fourth; a denial
   *  must not report `not_needed`, which would tell a refused visitor they can
   *  have the thing for free. */
  | { code: string; status: 'not_applicable' }

export interface PaymentOptionsResult {
  options: PaymentOption[]
  denial: PaymentDenial | null
  /** Present IFF context.promo was supplied. Absent everywhere else — which is
   *  why all 60 existing fixtures stay byte-identical under assert.deepEqual. */
  promo?: PromoOutcome
}
```

**The `not_needed` fallback is gated on the arm, not only on the options.** A
covered `class_booking` is covered — but it must still report `not_applicable`,
because that arm takes no promo at all (and P3-E pins it). So the derivation is
`takesPromo && the options are free`, never just "the options are free". Stated
because the two conditions look interchangeable and are not.

and on the `pay` option, mirroring `appliedBenefit` (`paymentOptions.ts:130-134`)
and following its **omitted-when-absent** convention (`payBase`, `:245-248`):

```ts
appliedPromo?: {
  code: string
  effect: 'percent_off' | 'fixed_price'
  baseAmount: number
  /** The benefit that WOULD have priced this booking had the code not beaten
   *  it. Present only when a benefit was applicable and lost.
   *
   *  This exists because dropping `appliedBenefit` when the promo wins would
   *  silently blank the booking's provenance: `createAppointmentCheckout`
   *  writes `subscription_type_id: payOption.appliedBenefit?.subscriptionTypeId
   *  ?? null` (appointments/checkout.ts:173), and `/offer/pricing` reads
   *  `appliedBenefit` for the member badge (pricingSurface.ts:180-185). So
   *  every campaign would blank "which membership priced this" for every member
   *  who used the code — the studio's own attribution data, gone exactly when a
   *  campaign is running. One omitted-when-absent field, no fixture churn, and
   *  N4 still holds: only ONE of appliedBenefit / appliedPromo ever PRICES the
   *  option. */
  supersededBenefit?: { subscriptionTypeId: string; effect: BenefitEffect } | null
} | null
```

Downstream, `subscription_type_id` is stamped from
`appliedBenefit?.subscriptionTypeId ?? appliedPromo?.supersededBenefit?.subscriptionTypeId ?? null`
(`appointments/checkout.ts:173` and the drop-in booking write), and
`pricingSurface.fromResult` falls back the same way.

**Two fields, one computation.** `result.promo` and `pay.appliedPromo` are
written from a **single** decision variable inside the resolver — the same
discipline `docs/wave3-phase2-spec.md` §2 imposed on
`claim_expires_at` / `offer_expires_at` ("two copies of one instant, never two
computations"). `promo.status === 'applied'` ⟺ some option carries
`appliedPromo`, structurally, not by convention (N4). Both exist because they
serve different readers: `appliedPromo` rides the option through
`claim.ts:211-224`'s response and `pricingSurface.fromResult` (`:180-185`) where
`appliedBenefit` already lives; `result.promo` is the only channel that can say
*why a valid code did nothing*, which §3.3 requires.

Which arms accept a promo:

```ts
/** The price-modifying half of the Benefit vocabulary, and nothing else. */
const PROMO_EFFECTS: ReadonlySet<BenefitEffect> = new Set(['percent_off', 'fixed_price'])
/** Arms that can produce a `pay` option a promo could modify. */
const PROMO_TARGETS: ReadonlySet<PaymentTarget['kind']> =
  new Set(['drop_in', 'appointment', 'course', 'product'])
```

`class_booking` is absent, which is load-bearing beyond tidiness: it guarantees a
promo can never reach the arm whose denial is cast unchecked to
`BookingAccessDenialReason` at `access.ts:314`.

### 2.3 The new `product` arm

```ts
export interface ProductTarget {
  kind: 'product'
  /** The effective price for the chosen product + variant — resolveProductPrice's
   *  output (types/product.ts:60-70). Major units, team currency. */
  priceAmount: number
  /** Threaded for uniformity; always null today — Product carries no benefit
   *  field and Phase 3 does not add one (§11). */
  benefit?: AnyBenefit | null
}

const PRODUCT_EFFECTS: ReadonlySet<BenefitEffect> = new Set(['percent_off', 'fixed_price'])
```

**The arm never covers and never denies.** Its allowed effect set excludes
`included` and `spend_credits`, so it is structurally incapable of returning
`covered`; there is no free product tier and no product denial. It returns
exactly one `pay` option, always. That is a falsifiable invariant (N6) rather
than a behaviour to remember.

**Authored-price validation stays at the callable.** `createProductCheckout`
keeps `requireChargeableAmountFromMajor` as a pre-flight sanity check on
`resolveProductPrice(...)`'s output *before* entering the resolver — the exact
pattern `dropIn.ts:229` already uses (`requireChargeableAmountFromMajor(priceAmountMajor)`
with the return discarded, under the comment "the BASE price must be
chargeable") — and then validates the resolver's post-promo total on the way
out. The resolver does not validate authored prices; it never has.

### 2.4 The pipeline, end to end

```
STAGE A — PRICE (pure, resolvePaymentOptions)

  arm resolves coverage / list price
    ├─ covered | spend_credits ──────────────► promo: 'not_needed'; STOP. Nothing to discount.
    └─ pay(base)
         candidates, evaluated against ONE base, inside applyModifiers:
            base                                     (the incumbent)
            benefit  → resolveBenefitCandidate       (applies unless it RAISES)
            promo    → priceAfterModifier            (strictly lower wins)
         each candidate already clamped to ≥ MIN_CHARGE_MAJOR
         winner → pay.amount, plus AT MOST ONE of appliedBenefit / appliedPromo

STAGE B — TENDER (impure, at the checkout callable)

  pay.amount
    → gift-card drawdown (planGiftCardRedemption, types/giftCard.ts:135)
    → residual
    → residual === 0 ? full-cover branch (no Stripe) : startOneOffCheckout(residual)
```

The callable's order of operations, with the reason for each position:

```
1  load the promo (impure)              exists · active · window · scope · currency · binding
                                        FAILS → NO modifier + a reason. NEVER a throw. (§3.3)
2  resolve Stage A with the promo       pure, free, no side effects
3  quotedAmount guard                   the client's asserted price vs payOption.amount
                                        DISAGREE → refuse 'price_changed' with the new figure
4  capacity / eligibility / trial gates drop-in only (Phase 2 P2-C) — all NON-MONEY gates
5  IF promo won → RESERVE the promo     the cap transaction (§5.1)
                                        FAILS → refuse the checkout (N10) — never re-price
6  reserve the gift card                planGiftCardRedemption against pay.amount
7  full cover ? record the sale : Stripe(residual)
   — steps 5..7 run inside ONE guard; any throw releases what was reserved,
     in reverse order: gift card, then promo (§5.3)
```

Three positions changed in revision 2, and each change closes a leak.

**Why step 1 never throws.** Revision 1 said an out-of-scope code should "refuse
now, before anything is reserved" in §2.4 while §2.2 and §3.3 said the resolver
reports `not_applicable` and the purchase continues at list price. Those are
opposite behaviours for the single most common real interaction there is — a
visitor pasting a flyer code onto the wrong item, or onto the trial door. **One
rule, stated once:**

> A code that does not apply is **REPORTED, never silently charged, and never
> blocks the purchase.** A checkout refuses only when the client asserted a price
> Stage A did not produce.

Which is what step 3 is for. Every one-off checkout callable takes an optional
`quotedAmount` (major units — the figure the surface actually rendered) and
compares it to `payOption.amount`. Absent → proceed (an older client, or a
surface with no price display). **HIGHER than shown** → refuse
`failed-precondition` `{ reason: 'price_changed', amount: payOption.amount }`,
which every mount re-renders (§7.3). One guard closes the whole family: a code
that turned out not to apply, a member benefit that changed underneath, a
coverage change, a stale tab. It is also what makes N10 checkable — revision 1's
N10 only covered *a reservation that could not be taken*, not *a discount that
was never attempted*.

> **CORRECTED in P3-L: the guard is ONE-SIDED, not `!==`.** Revision 2 said
> "Equal → proceed. Different → refuse". Turning that on across the three public
> mounts would have refused a perfectly ordinary member, because the price those
> surfaces render comes from an **optimistic, documented-as-partial** client
> snapshot: the public contact session carries only the contact's PRIMARY
> `subscription_type_id` (`clientPaymentSnapshot`, and the identical note at
> `BookingForm.tsx:712-718` and `ShopHome.tsx:452-457`), while the server loads
> the full held union. A member whose benefit comes from a **secondary** held
> type is therefore quoted BASE by the client and the DISCOUNTED price by the
> server — routinely, with nothing wrong anywhere — and under `!==` is refused
> `price_changed` and told the price changed, losing the studio a sale for being
> cheaper than advertised.
>
> The asymmetry costs nothing the guard exists for: **being charged MORE than the
> screen said is the harm**, and that half refuses exactly as specified. Being
> charged LESS needs no consent. `assertQuotedAmount` (`connect/checkout.ts`)
> therefore returns early when `resolved <= quoted`, with the reasoning on the
> line, and fixtures pin both halves (`connect/checkoutWindow.test.ts`).
> Before P3-L no client sent `quotedAmount` at all, so this changes no shipped
> behaviour — it decides what the guard means the first time it is live.

> **CORRECTED again (post-implementation): the guard is SCOPED to promo-carrying
> checkouts, and its refusal is RECOVERABLE.** As first shipped, every mount sent
> `quotedAmount` on every checkout — including purchases with no code at all —
> which handed the *whole* one-off purchase surface a new way to refuse an
> ordinary sale, and one the client could not escape.
>
> The scope half. The one-sided reasoning above concedes that the client snapshot
> is optimistic and partial and that the two snapshots may legitimately disagree.
> It then treats that concession as covering only the *safe* direction. It does
> not: the same partiality also makes the client quote **LOW**, deterministically
> and not transiently. A member whose primary `subscription_type_id` is a **credit
> pack with 0 remaining**, listed in the activity's `memberBenefit`, is counted as
> held by `clientPaymentSnapshot` (every id is reported unmetered) so the benefit
> applies on screen — while `loadContactPaymentContext` classifies it as
> credit-metered with `remaining: 0`, and `resolveBenefitCandidate` requires
> `heldUnmeteredTypeIds.includes(id) || creditRemaining(...) > 0`, so the benefit
> does NOT apply on the server. Client 32, server 40, refused — and refused
> identically on every retry, because nothing the client re-reads changes. The
> shop has a second instance with no membership in it at all: `ShopHome` fetches
> its catalogue once (`getDoc`/`getDocs`, no listener), so a price a studio raises
> under an open tab is re-quoted low by that tab forever. Neither buyer typed a
> code; neither was promised the lower figure by anything but an optimistic
> render. **With** a code, the surface made a specific promise — "Code X applied",
> a struck-through base, a discount row — and a server that then charges list
> price breaks it; that is what the guard was designed for and the only place its
> refusal carries information the visitor can act on. So `assertQuotedAmount`
> takes a **required** `scope: { promoAttempted: boolean }` third argument
> (required so no call site can be silently in or out of scope) and returns early
> when no code was typed. `promoAttempted` is *a code was supplied*, never *a code
> won* — gating on "won" would disable the guard in exactly the case it exists
> for, where the client thought it applied and the server disagrees.
>
> The recovery half applies whatever the scope, because a promo-carrying checkout
> hits the same divergences. "Which every mount re-renders" was the gap: a mount
> re-rendering from the same optimistic snapshot re-derives the same low figure
> and is refused again — refuse, re-render, refuse, with no path to the real
> price. The throw already carries `amount`; `priceChangedAmount(err)`
> (`components/booking/PromoCodeField.tsx`) is the one reader of it, and each
> mount stores it as `acceptedPrice`, which becomes **both** what the surface
> renders (discount rows and struck-through bases drop — the server just declined
> to honour them) **and** what the next submit sends back as `quotedAmount`. The
> two then agree and the sale completes. Copy: `Promo.priceChangedTo` (naming the
> figure) and `Promo.continueAtPrice` (the button, where the surface owns one), in
> all four locales.

**Why the promo is reserved AFTER the non-money gates (step 5, not step 3).**
Revision 1 put the reserve above them and created three leak points, because none
of those gates has a release path — nothing is reserved above them today. In
`createDropInCheckout` they are the trial-eligibility throw
(`dropIn.ts:481-485`), the already-registered throw (`:497-499`) and the capacity
pre-flight (`:515-519`). A visitor with a 10-use flyer code clicking Pay on a full
class would have burned a use and — because the reservation is keyed to her own
identity — barred herself from the code on any *other* class for the whole
window; ten such clicks would exhaust the campaign without a sale. So the reserve
sits immediately above the gift-card reservation, which is where this codebase
already puts its first side effect (Phase 2 P2-C: "called early so a refusal
leaves no reserved gift-card drawdown behind").

**Why the promo is still reserved before the gift card (step 5 before step 6).**
The gift-card reservation is computed against `pay.amount`; if the promo
reservation could fail *after* it, the drawdown would have been reserved against
a price that no longer applies. Reserving the promo first means every refusal
between them leaves the card untouched.

**Why steps 5–7 are ONE guard, not a list of catches.** Revision 1 enumerated
three release call sites in prose and got one of them wrong (B7). Enumeration is
the wrong shape: the set of throw sites between the reserve and the return is
larger than it looks and grows with the code. In this tree it includes
`reserveGiftCardDrawdown`'s own three throws (`giftCards.ts:217-219` not-found,
`:239-244` currency mismatch, `:251-255` unusable), the full-cover booking
transaction (`dropIn.ts:637-640`), the pending-hold transaction (`:766-769`), the
Stripe create (`:845-849`), and — on the appointment rail —
`runAppointmentSlotTransaction`, which today sits **outside** the `try` that
wraps `startOneOffCheckout` (`appointments/checkout.ts:180` vs the catch at
`:214`), so two visitors racing one slot with the same code would strand the
loser's reservation. The rule is therefore structural: **every path from the
reserve to the successful return goes through one guard**, and P3-H moves the
appointment slot transaction inside it. §5.3 lists the sites as a verification
checklist, not as the mechanism.

> **CORRECTION (post-implementation).** Moving the slot transaction inside the
> guard is right, and this paragraph stated only half of what that requires. The
> other half: **"inside the guard" is not "everything above me is mine to
> undo".** The appointment session's doc id is deterministic and SHARED
> (`apt_{providerId}_{startMs}`) — that is exactly why the transaction can refuse
> a second visitor — so on a refusal the document at that id is the WINNER's live
> hold, and the catch's unconditional `sessionRef.set({status:'cancelled'})`
> cancelled it. A concurrent loser took a slot away from somebody who had
> successfully booked. The guard must therefore distinguish "we never acquired
> the hold" from "we acquired it and then failed" and release only in the latter,
> while the PROMO reservation is released in both (it is ours by construction).
> `decideAppointmentCheckoutRollback` is that distinction as a pure function;
> fixtures in `connect/promoLifecycle.test.ts`. See `docs/promo-codes.md` →
> "Redemption integrity".

### 2.5 A promo code AND a gift card on the same purchase

The case a user hits immediately. Worked example: a drop-in listed at CHF 40, a
promo `AUTUMN25` (`percent_off`, 25), and a gift card holding CHF 20.

```
Stage A   base                                40.00
          benefit   (none held)                  —
          promo     40 × 0.75  = 30.00       30.00   ← strictly lower, wins
          clamp ≥ 0.50                       30.00
          ⇒ pay.amount = 30.00, appliedPromo { code:'AUTUMN25', effect:'percent_off', baseAmount:40 }
                        promo { code:'AUTUMN25', status:'applied' }

Stage B   planGiftCardRedemption(available 20.00, total 30.00)
          ⇒ drawdown 20.00, residual 10.00
          Stripe charges 10.00
```

The visitor's breakdown, top to bottom — modifier above tender, in the UI and in
the arithmetic:

```
Drop-in                        40.00
Code AUTUMN25 (−25%)          −10.00      ← Stage A
Subtotal                       30.00
Gift card GC-XXXX-XXXX        −20.00      ← Stage B
Total                          10.00
```

Two edge interactions, both resolved by the ordering and neither needing new
code:

- **The card covers the post-promo total.** Balance 35 against a post-promo
  30.00 → `residual === 0` → the existing full-cover branch
  (`dropIn.ts:560-685` / `payments.ts:546-568` / `:761-789`): no Stripe session,
  no webhook, the sale recorded there, and the promo reservation committed **in
  that same branch** (§5.2). This is why the promo commit cannot ride on
  `commitGiftCardDrawdown` — see §0.4(a) reason 2, the comped card that returns
  early.
- **The card would leave a residual below 0.50.** Balance 29.80 against 30.00 →
  `planGiftCardRedemption` shrinks the **drawdown** to 29.50 and leaves a 0.50
  residual (`types/giftCard.ts:145-151`). The promo is untouched: it already did
  its work in Stage A. The two 0.50 floors never meet (§4).

### 2.6 Why the gift-card call sites need no edit

Every gift-card reservation already reads the resolver's `pay.amount`:

| Callable | Resolver → price | Gift-card reserve |
|---|---|---|
| `createDropInCheckout` | `dropIn.ts:454` `.find(o => o.type === 'pay')` → `:467` `priceMajor = payOption.amount` | `:552` `totalMajor: priceMajor` |
| `createCourseCheckout` | `payments.ts:694` → `:723-725` `priceMajor` | `:749-758` `totalMajor: priceMajor` |
| `createProductCheckout` | **`payments.ts:505-506` — bypasses the resolver (B2)** | `:534-543` `totalMajor: priceMajor` |
| `createAppointmentCheckout` | `appointments/checkout.ts:96` → `:122` | *no gift card by design* |

Because the promo lives inside the resolver, `pay.amount` is already post-promo
and the gift card receives the correct total with **zero** changes to
`reserveGiftCardDrawdown` or its arguments. That is the §7.2 dividend
(`docs/fareharbor-analysis.md:369-372`) made concrete — and the one row that
does not hold is B2, which is exactly why the `product` arm is not optional.

---

## 3. Stacking — best-one-wins

Franco's settled decision (`docs/fareharbor-analysis.md:338`): **never stacked;
`appliedBenefit` and `appliedPromo` stay mutually exclusive on the wire.**

### 3.1 What competes, and what does not

| Pair | Competes? | Why |
|---|---|---|
| Promo vs **member benefit** (`Activity.memberBenefit`, `Course.benefit`) | **Yes** — the headline case | Both are price modifiers on the same base |
| Promo vs the **list price** | **Yes** | A `fixed_price` promo above list must not raise the price (N5, and it is B1's fix) |
| Promo vs **coverage** (`covered`, `spend_credits`) | **No** — coverage wins, always | Nothing to discount. The drop-in arm already returns coverage first and never reaches the pay path (`paymentOptions.ts:369-370`), and P1's rule — "someone who can already book free must not be sold a drop-in" — is the same statement |
| Promo vs the **trial price** | **No** — §3.4 |
| Promo vs **subscription pricing** (`SubscriptionType` prices, `createMembershipCheckout`) | **No** — different rail | Those never enter the resolver (`payments.ts:337`, `:221`); §11 |
| Promo vs **gift card** | **No** — different stages | §2.5 |
| Promo vs **another promo** | **No** — one code per checkout | The field is single-valued; a second code replaces the first client-side and the callable takes one `promoCode` |

### 3.2 Best for whom, computed how

**Best for the visitor — the lowest amount they pay today.** Not "the largest
percentage", not "the newest rule". Computed in one pure helper, extracted from
`applyBenefitToPrice` so both callers share the clamp and the rounding:

```ts
/** Apply one price-modifying effect to a base. Returns null when the effect is
 *  malformed (a missing/≤0 percent, a non-finite amount) — malformed means NOT
 *  APPLIED, never "applied as zero". The clamp lives here and nowhere else. */
function priceAfterModifier(
  base: number,
  effect: 'percent_off' | 'fixed_price',
  percent?: number,
  amount?: number
): number | null
// percent_off : pct >= 100 ? MIN_CHARGE_MAJOR
//             : Math.max(MIN_CHARGE_MAJOR, round2Major(base * (100 - pct) / 100))
// fixed_price : Math.max(MIN_CHARGE_MAJOR, amount)

/** Best-one-wins, evaluated base → benefit → promo. The comparison is
 *  DELIBERATELY ASYMMETRIC (§0.3 B1):
 *   • a BENEFIT applies, and stamps appliedBenefit, whenever it does not RAISE
 *     the price (benefitPrice <= base) — because appliedBenefit answers "which
 *     membership priced this booking", and a benefit set exactly at base did
 *     price it;
 *   • a PROMO applies, and stamps appliedPromo, only when STRICTLY lower than
 *     the incumbent — because appliedPromo answers "did a code change the
 *     price", and a code that changed nothing did not.
 *  When the promo wins over an applicable benefit, that benefit is carried on
 *  appliedPromo.supersededBenefit so provenance survives (§2.2). */
function bestModifier(base: number, benefit: Candidate|null, promo: Candidate|null): Winner
```

**Consequences, each of which would otherwise be a separate rule to remember:**

1. A `fixed_price` benefit above base no longer raises the price (**B1 fixed**).
2. A `fixed_price` benefit *exactly at* base still stamps `appliedBenefit` — no
   behaviour change for the studios who use base-priced placeholders, and
   `/offer/pricing` keeps rendering the member badge (`pricingSurface.ts:180-185`).
3. A `fixed_price` promo above or exactly at base never applies — `superseded`,
   no struck-through price identical to the charged one.
4. A promo exactly equal to the member price loses; the member is never told
   their membership stopped mattering.
5. A promo that beats the benefit still records which benefit it beat, so a
   campaign never blanks a studio's subscription attribution (§2.2).

`percent_off` cannot produce a value above base (it is always ≤ base), so the
above-base rules bite only on `fixed_price`.

**The `included` / `spend_credits` benefit effects still short-circuit before
the comparison.** On an appointment, a held `included` benefit returns
`covered { benefit_included }` (`paymentOptions.ts:260-268`) — a coverage answer,
not a price — and coverage beats every promo (§3.1). So the promo on that path
reports `not_needed`, never `superseded`. The distinction matters for the copy
(§3.3).

### 3.3 What the visitor is shown when their code loses

This is the whole reason `PaymentOptionsResult.promo` exists. Every outcome has
one message and one visible price:

| `promo.status` | When | What the visitor sees |
|---|---|---|
| `applied` | Strictly lower than base and benefit | The discount row, the new total, the code chip. `promoApplied` |
| `superseded` | A member benefit or the list price was as good or better | The code is accepted, no discount row, and an explicit line: **"Your member price is already lower than this code."** (`promoSupersededByBenefit`) or **"This code does not lower this price."** (`promoSupersededByBase`). Never silence, and never an error — the code was valid |
| `not_needed` | The caller is `covered` / `spend_credits` | **"You can book this without paying — no code needed."** (`promoNotNeeded`). **PREVIEW-ONLY** — see below |
| `not_applicable` | The arm takes no promo (`class_booking`, a trial), the code is out of scope for this target, the modifier is malformed, **or the arm returned a DENIAL** — no pay option exists for a code to modify (the fourth cause, added in P3-C) | **"This code does not apply to this booking."** (`promoNotApplicable`). The purchase is NOT blocked — it completes at list price (§2.4 step 1). On the denial case the surface is already rendering the denial and this line is secondary; what matters is that it is NOT `not_needed`, which would read as "you can have this for free" to somebody who was just refused |

Two of these distinguish causes the visitor genuinely cannot infer, which is why
`superseded` carries two messages rather than one. The distinction is derived
inside the resolver (which candidate held the incumbent position), not
re-derived by the client from two numbers.

**`not_needed` is a PREVIEW outcome and never a checkout outcome.** Revision 1
placed its copy in the checkout-time table; it is unreachable there. Every
one-off callable refuses a covered caller *before* the pay option is read:
`createDropInCheckout` throws `failed-precondition` "You can already book this
class for free" on all three known-contact branches (`dropIn.ts:360-366`,
`:383-386`, `:416-419`) and `createAppointmentCheckout` throws
`{ reason: 'covered' }` at `appointments/checkout.ts:101-108`. So the visitor who
becomes covered between preview and pay sees the *coverage* refusal each surface
already maps, not this message. `not_needed` therefore lives in exactly two
consumers — `previewPromoCode` and `/offer/pricing` — and the checkout-time
reason table (§7.3) does not list it.

**A losing promo consumes nothing.** No reservation is taken when
`status !== 'applied'` (§2.4 step 5), so a member who types a code out of
curiosity does not burn a use of a 50-use campaign. Falsifiable: N11.

### 3.4 The trial price does not compete — a promo never touches it

`paymentOptions.ts:372-382`: the `asTrial` branch returns a bare
`pay { source: 'trial' }` and **never enters the modifier path at all** (as
shipped: it never calls `applyModifiers`, so neither `resolveBenefitCandidate`
nor `priceAfterModifier` ever sees it. Pre-phase the same line read "never calls
`applyBenefitToPrice`"; that symbol was renamed by P3-C and no longer exists).
That is
deliberate — a paid trial (`Activity.trialPriceAmount`, memory
`paid-trial-feature`) is already an acquisition price, enforced once per person
via `Contact.trial_used_at`. Stacking a promo on it double-discounts the one
purchase in the product whose whole purpose is to be cheap, and a studio that
wants a cheaper trial has a field for that.

So: `promoAppliesTo` returns false when `scope.isTrial === true`, and the arm
reports `not_applicable`. Recorded as a decision, not an accident, and listed in
§10 Q5 as reversible if Franco disagrees — reversing it is a one-line predicate
change plus fixtures, precisely because the predicate lives in one place.

### 3.5 Subscription pricing

Memberships never enter the resolver: `createMembershipPayment` prices at
`payments.ts:221` and `createMembershipCheckout` at `:337`, both straight into
`requireChargeableAmountFromMajor`. A promo there would be either a fifth
resolver arm (one-off memberships) or a Stripe coupon on a subscription
(recurring) — two different mechanisms for one visible feature, which is exactly
the kind of half-covered surface that confuses a buyer looking at the shop's
Subscriptions tab. Out of v1; §10 Q8 asks whether the one-off half is worth it.

---

## 4. The 0.50 floor and the money edges

The rule, codified at `packages/shared/src/utils/money.ts:5-11`: **AUTHORED
prices below the floor are a configuration error and THROW; ARITHMETIC-DERIVED
prices CLAMP UP and are never free.** The throwing half is
`requireChargeableAmountFromMajor` (`connect/checkout.ts:41-48`); the clamping
half is `Math.max(MIN_CHARGE_MAJOR, …)` inside the resolver
(`paymentOptions.ts:304-307`, `:326`).

| Case | Authored or derived | Behaviour |
|---|---|---|
| `percent_off` with `percent = 25` on a base of 40 | derived | `round2Major(40 × 0.75) = 30.00` |
| `percent_off` that lands **under 0.50** (95% off a CHF 8 drop-in → 0.40) | derived | **CLAMP** to `MIN_CHARGE_MAJOR`. The visitor pays 0.50 and the breakdown shows it. Existing behaviour, `paymentOptions.ts:304-307` |
| `percent_off` with `percent = 100` | **authored** | **Not expressible.** `createPromoCode` refuses `percent` outside 1–99 with `invalid-argument`, matching `Benefit.percent`'s documented range (`types/benefit.ts:37-38`) and `benefitPercentInvalid`'s existing rule (`BenefitEditor.tsx:75-81`). The resolver's `pct >= 100 → MIN_CHARGE_MAJOR` clamp survives as the derived-value backstop for legacy/hand-written data |
| `percent_off` with `percent ≤ 0`, missing **or non-finite** | derived, malformed | **NOT applied** — falls back to base, `promo: 'not_applicable'`. Never "applied as zero". **The non-finite case is new in P3-C and fixes a latent benefit bug**: the old guard was `typeof pct !== 'number' \|\| pct <= 0`, and `NaN` passes both that and the `>= 100` clamp, so a `NaN` percent produced `Math.max(0.50, NaN) === NaN` as a *price*. No fixture pinned it; one does now |
| `fixed_price` **below 0.50** | **authored** | **THROW at creation** — `createPromoCode` validates `amount >= MIN_CHARGE_MAJOR`, same bar as `benefitAmountInvalid` (`BenefitEditor.tsx:83-88`). The resolver's clamp stays as the backstop |
| `fixed_price` **above the list price** | derived comparison | **Not applied** — `superseded`, the visitor pays list (§3.2, N5). This is the promo half of B1 |
| A code on an **already-free** booking (`covered` / `spend_credits`) | — | `promo: 'not_needed'`; no reservation, no consumption, price unchanged (N11). Preview-only in practice — §3.3 |
| `percent_off` with `percent = 100` ("first class free") | **authored** | Deliberately inexpressible in v1, and that is a **product** call, not only a floor consequence: a 100% code needs a payment-less confirm path, which the gift-card full-cover branch (`dropIn.ts:560-685`) proves is buildable. The workaround — the free-trial door — is a different feature with its own once-per-person gate, no code, no window and no campaign report, so "first class free, 100 seats, January only" cannot be run at all today. **§10 Q14** puts it to Franco with the cost stated |
| A code that would make the purchase **free** | — | **Unreachable.** `percent` caps at 99 and every derived price clamps to 0.50, so Stage A can never emit `pay.amount === 0`. There is therefore **no promo-only zero-total checkout branch**, and the only path with no Stripe session remains the gift-card full cover (N3) |
| **Currency** | — | `percent_off`: no currency, no guard. `fixed_price`: `currency` stamped at creation from `giftCardCurrency(team.default_currency)` (`giftCards.ts:116-118`) and compared case-insensitively at reserve time; mismatch → `failed-precondition`, `reason: 'promo_currency_mismatch'` (§0.4(b), N12) |
| **Rounding** | derived | `round2Major` (`money.ts:34`) — the one rounding policy, and the resolver feeds it `(base * (100 - pct)) / 100`. **The policy is half-up on the IEEE-754 float, so a mathematical `.xx5` can round DOWN**: 15% off 33.30 evaluates to `28.304999999999996`, and `round2Major` returns **28.30** (→ 2830 Rappen), not 28.31 as revision 1 asserted. Pinned by a fixture (P3-E) so the behaviour is documented by a test rather than by prose. Never re-implement `Math.round(x * 100) / 100` at a call site |
| The **post-promo total** entering Stripe | derived → authored boundary | The callable still calls `requireChargeableAmountFromMajor(payOption.amount)` (`dropIn.ts:468`, `payments.ts:725`, `appointments/checkout.ts:122`) — the clamp guarantees it passes, and the check stays as the seam's assertion |
| **Gift-card residual** below 0.50 | derived, Stage B | `planGiftCardRedemption` shrinks the **drawdown**, never the residual (`types/giftCard.ts:145-151`). Unchanged; the promo already finished in Stage A |

**The two floors never meet, and that is the point.** The PRICE floor clamps a
derived price up inside Stage A. The CHARGE floor protects a residual by
shrinking a drawdown in Stage B. Borrowing `planGiftCardRedemption` for the
promo would import the wrong one and create money from nothing
(`docs/fareharbor-analysis.md:364-368`).

---

## 5. Redemption integrity

This is the lost-update shape Phase 2 spent five rounds on. The answer below
names the one transaction that owns the counter and states its exact read set.

### 5.1 The reserve transaction — the one owner of the cap decision

`packages/functions/src/connect/promoCodes.ts`:

```ts
export async function reservePromoRedemption(params: {
  teamId: string
  code: string
  contactId: string
  /** promoIdentityKey({ email, contactId }) — what BOTH caps count (§1.1). */
  identityKey: string
  /** promoReservationKey({ code, identityKey, targetKey }) — DETERMINISTIC.
   *  Caller-minted, before any Stripe session exists (B4). See below. */
  reservationKey: string
  targetKey: string
  /** §5.3 — bounded on both sides against the Checkout Session (N9). */
  expiresAt: Timestamp
  amountMajor: number           // the quoted price, AUDIT ONLY (§1.2)
  baseAmount: number
  scope: PromoTargetScope
  chargeCurrency?: string | null
}): Promise<void>
```

**The reservation key is DETERMINISTIC, and that is the fix for the retry that
refused its own buyer.** Revision 1 minted a fresh random key per call, so the
second attempt at one purchase took a *second* reservation and, with
`max_uses_per_contact` defaulting to 1, the buyer's own live reservation refused
her with "You have already used this code" for a purchase she had never
completed — on every ordinary Back-button, double-click or dropped-redirect
retry, and for the whole reservation window (up to the claim window on a waitlist
claim, which can outlast the claim itself). The gift card does not behave this
way: a second `reserveGiftCardDrawdown` simply takes a second hold and usually
still succeeds. The codebase had already solved this shape forty lines from where
the promo reserve now sits — `countHoldingSeats(docs, now, contactId)` excludes
the caller's own hold under the comment *"their live-but-unpaid hold occupies a
seat, and counting it would refuse them permission to pay for the seat they are
already holding"* (`dropIn.ts:507-514`).

```ts
// CORRECTED in P3-B: the preimage is LENGTH-PREFIXED, not merely joined. A bare
// `a|b|c` is ambiguous — ('AB','x|y','t') and ('AB','x','y|t') hash identically
// and would merge two DIFFERENT purchases onto one reservation — and it is
// reachable, because targetKey embeds a product's client-generated variantId.
promoReservationKey({ code, identityKey, targetKey }, sha256Hex)
  = sha256([code, identityKey, targetKey].map(p => `${p.length}:${p}`).join('|')).slice(0, 32)

targetKey per rail (stable across retries, distinct across purchases):
  drop_in      `drop_in:${sessionId}`            (a waitlist claim IS a drop-in)
  appointment  `apt:${providerId}:${startMs}:${durationMinutes}`
  course       `course:${courseId}`
  product      `product:${productId}:${variantId ?? ''}`
```

So **one person holds at most ONE reservation per (code, target)**. A retry
*refreshes* its own reservation (rewrite `expires_at`, `amountMajor`,
`baseAmount`) and consumes nothing further; it can never take a second slot from
either cap, and the map cannot grow per retry (N20).

**Read set — two document `get`s by id, no query, no index:**

```
tx.get(promoRef)                                                // teams/{t}/promo_codes/{CODE}
tx.get(promoRef.collection('redemptions').doc(identityKey))     // the durable per-PERSON row
```

That is the whole read set — still two gets, even though the cap now binds to
email rather than to a contact document, because the identity IS the doc id
(§1.1) rather than a second lookup. Because both reads are single documents
fetched by id, the transaction is serializable under **both** readings of the
phantom-read question `docs/wave3-phase2-spec.md` §0.3(a) had to leave open —
there is no query in it to be phantom about. That is a deliberate design choice,
not a coincidence: the alternative (count a `redemptions` subcollection with a
query) would drag that unresolved question back in.

**The transaction body:**

```
now       = Date.now()
promo     = promoRef data;  missing / teamId mismatch  → not-found 'promo_not_found'
            status !== 'active'                        → failed-precondition 'promo_inactive'
            !promoWindowOpen(promo, now)               → failed-precondition 'promo_expired'
            !promoAppliesTo(promo, scope)              → failed-precondition 'promo_not_applicable'
            restrict_to_contact_id && != contactId     → not-found 'promo_not_found'   ← never leaks
            fixed_price && currency mismatch           → failed-precondition 'promo_currency_mismatch'

live   = promoLiveReservations(promo, now)             // expired entries DROPPED here, in this tx
mine   = live[reservationKey]                          // MY OWN reservation, if any — a REFRESH
left   = promoUsesLeft(promo, now, identityKey, redemptionSnap.data()?.count ?? 0)

REFRESH — the retry path, checked FIRST so no cap can refuse a purchase already in flight
  if (mine)  → rewrite mine.expires_at / amountMajor / baseAmount and RETURN.
               Consumes nothing: it is the same slot, already counted.
               (Its contactId can only be mine — contactId is in the key's preimage.)

GLOBAL CAP
  left.global <= 0                       → resource-exhausted 'promo_exhausted'
LIVE-RESERVATION CEILING
  left.liveTotal >= PROMO_MAX_LIVE_RESERVATIONS
                                         → resource-exhausted 'promo_busy'
PER-PERSON CAP
  left.perIdentity <= 0                  → failed-precondition 'promo_already_used'

WRITE
  reservations = { ...live, [reservationKey]: { contactId, identityKey, expires_at,
                                                amountMajor, baseAmount, targetKey } }
  tx.update(promoRef, { reservations, updated_at: serverTimestamp() })
```

**The transaction re-validates what the loader already checked, and that is not a
contradiction of §2.4 step 1.** The loader's read happens outside the
transaction, so scope / window / status can move between them; the transaction
re-checks them from its own read set. The difference is *who is refused*: an
inapplicable code never produces a modifier, so §2.4 step 5 never reserves it and
`promo_not_applicable` is unreachable in normal flow — it exists as the
transaction's own tripwire, not as a user-facing outcome. The *reachable*
refusals from here are `promo_not_found`, `promo_inactive`, `promo_expired`,
`promo_exhausted`, `promo_busy`, `promo_already_used` and
`promo_currency_mismatch`, all of which mean "you were quoted a discount we can
no longer honour" — the one case §2.4 says a checkout must refuse rather than
silently re-price.

**`promoUsesLeft` decides BOTH caps, and the transaction calls nothing else.**
Revision 1 declared `promoGlobalUsesLeft(p, nowMs)` (no identity parameter) as
"the single expression", then inlined `committed + live.length >= max_uses` in
the transaction and re-derived the per-person half separately here and again in
the preview — three answers to one boundary. The helper now returns the whole
boundary and the preview calls the same function against the same fields (§5.6,
§7.2), which is what actually forecloses §8.1 shape 1.

**Why a live reservation counts against `max_uses`, and what it costs.** A
reservation costs nothing to create, so counting it means an abandoner holds a
slot for the reservation window. Three things bound that in revision 2, and the
fourth is a question for Franco:

1. the deterministic key — one reservation per *person* per target, so N
   abandonments need N distinct email identities, not N clicks;
2. `PROMO_MAX_LIVE_RESERVATIONS` — a hard ceiling on concurrent reservations for
   one code, independent of `max_uses`, refused as `promo_busy` (a *distinct*
   reason from `promo_exhausted`, because "try again in half an hour" and "the
   campaign is over" are different sentences);
3. the reservation window is SHORT on every rail except a waitlist claim (§5.3);
4. the admin list shows **reserved separately from used** (§7.4), so
   "3 of 20 used" can never be the whole truth while the code refuses everyone.

**§10 Q9 puts the direction to Franco**, because it is a business call and both
directions are one line here: count reservations (today's choice — a contested
code refuses, and a campaign can be temporarily denied) or count committed only
(a contested code over-issues by a bounded few). A promo slot is not stored
value, which is the argument for over-issuing; a discount given twice costs the
studio one discount, whereas a refused customer costs a sale.

**`tx.update`, never `set(..., { merge: true })`.** A merge deep-merges the map
and resurrects every expired key just dropped, so cleanup would never persist —
the trap `giftCards.ts:260-262` documents and repeats at `:369-375` and
`:673-675`. Binding: N7.

**Expired reservations are dropped opportunistically, inside a transaction that
already holds the doc** — the `dropExpiredHolds` posture (`giftCards.ts:99-108`).
There is **no sweep job for promo reservations** (N13). Expiry is lazy, and
`promoLiveReservations` is THE predicate; nothing may re-derive it.

**The promo doc is a hot document while a campaign runs.** Every reservation for
one code serialises on it. At studio scale that is correct behaviour, not a
bottleneck — a promo code is not a flash sale. If a tenant ever runs a code
across a burst larger than a few writes per second, the remedy is more codes,
not a sharded counter. Recorded so nobody optimises it speculatively.

**The promo doc's SIZE is bounded, and revision 1's was not (N20).** Firestore's
1 MiB document limit is a hard wall with a nasty property: once crossed, reserve,
commit **and** release all fail with `INVALID_ARGUMENT`, so the code becomes both
unredeemable and unrepairable — disabling it is also a write to that document.
The gift card is safe from this by accident of its own semantics (a card's finite
balance bounds how many `committed_holds` entries it can ever accumulate — see
the retention comment at `giftCards.ts:268-270`), and revision 1 copied the shape
without that bound: `max_uses: null` is an explicit supported configuration, and
a permanent `WELCOME10` on a busy shop would accumulate ~8 000 committed entries
inside the 90-day retention window (≈1 MB) and wedge itself.

Revision 2 bounds it structurally instead of by retention:

```
committed history   : NOT on the doc at all — it lives in the redemptions
                      subcollection, one document per person (§5.2)
live reservations   : ≤ PROMO_MAX_LIVE_RESERVATIONS (25), enforced in the
                      reserve transaction, one entry per person per target
⇒ worst case        : 25 × ~200 B ≈ 5 KB + the definition. Two orders of
                      magnitude under the limit, for any campaign, forever.
```

### 5.2 The commit — where it happens, and where it must not

> **CORRECTION (post-implementation, 2026-08-14). §5.2 as written below counts a
> use for EVERY completed session carrying a reservation key, and that breaks Q9
> outright.** The reservation key is deterministic — a retry refreshes the same
> entry — but each retry mints a *new* Checkout Session, and Stripe will take
> money for any session that has not expired. On the drop-in and appointment rails
> a second payment is a duplicate the webhook refunds; on the **product and course
> rails it is a second genuine order**, so N concurrent sessions committed N uses
> and both `usage_count` and `PromoRedemption.count` passed their caps with
> nothing failing and nothing logged.
>
> **A RESERVATION SLOT IS SPENT AT MOST ONCE**, and `decidePromoCommit` is where.
> Three states replace the unconditional increment:
>
> | At commit | Outcome |
> |---|---|
> | live entry at our key, **our** instance | count, delete the entry |
> | live entry at our key, **another** instance | count nothing, touch nothing |
> | **no** entry, our claim already due to lapse | count (a genuinely late delivery — Stripe cannot charge an expired session, so the slot *was* ours when the money moved) |
> | **no** entry, inside our claim window | count nothing — the slot was taken (the sibling that spent it, a sibling's failure path, or the manager lever) |
>
> The fourth row is why the ticket and the session metadata now carry
> `expiresAtMs` / `promoExpires`: an ownership check alone closes only the
> ordering where the *older* session pays first. If the owner pays first it
> deletes the entry, and the sibling then finds an empty map — indistinguishable
> from a late delivery without the deadline.
>
> `commitPromoRedemption` takes `reservationExpiresMs: number | null` as a
> **required** parameter (a call site that does not name it cannot compile), and
> logs a refused spend at ERROR — "the system does not even notice" was half the
> defect. The cost, stated: a code can UNDER-report, which is the safe direction
> under Q9. What is *not* undone is that the sibling's buyer keeps the discounted
> price on their order; a session's amount is fixed at creation. The counters are
> bounded in every ordering, which is what the caps promise.
>
> This also supersedes the "known imprecision" note that said the release hole was
> "bounded to a single use… at most one sale can come of it". That bound was the
> same defect wearing a different hat — the product and course rails will sell the
> same person the same thing twice. Fixtures: `connect/promoLifecycle.test.ts`,
> "ONE SLOT IS SPENT ONCE, whatever the ordering" (both orderings, N = 4).

> **CORRECTION 2 (post-implementation, 2026-08-14). The sentence above — "the
> counters are bounded in every ordering" — was still FALSE when it was written,
> and the correction is structural rather than another patch.** Two holes remained
> under the rule it describes:
>
> 1. **the lease and the money are on different clocks.** A `checkout.session.completed`
>    delivered later than the reservation's lease counted through the "no entry,
>    our claim already due to lapse" row — while that lapsed slot had already been
>    handed to another buyer and counted for them. A lease is minutes; Stripe's
>    delivery horizon is hours;
> 2. **one slot could still back several PAYABLE sessions**, which the commit
>    cannot fix because it runs after the money has moved.
>
> **What shipped instead** (all in `connect/promoCodes.ts` unless noted):
>
> - **`PromoReservation.sessionId`** — the slot names the ONE session that may be
>   paid against it. A refresh CLOSES that session at Stripe before writing
>   anything (`paid` ⇒ `promo_purchase_paid`, `failed` ⇒ `promo_busy`, both
>   writing nothing so the previous owner keeps the slot); the reserve transaction
>   compare-and-sets on it; and `bindPromoCheckoutSession` closes a session it
>   cannot bind, before any URL is returned.
> - **Release moved to positive evidence.** `checkout.session.expired` →
>   `handleCheckoutExpired` is the primary path; lazy expiry moved from +4 to
>   **+`PROMO_RESERVATION_BACKSTOP_MINUTES` (60)** so it is a backstop rather than
>   a race against Stripe's own delivery. `resolveCheckoutHoldWindow` returns
>   `promoHoldMinutes` beside `holdMinutes`; gift-card holds keep the 4-minute
>   margin and their `31 + 4 === 35` parity.
> - **The commit is a HARD GATE.** `usage_count` never exceeds `max_uses` and
>   `PromoRedemption.count` never exceeds `max_uses_per_contact`, in every
>   ordering, unconditionally: a breaching commit writes nothing and logs at ERROR.
>   `overCap` no longer means "counted anyway and complained"; it means "refused".
>   The product consequence is named rather than made silently — the buyer has paid
>   and KEEPS the purchase, only the bookkeeping is refused (honour-and-don't-count
>   over a system-initiated refund of a wanted purchase).
>
> **The residual, stated because an honest one is fine and a false "hard, in every
> ordering" is not:** the number of *discounted prices charged* can exceed
> `max_uses` by one per occurrence of a single ordering — payment completed, its
> webhook delivered more than 60 minutes after that session's expiry, against a
> slot that lapsed and was re-handed and spent meanwhile. The counters are what is
> bounded hard.
>
> **CORRECTED post-implementation (round-4 self-check), because this paragraph
> overclaimed twice.** It said the residual is "Logged at ERROR at both ends"; it
> is not. On this ordering `lostTo` is **null by construction** — the entry is
> absent AND our own deadline has passed, which is exactly the case that counts —
> so the CAP GATE line is the residual's ONLY log. `lostTo` covers different
> orderings (`not_ours`, `removed_early`). And "by one per occurrence" is right
> per occurrence but must not be read as one per campaign: nothing bounds the
> number of occurrences, and they are positively CORRELATED, since an hour-late
> delivery is normally a webhook outage rather than an independent event. What
> stops it being a quiet promo-only leak is that the same late event carries the
> sale's own confirmation. Both refusal logs now also name the contact, the
> identity key and the Stripe Checkout Session. The manager release lever is a
> SECOND route to the same residual, and an unbounded one — it frees every live
> slot without closing the sessions they back. See `docs/promo-codes.md` →
> "What is bounded, and the residuals". Fixtures:
> "ONE SLOT BACKS AT MOST ONE PAYABLE SESSION" and "the LATE WEBHOOK, both ways
> round" in `connect/promoLifecycle.test.ts`; the window rule in
> `connect/checkoutWindow.test.ts`. Full account: `docs/promo-codes.md`.

**One writer of `usage_count`, ever** (N8), and it writes an **absolute** value
computed from its own read set — the discipline `docs/wave3-phase2-spec.md` §1
invariant 7 established for `bookings_count`. `FieldValue.increment` never
touches `usage_count` or `PromoRedemption.count`.

```ts
export async function commitPromoRedemption(params: {
  teamId: string; code: string; reservationKey: string
  /** Fallbacks ONLY. The reservation is authoritative for identity — see below. */
  fallbackContactId?: string | null
  fallbackIdentityKey?: string | null
  fallbackAmountMajor?: number            // from checkout metadata, for a late DELIVERY
  targetKind?: PromoScopeKind
}): Promise<{ committed: boolean; replay: boolean; overCap: boolean }>
```

**Identity comes from the RESERVATION, not from the webhook.** Revision 1 typed
`contactId: string` and sourced it from `verifiedMetadataContact(team.teamId,
md)`, which returns `string | null` (`webhook.ts:356-363`) — null whenever
`md.contactId` is absent, or the contact document no longer exists, or its
`teamId` no longer matches. The gift card tolerates null there because
`contactId` is only a journal label for it (`giftCards.ts:411`); for the promo it
would be the **doc id of the durable ledger**. A guest who books a drop-in with a
code, stalls on the Stripe page, and whose provisional contact is hard-deleted
overnight by `purgeProvisionalContacts` would produce a write to
`redemptions/undefined` — swallowed by the best-effort `try/catch`, discount
given, count never moved, no signal. So:

```
identity = reservation.identityKey ?? fallbackIdentityKey ?? null
contact  = reservation.contactId   ?? fallbackContactId   ?? null
```

The reservation is the right source because the callable that minted it *knew
who was buying*; the webhook only knows what survived. When neither is available,
still increment `usage_count`, **skip** the ledger write, and log at **error**
level — the global count must not silently under-report just because one person
became unidentifiable.

Read set: `tx.get(promoRef)` + `tx.get(redemptionRef)` (by `identityKey`). Body:

```
res    = promo.reservations?.[reservationKey]
amount = res?.amountMajor ?? fallbackAmountMajor

CAP TRIPWIRE (money's BLOCKER 2, adopted)
  max_uses != null && (promo.usage_count ?? 0) + 1 > max_uses
     → still commit (the money already moved; refusing to count is strictly
       worse than an off-by-one), but return { overCap: true } and log at ERROR.
       With N9 two-sided (§5.3) this is close to unreachable: Stripe refuses
       payment on an expired session, and the reservation outlives the session.
       It is a TRIPWIRE, not a routine path — if it ever fires, N9 is broken.

tx.update(promoRef, {
   usage_count: (promo.usage_count ?? 0) + 1,                   // ABSOLUTE, from the read set
   reservations: { …without reservationKey },                   // consume it
})
if (identity) tx.set(redemptionRef, { teamId, code, identityKey: identity, contactId: contact,
   count: (redemptionSnap.data()?.count ?? 0) + 1,              // ABSOLUTE, from the read set
   first_at: existing?.first_at ?? now, last_at: now, … }, { merge: true })
```

**There is no `committed` map, and replay is still guaranteed.** Revision 1 kept
a per-reservation `committed` marker as its replay guard, which is what made the
document unbounded (§5.1) and what would have collided with the deterministic
reservation key on a second legitimate purchase of the same target. Neither is
needed, because both commit paths are already once-only:

- **Stripe path.** `handleConnectWebhook` claims `connect_webhook_events/{eventId}`
  with `.create()` *before* dispatching, and a duplicate delivery short-circuits
  with a 200 (`webhook.ts:2026-2038`). A Checkout Session completes exactly once,
  so exactly one `checkout.session.completed` event exists for it.
- **Full-cover path.** It runs synchronously inside the callable, after a booking
  transaction that already refuses a second attempt (the already-registered
  guard, `dropIn.ts:497-499`, and the course/product entitlement writes are
  keyed by contact).

`fallbackAmountMajor` survives for a different reason than revision 1 gave: not
for a payment landing after the reservation expired (N9 makes that a tripwire),
but for a **late webhook delivery** — Stripe retries over hours, and the
reservation may legitimately be gone by the time the event arrives.

**Why the gift card still needs `committed_holds` when the promo does not**, so
nobody reads this as an inconsistency: that marker is not only a replay guard. It
carries `reclassed_at`, which makes the *reclass pair* separately idempotent
(`giftCards.ts:466-495` deliberately falls through and retries when the marker
exists but the stamp does not), and refunds read it for the amount that actually
moved (`webhook.ts:1458-1462`). A promo has no second write to make idempotent
and no amount to recover — it has a counter and a ledger row, both written in one
transaction.

**Where it is called from — the four CONFIRM points, the two full-cover branches,
and nowhere else:**

| Path | Where | Why there |
|---|---|---|
| Drop-in, paid | `handleDropInCheckout`, **after** the confirm transaction succeeds — beside where the drop-in stamps `trial_used_at` | Not before the dispatch, and not at the top of the handler: see below |
| Appointment, paid | `handleAppointmentCheckout`, after `confirmed = true` (`webhook.ts:1848`) and past every `refundReason` branch | ditto |
| Product, paid | `handleProductCheckout` (`webhook.ts:1150`) | This handler never refunds; its two early `return`s (no email, contact cap) leave the payment standing, so the use IS consumed — and identity comes from the reservation, so the commit does not need the handler's `contactId` |
| Course, paid | `handleCourseCheckout` (`webhook.ts:1207`) | same |
| Gift-card FULL COVER (no Stripe session, no webhook) | inside the full-cover branch that records the sale — `dropIn.ts:560-685`, `payments.ts:546-568`, `payments.ts:761-789` | That branch is "the only place the sale can be recorded at all" (`payments.ts:556-558`). If the promo commit is not there, it never happens |
| Never | `commitGiftCardDrawdown` | §0.4(a). **P3-G deletes the `promoRedemptionId` parameter** at `giftCards.ts:427` and replaces the comment with the reason, so a fourth reader does not re-add it |
| Never | `handleCheckoutCompleted`, before the per-kind dispatch (`webhook.ts:945-969`) | Revision 1 put it here, beside the gift-card commit. See below |

**Why NOT beside the gift-card commit, which is the obvious spot.** Because four
branches inside the per-kind dispatch are **system-initiated full refunds**,
where the platform itself has decided the purchase did not happen:

| Branch | Where | What it does |
|---|---|---|
| drop-in, duplicate charge | `webhook.ts:1445-1490` (`dropin-dup:`) | refunds in full, and restores the gift card via `reverseGiftCardDrawdown` (`:1464`) |
| drop-in, class filled after checkout | `webhook.ts:1574-1607` (`dropin-full:`) | refunds in full, restores the gift card (`:1592`), releases the waitlist offer |
| appointment, duplicate charge | `webhook.ts:1710-1726` (`apt-dup:`) | refunds in full |
| appointment, `slot_retaken` / `missing_session` | `webhook.ts:1860-1878` (`apt-refund:`) | refunds in full |

A commit placed before the dispatch has already run when those fire. The buyer
ends with no seat, no charge, and a code they can never use again; the studio's
campaign is down a use, with §8.1 shape 4 forbidding any notification that would
tell them. The gift card's answer to exactly this is a **compensating reversal**
twenty lines away — but a promo reversal is a **second writer of `usage_count`**,
which is precisely the §8.1 shape-2 defect (a counter adjusted four times) this
phase exists to foreclose. Committing at the confirm point instead needs no
reversal at all, because the reservation simply lapses. Hence the rule:

> **A use is consumed by a completed sale, never by an attempt.** Wherever the
> platform refunds the whole charge itself, nothing is committed; the reservation
> expires on its own timer and the slot returns.

That answers the harder half of §10 Q2 by construction. The remaining question —
whether a *human*-initiated refund or cancellation should give a use back — is
genuinely open and stays there.

**Every commit is best-effort and wrapped in `try/catch`**, like its gift-card
neighbour (`webhook.ts:964-968`). A promo commit that throws must not stop the
booking from confirming: the customer paid the discounted price and owning the
seat matters more than the count. The cost is a reservation that lapses instead
of committing — the count under-reports by one, which is the safe direction (a
lapsed reservation frees a slot; a lost booking does not come back).

### 5.3 Expiry, and the timer-ordering rule

**N9 is TWO-SIDED**, and revision 1's one-sided version pointed the wrong way.

Revision 1 said only *"a reservation may never expire before the Checkout Session
it guards"*. That bound is unbounded above: on a rail whose session lives 24
hours, it forces a 24-hour reservation, and one abandoned cart locks a slot of a
scarce campaign for a day. All three reviews caught it, and two of them caught
the factual error underneath (B3b): the plain product and course sessions **do**
live 24 hours today, so revision 1's own "these are fixed at 31 minutes" was
false for exactly the promo-only case. The rule is therefore stated with both
bounds, and the session length is made SHORT wherever a reservation rides it:

```
PROMO_RESERVATION_MARGIN_MINUTES = 4          // the generalised 35-vs-31 gap

sessionExpiresAtMs   = the ONE instant passed to Stripe as expires_at
reservation.expires_at = sessionExpiresAtMs + MARGIN
giftCardHoldMinutes    = ceil((sessionExpiresAtMs − now) / 60_000) + MARGIN   ← B3's fix

N9:  sessionExpiresAtMs  <  reservation.expires_at  ≤  sessionExpiresAtMs + MARGIN
     — and, on every rail but a waitlist claim,
     sessionExpiresAtMs  ≤  now + SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES
```

Per-rail, after P3-B2 (the third column is the change):

| Rail | Session expiry today | With a promo and/or a gift card |
|---|---|---|
| Drop-in, plain | 31 min (`dropIn.ts:840-842`) | unchanged, 31 |
| Drop-in, waitlist claim | the claim window, clamped to 24 h (`resolveClaimCheckoutWindow`) | **unchanged** — see below |
| Appointment | 31 min (`CHECKOUT_EXPIRY_MINUTES`, `appointments/checkout.ts:35`) | unchanged, 31 |
| Product, gift card | 31 min (`payments.ts:585`) | unchanged, 31 |
| Product, plain | **24 h (Stripe default — no `expiresAtEpochSeconds`)** | **31 min when a promo rides it**; still 24 h when nothing does |
| Course, gift card | 31 min (`payments.ts:806`) | unchanged, 31 |
| Course, plain | **24 h (Stripe default)** | **31 min when a promo rides it**; still 24 h when nothing does |

**The waitlist claim keeps its own deadline, deliberately.** Clamping a claim's
session down to 31 minutes would re-break Phase 2's central invariant — the
booking hold, `offer_expires_at` and the Stripe session are ONE instant, and
`dropIn.ts:521-528` says why in as many words ("Two timers for one seat is how a
seat gets sold twice"). So on this rail alone the promo reservation inherits the
claim window: at the 120-minute default, applying a code to a claim locks that
use for ~124 minutes, and a studio configuring a longer window lengthens that up
to Stripe's 24-hour ceiling. That is a real, stated cost — **§10 Q11** asks
Franco whether the promo field belongs on the claim page given it.

**The product/course change is customer-facing**, not an internal detail: a buyer
who applies a code goes from a 24-hour payment window to ~31 minutes. **§10 Q10**
puts it to Franco. My recommendation is to ship it — the alternative is one
abandoned cart holding a scarce code hostage for a day — and to note that the
gift-card branches already made exactly this trade for the same reason.

**Release paths — the rule, then the checklist.** `releasePromoReservation({
teamId, code, reservationKey })` is `tx.get` + `tx.update` deleting the key; a
missing key is a no-op, so it is idempotent.

> **RULE (structural, not a list):** every path from the promo reserve to the
> successful return releases the reservation. P3-H implements this as a single
> guard spanning §2.4 steps 5–7, with a `releaseReservedPromo` closure defined
> immediately after the reserve — mirroring `releaseReservedGiftCard`
> (`dropIn.ts:538-546`) — and the gift-card reserve INSIDE it. Release order is
> the reverse of reservation: gift card first, then promo.

The known throw sites, as a **verification checklist** (P3-H's verify step forces
each one and asserts the promo doc holds zero reservations afterwards):

| # | Site | Notes |
|---|---|---|
| 1 | `reserveGiftCardDrawdown` not-found | `giftCards.ts:217-219` — the mistyped gift-card code, i.e. the flagship §2.5 case with one character wrong |
| 2 | `reserveGiftCardDrawdown` currency mismatch | `giftCards.ts:239-244` |
| 3 | `reserveGiftCardDrawdown` unusable | `giftCards.ts:251-255` |
| 4 | full-cover booking transaction | `dropIn.ts:637-640` (releases only the card today) |
| 5 | pending-hold booking transaction | `dropIn.ts:766-769` (same) |
| 6 | `startOneOffCheckout` | `dropIn.ts:845-849`, `payments.ts:588-592`, `payments.ts:809-813`, `appointments/checkout.ts:214-239` |
| 7 | `runAppointmentSlotTransaction` | `appointments/checkout.ts:180` — **outside** today's try/catch; P3-H moves it inside the guard. Two visitors racing one slot with the same code is the case. **But the catch must then release only the PROMO on this site, never the slot hold — the hold was never acquired, and the doc id is shared with the winner. See the correction box in §2.4.** |
| 8 | `handleCheckoutExpired` | `webhook.ts:1961-1987`, beside the gift-card release at `:1964-1970`, which already runs for **any** kind |

Sites that revision 1 listed and that are NOT release points, so nobody adds a
call there: the trial-eligibility throw (`dropIn.ts:481-485`), the
already-registered guard (`:497-499`) and the capacity pre-flight (`:515-519`)
all now run **before** the reserve (§2.4 step 4), so there is nothing to release.
Revision 1 cited `dropIn.ts:534-546` as the capacity refusal's existing release —
that is the helper's *definition*, and its own comment is wrong about its callers
(B7, fixed in P3-H).

Plus lazy expiry as the backstop. No sweep job, no cron entry (N13).

**And one manager lever, because lazy expiry is not always fast enough.**
`releasePromoReservations({ code })` clears **all** live reservations on one code
(§7.1). "The code says exhausted but nothing sold" is the support ticket this
feature will generate most — a burst of abandoned carts, a studio testing its own
code, a `promo_busy` ceiling hit — and without a lever the answer is "wait". It
writes only the `reservations` map, never `usage_count`, so it is **not** a
second counter writer and N8 survives intact.

### 5.4 A booking that is later cancelled or refunded

**First, the half that is NOT a question.** When the *platform itself* refunds
the whole charge — the four branches tabulated in §5.2 — nothing was ever
committed, because the commit sits at each handler's confirm point and those
branches return before it. The reservation lapses on its own timer and the slot
comes back. No restore path, no second writer, no manager action. That is
settled by construction, and it is the shape the gift card already treats as
obvious twenty lines away (`reverseGiftCardDrawdown` on the same two drop-in
branches).

**Second, the half that IS a question: a HUMAN-initiated refund or cancellation.**

**v1 does not restore a redemption.** A committed redemption stays committed
through a studio cancellation, a manual refund or a dispute.

The reasoning is the one-writer invariant, not indifference. A restore path is a
**second writer** of `usage_count` and of `PromoRedemption.count`, with an
ordering question against the webhook (a refund can land before or after a late
commit) and a reversal marker of its own — the exact shape that produced
"a counter adjusted four times" in Phase 2. Against that, the cost of not
restoring is bounded and visible: a 50-use campaign that suffers three refunds
effectively becomes 47, and the studio raises `max_uses` — one edit, in the admin
UI, auditable.

Two consequences are stated rather than discovered:

- **A studio-side cancellation can permanently bar a customer** whose
  `max_uses_per_contact` was 1. The remedy is a manager action —
  `clearPromoRedemption({ code, contactId })` or `({ code, email })`, which
  deletes that one `redemptions/{identityKey}` doc (§1.1). It does **not** touch
  `usage_count`, so it is not a second writer of the global counter; it only
  forgives the per-person bar.
- **A globally stuck code has its own lever**, added in revision 2:
  `releasePromoReservations({ code })` (§5.3). The two are the *only*
  manager-facing corrections, and both are deletes of lifecycle state rather than
  adjustments of a counter — which is how N8 stays true with a support story.
- **The finance journal already tells the truth** — the refund row is built from
  the actual (discounted) charge, so the books never disagree with the customer's
  statement (§6).

§10 Q2 puts the product half of this to Franco with the implementation cost of
the alternative stated.

### 5.5 Idempotency on retry

| Retry shape | Guard | Where |
|---|---|---|
| Double-submitted checkout (double click, Back button, dropped redirect, changed card) | The reservation key is **deterministic**, so the second call REFRESHES the first person's own reservation and consumes nothing. Neither cap can refuse a purchase already in flight | §5.1 |
| Re-submitting after changing the code or the card **inside the same minute** | The idempotency key gains the applied instruments — see below | P3-H |
| Redelivered `checkout.session.completed` | `connect_webhook_events/{eventId}` is claimed with `.create()` **before** dispatch (`webhook.ts:2026-2038`); the duplicate short-circuits with a 200 and the handler never runs | §5.2 |
| Late webhook **delivery** (Stripe retries over hours, reservation already gone) | `fallbackAmountMajor` from checkout metadata, exactly as `md.giftCardDrawdown` serves the card (`webhook.ts:947-951`) | §5.2 |
| Two concurrent claims of the last use | Serialised on `promoRef`; one wins, the other gets `promo_exhausted` | §5.6 |
| Manager double-submitting the create form | `.create()` on the code doc → `ALREADY_EXISTS` → `already-exists { reason: 'code_taken' }`. **No retry loop** (§1.1) | P3-J |

**The Stripe idempotency key must include the applied instruments.**
`defaultIdempotencyKey(prefix, ...parts)` buckets by minute
(`checkout.ts:88-90`) and its parts carry only the rail's entity ids and the
contact — never the gift-card code and, in revision 1, never the promo code.
Stripe **rejects a reused idempotency key whose request parameters differ**, and
a promo changes both `amountMinor` and the metadata. Revision 1 cited this key as
a guard; it is in fact a new failure source, because the promo makes "re-price
and resubmit" the primary interaction rather than an exotic one:

> A visitor submits at 40.00, is bounced back by a validation message, types
> `AUTUMN25` and resubmits twelve seconds later → same minute bucket, same key
> `dropin:{team}:{session}:{contact}:{minute}`, different amount → Stripe returns
> an idempotency error → `startOneOffCheckout` maps it to a bare `internal`
> "Failed to start checkout" (`checkout.ts:226-229`) → the guard releases the
> promo reservation → she retries and, in revision 1, hit `promo_already_used`.
> Two unrelated-looking failures from one click.

**Fix (P3-H):** append the applied instruments to the key parts —
`defaultIdempotencyKey('dropin', teamId, sessionId, contactId, promoCode ?? '', giftCardCode ?? '')`
and the equivalent on the other three rails. **Appended last, never reordered**:
`moneyCore.test.ts:103-120` snapshot-tests the existing (prefix, parts) → key
shapes precisely because "the per-callable prefixes and part orders are
load-bearing for Stripe retry dedup across a deploy window"
(`checkout.ts:84-87`). A call with no instruments produces a byte-identical key
and the snapshot test stays green; §12 gates both halves.

**No `committed` map to prune.** Revision 1 mirrored `pruneCommittedHolds` at 90
days; §5.1 (size) and §5.2 (replay) explain why the map is gone entirely
instead. Nothing on the promo doc needs pruning: live reservations are dropped
lazily by `promoLiveReservations` inside any transaction that already holds the
doc, and there is no other accumulating field.

### 5.6 The concurrency argument, stated so it can be checked

Claim: with `max_uses = 1` and N concurrent `createDropInCheckout` calls for the
same code, exactly one reservation is created.

1. Every one of the N calls runs `reservePromoRedemption`, whose read set
   includes `promoRef` and whose write set includes `promoRef`.
2. Firestore read-write transactions are serializable; two transactions that
   both read and write the same document cannot both commit against the same
   snapshot — one retries and re-reads.
3. On re-read, the winner's reservation is in `live`, so the cap test refuses.
4. The predicate that decides this is **`promoUsesLeft`** — one expression
   covering **both** halves of the boundary (§1.2), called by the transaction,
   the preview and the admin list against the same fields. Revision 1 asserted
   this property while its helper took no identity parameter and the transaction
   inlined the global test, so the per-person half was necessarily decided twice;
   the property is now built rather than claimed.
5. A retry by the same person is not a fifth claimant: the deterministic key
   makes it a refresh of an entry already counted (§5.1).

The argument does **not** depend on any query, which is why it is unaffected by
the phantom-read question §0.3(a) of the Phase 2 spec had to leave procedurally
open. It also does not depend on the promo doc holding any committed history —
step 3 reads `usage_count` (a scalar) and `reservations` (bounded, §5.1).

---

## 6. Finance

**A promo code writes nothing to `finance_transactions`. Ever.**

A discount is not a money event. `docs/accounting.md:105` — *cash basis only,
entries mirror money events* — and the money event here is the (smaller) charge.
Concretely, on a CHF 40 drop-in with a 25% code:

```
Stripe PaymentIntent amount      3000 Rappen        ← already net of the promo
finance row: gross               3000
             stripe_fee          −XXX               (from the balance transaction)
             platform_fee        −YY                (computePlatformFee)
             net                 3000 − XXX − YY
assertFinanceInvariant: gross + stripe_fee + platform_fee === net   ✓ trivially
```

`assertFinanceInvariant` (`types/finance.ts:226-250`) requires every one of
`gross | stripe_fee | platform_fee | net` to be an integer minor-unit amount and
the identity to hold. The promo changed **one input** to the row — the gross —
and did not touch the identity. Nothing else in the journal moves.

**No `FinanceCategory` member.** `types/finance.ts:85-91` stays as it is; a
drop-in bought with a code is still `drop_in`. `mapCategory` (`:205-224`) gains
nothing. No chart-template break
(`packages/functions/src/accounting/chartTemplates.test.ts`), no
`by_category` change, no monthly-report change.

**No reclass pair.** `buildGiftCardReclassTxns` / `recordGiftCardReclass`
(`types/finance.ts:646-737`, `finance/journal.ts:75-87`) exist for exactly one
reason, stated at `types/finance.ts:72-84`: a gift card's revenue was **already
recognised** at sale time, in a different bucket, so redeeming it is an
*attribution change* and the only permitted write is a signed pair summing to
zero. A promo has no prior recognition to move. A "discount given" row would be
inventing a negative money event, and it would either break the
`gross + fees === net` identity or double-count against the charge row.

**The comp gift card is the exact precedent, and it was resolved the same way.**
`docs/fareharbor-analysis.md:340` — *"Comp → no journal entry (correct on cash
basis), stamped for audit"* — and `giftCards.ts:1018-1022` implements it: a
comped card writes nothing to the journal, and the card doc itself is the audit
record (`types/giftCard.ts:30-34`: "the card itself is the audit record, which
is why `issue_reason` is mandatory"). A promo is the same statement: **no money
moved, so nothing is recognised; the promo doc and its redemptions subcollection
are the audit record.**

**The cost of that, stated plainly.** "Discount given" is unrecoverable from the
journal. The studio can see *revenue* but not *forgone revenue*. That is the
right trade on a cash basis, and it is why §7.4's reporting answer matters: the
code is stamped on the **payment row** so a studio can ask "who used this and
what did they pay". The finance CSV export is a documented append-only public
contract (`docs/finance-reports.md:78-100`) and Phase 3 **appends nothing to
it** — §10 Q6.

---

## 7. Surfaces

### 7.1 Admin — create and manage

**Route.** `/offer/promo-codes`, in `sectionOffer` of the nav
(`apps/web/src/app/[locale]/(auth)/layout.tsx:166-213`), after Pricing
(`:180`). `minPlan: 'studio'` — **visible but locked**, which drives the upsell
modal (`:284`, `:298`), not `requiresPlan`, which would hide the lever entirely
and teach nobody that the feature exists. Not a plugin: plugin gating is for
substantial à-la-carte modules (`docs/product-strategy.md:372-406`,
`types/plan.ts:211-214`), and a promo code is a thin pricing lever.

**Page shape**, modelled on `GiftCardsSection.tsx:370-483` and the activities
editor's gate discipline (`offer/activities/page.tsx:30-34`, `:274-276`,
`:483-486`):

- **Header**: "Promo codes", the active count against
  `getPromoCodeLimits(plan).maxActiveCodes` ("4 of 20 active"), and a Create
  button disabled at the cap with an inline reason resolved through
  `usePlanName()` — never a hardcoded plan display name (CLAUDE.md).
- **Create dialog**: code (uppercased as typed, with the format hint), effect
  (`percent_off` / `fixed_price`), value, validity window (both ends optional),
  **total cap (REQUIRED)**, per-person cap (default 1), an optional "only for one
  person" contact picker (`restrict_to_contact_id`), scope checkboxes over the
  four `PromoScopeKind`s plus optional entity pickers, and an internal label.
  Submitted via the `createPromoCode` callable.
  - **CORRECTION (post-implementation): the entity pickers were the one clause of
    this line that did not ship**, so `activity_ids` / `course_ids` /
    `product_ids` existed in the model, were honoured by `promoAppliesTo` on every
    purchase, and could not be authored — a studio could not make a code that
    applies to one course. They are now three checkbox lists in the shape
    `BenefitEditor`'s subscription-type list uses (`useActivities`, `useCourses`,
    `useProducts`), each shown only while its rail is ticked, with **nothing
    ticked meaning everything of that kind** so there is no second way to say what
    an empty list already says. One picker serves both activity rails
    (`promoAppliesTo` reads `activity_ids` for `drop_in` and `appointment`), ids
    for an unticked rail are kept rather than pruned, and `PROMO_MAX_SCOPE_IDS` is
    now shared with `resolveScope`, whose truncation is silent.
  - **The total cap is required, not optional.** Revision 1 made it optional and
    the per-person cap 1, so the fastest path through the form produced an
    **uncapped code that each person may use once** — the shape that a leaked
    WhatsApp message turns into unbounded liability, with §8.1 shape 4 forbidding
    any alert that would surface it. Unlimited stays expressible, but only by
    ticking an explicit "no limit" box that carries the warning; the default path
    makes the studio type a number.
  - **The one-person binding is a first-class shape, not a workaround.** Service
    recovery ("sorry you got bumped from Tuesday, here's 20% off") is the most
    common manual discount a studio issues, and revision 1 could only express it
    as "set the total cap to 1 and hope the right person redeems first". It costs
    one field and one line in the reserve predicate, which already reads the
    caller's contact.
  - **Validation is promo-specific, not borrowed.** Revision 1 said "reuse
    `benefitPercentInvalid` / `benefitAmountInvalid`" — but both short-circuit to
    VALID when `subscriptionTypeIds.length === 0` (`BenefitEditor.tsx:76`, `:84`),
    and a promo form has no subscription types, so **both validate nothing**. A
    manager typing `150` into the percent field would pass the client and get a
    raw `invalid-argument` from the callable with no key to render. P3-K extracts
    the numeric half of each validator (or writes promo twins) and §7.6 adds
    `percentInvalid`, `amountInvalid`, `codeFormatInvalid`, `windowInvalid`.
- **List**: code, discount, window, **`used / max` AND `reserved`**, per-person
  cap, scope chips, status; row actions **Edit** (definition only — never the
  counter), **Release reservations** and **Disable**, the last two behind an
  `AlertDialog` (the destructive-action rule from CLAUDE.md's UI porting
  principles).
  - **Reserved is shown separately, and that is not decoration.** `usage_count`
    is committed-only while the cap is enforced against committed **+** reserved
    (§5.1), so a single number would let a manager read "3 of 20" while the code
    refuses every customer at 20 reserved. Both figures come from
    `promoUsesLeft` — the same expression the reserve transaction uses — so the
    page cannot drift from the gate.
- **A disabled code is not deleted.** `status: 'disabled'` stops new
  reservations; live reservations complete (N16). Deleting the doc would orphan
  in-flight checkouts and destroy the redemption ledger.

**The tier gate carries the stored value through, never reads it off a locked
control** — `offer/activities/page.tsx:483-486` is the pattern
(`waitlistEnabled: waitlistAllowed ? data.waitlistEnabled : (editing?.waitlistEnabled ?? false)`).
A downgraded team keeps its live codes redeemable and simply cannot create new
ones.

### 7.2 Public field placement — every surface

The shared widget: `apps/web/src/components/booking/PromoCodeField.tsx`,
mirroring `GiftCardRedeemField.tsx` — an optional input + Apply, a preview
callable, an `AppliedPromo` object lifted to the parent, an exported
`promoCheckoutErrorMessage(err, t)` so every surface shares the copy, and the
`colors` override for branded surfaces (`GiftCardRedeemField.tsx:46-54`).

Two deliberate divergences from the gift-card widget:

1. **It takes the target.** The preview is `previewPromoCode({ teamId, code, target })`
   and returns a **quoted price for this item**, not a balance.
   `checkGiftCard`'s `{ valid, balance, currency }` (`giftCards.ts:1029-1044`) is
   target-independent because a balance is a balance whatever you buy; a promo's
   validity is a function of *(code, target, contact, time)*. Copying that
   signature is how you ship a preview that says "valid" and a checkout that says
   "not for this class".
2. **Its copy lives in a new `Promo` namespace**, not in `Shop`.
   `GiftCardRedeemField` binds to `Shop` on every surface because gift cards are
   *sold* there (`:16-21`); a promo is not a shop item. The rule that matters —
   **one namespace for the widget, never a fork per surface** — is preserved.

| Surface | File | Mount point | Notes |
|---|---|---|---|
| Booking form, drop-in step | `apps/web/src/app/[locale]/(public)/public/[slug]/booking/BookingForm.tsx` | **Above** `GiftCardRedeemField` at `:1924-1931`, gated on **`willCharge && !isPricedTrial`** | Modifier above tender, in the UI as in the math. **Not** the bare `willCharge` gate revision 1 specified — see below |
| — its price breakdown | same file, the IIFE at `:1936-2005` | The breakdown is fed by **ONE** `resolvePaymentOptions(snapshot, target, { promo })` call | See "one computation" below — revision 1's claim that the rows are structurally exclusive was false |
| Shop buy modal | `.../public/[slug]/shop/ShopHome.tsx` | Above `GiftCardRedeemField` at `:1171-1178` | `promoEligible` mirrors `giftCardEligible` (`:512-514`): product and course only. Reuse the `checkoutKey` reset effect (`:521-532`) so switching items clears the code |
| **Not**: waitlist claim, pay step | `.../public/[slug]/waitlist/page.tsx` | **NO MOUNT — §10 Q11 answered NO.** | Q9 chose *never over-issue*, and this is the one rail whose deadline cannot be shortened without re-breaking Phase 2's one-deadline invariant: a code applied here would lock a use for the whole claim window (~124 min default, up to 24 h). Strict cap plus longest hold is the worst pairing in the design. The row below records what building it WOULD have required, so a later phase reversing Q11 does not rediscover it: **the subtle one.** The displayed price comes from `claimWaitlistSeat`'s server response (`claim.ts:211-224`), so a client-applied promo would disagree with it unless the preview returns its own quote — which it does. New reasons join `claimErrorKey` (`:126-154`), the single mapping shared by `claimWaitlistSeat`, `createDropInCheckout` and the promoter |
| Appointment picker | `.../public/[slug]/appointments/AppointmentPicker.tsx` | **New** — the first code field on this surface; on the verified pay screen beside the price at `:433-466` | Also adds `promoCode` to `createAppointmentCheckout`'s input (`appointments/checkout.ts:41-54`). The hold IS the session (`:124-191`), so the promo release must sit on the same failure path that releases the hold |
| **Not**: trial booking | `.../public/[slug]/trial-booking/TrialBookingForm.tsx:125` | — | `bookSession` only; no charge path, and §3.4 forbids a promo on a trial anyway |
| **Not**: kiosk walk-in | `.../public/[slug]/kiosk/WalkIn.tsx:127` | — | `bookSession`, class-only |
| **Not**: Space | `.../public/[slug]/space/**` | — | Entitlement display only; the catalogue is the Shop (CLAUDE.md) |

**The mount gate is `willCharge && !isPricedTrial`, not `willCharge`.** All three
reviews caught this and they are right: `willCharge` is literally
`(dropInAvailable && guestPath !== 'trial') || isPricedTrial`
(`BookingForm.tsx:736-738`), so it is **TRUE on the priced-trial door** — exactly
the door §3.4 guarantees a promo can never apply to. Revision 1 would have
rendered the field for the one visitor it is guaranteed to fail, on the
acquisition surface: a newcomer takes the trial at CHF 15, sees the field, types
the studio's live flyer code and is told "This code does not apply to this
booking" — while the *same* person taking the dearer drop-in door gets the
discount. §10 Q5 can still reverse §3.4; until it does, the field is not
rendered where it must fail.

**One computation, not two — the breakdown rule.** Revision 1 said "best-one-wins
makes the member and promo rows mutually exclusive — they never both render", as
if that were structural. In the client it is not. `memberDiscount`
(`BookingForm.tsx:1940-1941`) derives from `dropInMemberPrice`, a **separate**
client `resolvePaymentOptions` call at `:716-729` with no promo context that
returns the member price whenever a benefit is held; a promo row fed from the
preview's `quotedAmount` would be a **second, independent** computation. Two
independent computations do not become exclusive by assertion:

> Member holding a 20% benefit applies a 25% code to a CHF 40 drop-in.
> `dropInMemberPrice` → {32, base 40} → member row −8. Preview → 30 → promo row
> −10. The breakdown renders 40 / −8 / −10 / **22**, and Stripe charges **30**.

That is the same defect class the existing gift-card comment at `:1946-1949` was
written to prevent ("Showing the balance as the deduction promised −19.80 … and
then sent the customer to a Stripe page saying 0.50"). **Fix (P3-L):** each
surface's price display comes from ONE `resolvePaymentOptions(snapshot, target,
{ promo })` call and renders `appliedBenefit` **XOR** `appliedPromo` from that
one result — which is what actually makes them exclusive. The same instruction
applies to `ShopHome.tsx`'s `courseOptions` / `courseMemberPrice`
(`:470-484`) and to `AppointmentPicker.tsx`'s `toEffectivePrice` (`:139-159`),
each of which holds its own separate benefit computation today.
`planGiftCardRedemption(balance, afterModifier)` at `BookingForm.tsx:1951` still
needs **no edit**: it is already fed the post-modifier subtotal.

**The preview callable.**

```ts
previewPromoCode({ teamId, code, target: {
  kind: PromoScopeKind
  activityId?: string; sessionId?: string; durationMinutes?: number
  courseId?: string;   productId?: string; variantId?: string
  trial?: boolean
}})
→ { valid: true,  code, effect, percent?, amount?, baseAmount, quotedAmount,
    outcome: 'applied' | 'superseded' | 'not_needed' }
| { valid: false, reason: 'invalid' | 'not_applicable' | 'looks_like_gift_card' }
```

- **It builds its target and its snapshot through the SAME helpers the
  corresponding callable uses** (N22) — `resolveDropInForContact` with
  `usageAt = session.start`, `loadAppointmentBookingContext`, the course and
  product loads. This is a hard requirement, not a preference. Revision 1
  specified only the payload shape and called the result "advisory", but the
  divergence it permitted is a wrong **price** shown to a visitor, not a stale
  availability. The concrete case: `createDropInCheckout` and `claimWaitlistSeat`
  meter usage limits against the *class's own week* (`claim.ts:198`,
  `dropIn.ts:354-358`, `access.ts:186-191`), so a member on "3 per week" who has
  spent this week's allowance but books a class in nine days is **covered**. A
  preview metering against `now` would resolve them uncovered, price the drop-in
  at 40, apply 25% and show "you pay 30.00" — and then the checkout throws
  `failed-precondition` "You can already book this class for free"
  (`dropIn.ts:361-366`). Quoted a price for a class they can have for nothing,
  then refused.
- Rate-limited on its own bucket: `checkoutRateLimit(request.rawRequest?.ip, 'promo-check')`.
  The **charging** variant, not `assertUnderCheckoutRateLimit` — unlike a
  waitlist claim (whose token is unguessable and single-use, `checkout.ts:137-149`),
  a promo preview is an enumeration surface and every attempt must cost quota.
- It reads main collections through the Admin SDK, like `checkGiftCard`. The
  "public routes read only `public_profile`" rule binds the **client**, not a
  callable.
- **It is advisory about AVAILABILITY, authoritative about PRICE.** The reserve
  transaction may still refuse (`promo_exhausted`, `promo_already_used`,
  `promo_busy`) — the same posture as "the UI lock states are UX only;
  enforcement lives in the rules" (CLAUDE.md) — so every mount must handle a
  refusal at pay time, not only at apply time. But its `quotedAmount` is the
  figure the client sends back as `quotedAmount` at checkout (§2.4 step 3), which
  is what turns "the preview and the checkout disagreed" from a silent overcharge
  into an explicit `price_changed` refusal.
- It uses the contact session when one is present, so the per-person cap can be
  previewed; anonymously it previews the discount without the per-person check.
  That asymmetry is stated in §10 Q13 rather than hidden: an anonymous probe is
  the cheapest way to test a code, and it is also the only way a genuine guest
  can see a price before typing their name.
- **How much it reveals is §10 Q1** — an unresolved product question about
  whether a promo code is a secret. A code with `restrict_to_contact_id` set is
  **never** distinguished: it reports a bare `invalid` to anyone but its owner.

### 7.3 What the visitor sees

**On accept** — the applied chip ("Code AUTUMN25 applied — 25% off"), the
discount row in the breakdown, the new total, and an X to remove it. Identical
interaction to the gift-card chip (`GiftCardRedeemField.tsx:117-140`).

**On refusal**, each with its own key in the `Promo` namespace and its own
`details.reason` from the server:

| Reason code | Where it comes from | Copy |
|---|---|---|
| `invalid` | preview: unknown / disabled / outside window / **bound to someone else** (`restrict_to_contact_id`) | "We could not find that code." A bound code is deliberately indistinguishable from a nonexistent one |
| `promo_not_found` | reserve: the same set, discovered between preview and pay | maps to the same `invalid` copy — one sentence, two entry points |
| `promo_inactive` | reserve: the studio disabled it mid-checkout | maps to `invalid` |
| `not_applicable` | preview + `promoAppliesTo` | "This code does not apply to this booking." **Never a checkout refusal** — at pay time an inapplicable code simply yields no modifier and the purchase completes at list price (§2.4 step 1) |
| `looks_like_gift_card` | preview, `/^GC-/` | "That looks like a gift card — use the gift card field below." |
| `promo_exhausted` | reserve, global cap | "This code has just been fully used." |
| `promo_busy` | reserve, `PROMO_MAX_LIVE_RESERVATIONS` ceiling | "This code is busy right now — please try again in a few minutes." **A different sentence from `promo_exhausted` on purpose**: one means the campaign is over, the other means come back shortly |
| `promo_already_used` | reserve, per-person cap | "You have already used this code." Cannot fire for the caller's own retry — the deterministic key makes that a refresh (§5.1) |
| `promo_expired` | reserve, window closed between preview and pay | "This code has expired." |
| `promo_currency_mismatch` | reserve, `fixed_price` only | "This code cannot be used for this purchase." |
| `price_changed` | §2.4 step 3, the `quotedAmount` guard — **promo-carrying checkouts only** (see the post-implementation correction in §2.4) | `Promo.priceChangedTo` names `details.amount` and `Promo.continueAtPrice` offers the purchase at it; `Promo.priceChanged` stays as the fallback when no figure came back. Re-rendering alone is NOT the recovery — the surface would re-derive the same optimistic number and be refused again. **See CORRECTION 3 below: when a refused CODE is why the figure moved, this row is the wrong sentence and the refusal now names the real cause** |
| `superseded` (not an error) | Stage A | §3.3 — the code is accepted and explicitly explained |
| `not_needed` (not an error) | Stage A, **preview only** | §3.3 — unreachable at checkout time, where the coverage refusal fires first |
| `plan_required` / `plan_inactive` | `requirePlan` (`utils/plan.ts:19-44`) | Never reachable publicly: the gate is on **creation only** (N16). Recorded because `requirePlan`'s docblock (`:11-17`) requires every public caller to map both, and Phase 3 adds none |

`promoCheckoutErrorMessage(err, t)` maps the checkout-time half, exported from
the widget so the **three** surfaces that mount a promo field share it —
`BookingForm`, `ShopHome`, `AppointmentPicker` — the
`giftCardCheckoutErrorMessage` pattern (`GiftCardRedeemField.tsx:58-69`). The
waitlist claim page is NOT a fourth: it mounts no promo field (§10 Q11) and keeps
its own reason→copy map, in which `price_changed` is mapped defensively even
though it is doubly unreachable there.

> **CORRECTION 3 (post-implementation) — a refused code surfaced as
> `price_changed`, and the visitor was told something untrue.**
>
> The table above reads as if the two rows are alternatives. They are not: on the
> guest rails `price_changed` is the row that *fires*, for a reason the
> `not_applicable` / `audience_mismatch` rows describe. The loader REPORTS rather
> than throws (§2.4 step 1, deliberately — an inapplicable code must never block a
> purchase), so a refused code reaches Stage A as "no modifier", the server prices
> at list, the client's discounted quote is lower, and the `quotedAmount` guard
> refuses **first**. The code's own refusal was carried in the response body of a
> call that never returned one.
>
> It needs nothing to go wrong: `previewPromoCode` is never sent the guest form's
> email — it resolves the caller from a contact session or the Firebase auth token
> alone — so for a signed-out visitor it answers as an ANONYMOUS caller and
> accepts a `new_contacts` code. The checkout resolves that same code against the
> email actually typed, which may belong to a member, and refuses it there and
> only there. The visitor read "The price changed while
> you were checking out" — a sentence about the studio's pricing, when the
> studio's pricing never moved.
>
> **Fixed:** `assertQuotedAmount`'s scope gains `promoRefusal?: string | null`,
> the four callables pass `promo.refusal`, and the refusal carries it beside
> `details.amount`. The mounts compose one sentence through `priceChangedMessage`
> (`PromoCodeField.tsx`): the SAME copy key the Apply button uses for that
> refusal, then `Promo.priceWithoutCode` ("Without the code, this costs X.")
> instead of `Promo.priceChangedTo`.
>
> Three things are deliberate. `reason` **stays** `price_changed` — it is true,
> and it is the token every mount's recovery branch keys on, so the cause is
> additive and a mount that ignores it recovers exactly as before. The copy is the
> refusal's existing key, so one refusal never has two sentences depending on when
> the visitor hears it. And a named cause can never *create* a refusal: it only
> describes one the amount comparison already made (pinned by a fixture).

### 7.4 Analytics and reporting

Ranked by how badly a promo needs to appear, and bounded by
`docs/fareharbor-analysis.md` §7's third non-goal (over-complex reporting):

1. **The promo admin list itself** — `used / max` **and `reserved`**, window,
   per-code. This is the report a studio actually wants ("did the flyer work"),
   it has no home today, and it is nearly free: the numbers are on the doc, read
   through `promoUsesLeft` so the page and the gate cannot disagree. Showing only
   `usage_count / max_uses` — revision 1's version — would let the page read
   "3 of 20" while the code refuses every customer at 20 reserved (§7.1).
2. **The payment row.** `PaymentLineItem` (`types/payment.ts:46-58`) gains
   `promoCode?: string | null`, stamped by the webhook from checkout metadata
   and by the full-cover branches. This makes the discount visible in the
   payments dashboard (`apps/web/src/app/[locale]/(auth)/payments/page.tsx`, via
   `PaymentsTable.tsx` and `lib/payments.ts`), the contact detail Payments tab
   and the Space payments list — all three render the same rows, so one stamp
   serves all. `PaymentLineItemKind` gains **no** member: a drop-in bought with
   a code is still `drop_in`. `MemberPayment.kind`'s union is widened to match
   what the webhook already writes (B5).
3. **The finance journal and the CSV export**: unchanged (§6, §10 Q6).
4. **`/offer/pricing`** (`apps/web/src/lib/pricingSurface.ts`): `PriceCell`
   learns `appliedPromo` and `source: 'product'` becomes live. The page's whole
   guarantee is that it "can never disagree with what a booking/checkout would
   actually charge" (`pricingSurface.ts:1-4`), so `fromResult` (`:142-186`) is a
   **required** consumer, not an optional one. Its exhaustive `CoverageVia`
   switch (`:157-174`) is a compile gate — use it, do not defeat it.
5. **No campaign analytics module.** No attribution dashboard, no cohort lift,
   no per-channel ROI. Explicitly out (§11).

### 7.5 Plan tier — Studio, and why

Studio, per the recorded decision at `docs/fareharbor-analysis.md:271`
(*"Promo codes | **Studio** | A growth lever, and it sits alongside
Referrals"*), in the same table that put Waitlist on Coach and Waivers on Studio.
Three independent supports:

- **Tiering axis.** `docs/product-strategy.md` §2 defines Coach as *run
  sessions, get booked, get paid* — its Monetization block is subscriptions,
  packages, payment tracking: mechanisms for **charging**, not for **campaigns**.
  Studio's stated goal is *"Monetize members / Increase engagement"*, and its
  **Growth** block contains exactly one item today: the referral program. A promo
  code is the second member of that set — both are coded, capped,
  campaign-shaped instruments a business runs to acquire.
- **Free inherits Coach.** The Free tier is *"Full Coach feature set,
  differentiated by limits, not feature flags"*. Putting promos on Coach
  therefore puts them on Free, where a 15-contact hobbyist running discount
  campaigns is not a real persona and the feature is pure cost.
- **Gate mechanics.** A plain `requirePlan(teamId, 'studio')` on `createPromoCode`
  (and only there), mirroring the waitlist's client-constant + server-twin
  pattern (`offer/activities/page.tsx:30-34` + `booking/waitlist/join.ts`), plus
  `PROMO_CODE_LIMITS` for the active-code count. **Gates control creation only**
  (`docs/fareharbor-analysis.md:342`): existing codes stay redeemable through a
  downgrade, existing reservations complete, `previewPromoCode` and every reserve
  / commit / release path are ungated. N16.

### 7.6 i18n

New `Promo` namespace in all four of `apps/web/messages/{en,de,fr,it}.json`.
`en.json` first, then the same key set in the other three immediately.

Existing namespace anchors verified in this tree (several namespaces share key
names, so anchor on a key **unique to the target namespace**): `Nav` `:23`,
`Benefit` `:1250`, `Waitlist` `:1529`, `Appointments` `:1716`,
`PaymentsDashboard` `:2997`, `Shop` `:3162`, `Products` `:3239`,
`PublicBooking` `:3644`.

Keys, by namespace:

- **`Promo`** (new — the widget and every visitor-facing outcome):
  `label`, `optional`, `placeholder`, `apply`, `applied`, `remove`,
  `checkError`, `invalid`, `notApplicable`, `looksLikeGiftCard`,
  `audienceMismatch`, `exhausted`, `busy`, `alreadyUsed`, `expired`, `currencyMismatch`,
  `priceChanged`, `supersededByBenefit`, `supersededByBase`, `notNeeded`,
  `discountRow`.
- **`Nav`**: `promoCodes`.
- **`PromoCodes`** (new — the admin page): `title`, `subtitle`, `create`,
  `codeLabel`, `codeHint`, `codeTaken`, `codeFormatInvalid`, `effectLabel`,
  `effectPercent`, `effectFixed`, `percentLabel`, `percentInvalid`,
  `amountLabel`, `amountInvalid`, `windowFrom`, `windowUntil`, `windowInvalid`,
  `maxUsesLabel`, `maxUsesHint`, `maxUsesRequired`, `maxUsesUnlimited`,
  `maxUsesUnlimitedWarning`, `perContactLabel`, `perContactHint`,
  `restrictToContactLabel`, `restrictToContactHint`,
  `audienceLabel`, `audienceAll`, `audienceNewContacts`, `audienceHint`,
  `scopeLabel`, `scopeDropIn`, `scopeAppointment`, `scopeCourse`, `scopeProduct`,
  `labelLabel`, `usedOf`, `reserved`, `reservedHint`, `unlimited`,
  `statusActive`, `statusDisabled`, `disable`, `disableConfirm`, `edit`, `empty`,
  `capReached`, `requiresPlan`, `clearRedemption`, `clearRedemptionConfirm`,
  `releaseReservations`, `releaseReservationsConfirm`.

Two of these carry load-bearing copy rather than labels, and P3-N must not
paraphrase them away:

- **`perContactHint`** states what the cap actually binds to — *"Counted per
  email address. Pair a public code with a total cap."* §1.1 explains why
  claiming more would be false.
- **`reservedHint`** explains the second number — *"In checkout right now.
  These count toward the total until they are paid or expire."*
- **`PublicBooking`** / **`Shop`** / **`Waitlist`** / **`AppointmentBooking`**:
  nothing new — each surface renders the widget, whose copy is in `Promo`.

**No email or SMS copy.** Phase 3 sends no notification of any kind (§8.1 shape 4).

---

## 8. Invariants

### 8.1 The four Phase-2 failure shapes, and how this design forecloses each

Named explicitly because each has a live equivalent here.

**Shape 1 — a predicate whose boundary cases were reasoned about one shape at a
time.** The equivalent is *promo applicability*: (arm × scope × window × global
cap × per-contact cap × currency × trial × covered). Foreclosed three ways:
(a) applicability is decided **once**, in the impure loader, and the resolver
receives an already-qualified `PromoModifier` (§2.1) — the arm never re-asks
"does this code apply here"; (b) the cap boundary
("the last use is reserved but not yet paid") is one expression,
**`promoUsesLeft`**, returning **both** halves and called by the reserve
transaction, the preview and the admin list (§5.6 step 4) — revision 1's
`promoGlobalUsesLeft` took no identity parameter and therefore forced the
per-person half to be decided twice, which is the defect wearing the fix's
clothes; (c) the fixture block is a **matrix**, not a list of anecdotes —
every arm × every outcome (§9 P3-E).

**Shape 2 — a counter adjusted four times.** The equivalent is `usage_count`.
Foreclosed by: exactly ONE writer (the commit transaction, §5.2), which writes an
**absolute** value from its own read set; **no `FieldValue.increment` anywhere**
on `usage_count` or `PromoRedemption.count`; **no restore-on-refund path** in v1
(§5.4), which is the second writer that would otherwise appear; and a grep gate
in §12. `clearPromoRedemption` is a *delete* of a per-contact doc, not an
adjustment of the global counter.

**Shape 3 — comments asserting preconditions the code did not establish.** There
are **three** live examples in this tree and all are fixed here rather than
inherited: the `promoRedemptionId` rider, whose own comment argues against itself
(§0.4(a) — deleted in P3-G); the gift-card hold-key comments (B4 — fixed in
P3-A); and `releaseReservedGiftCard`'s comment naming a caller that does not
exist (B7 — fixed in P3-H). Revision 1 of *this* spec then reproduced the shape
twice more, which is the strongest available argument that the rule needs
teeth: `PromoReservation.amountMajor`'s docstring claimed an enforcement nothing
implemented (fixed in §1.2), and §5.3's release list cited B7's stale comment as
evidence for a design decision. The forward rule: **every precondition comment in
the promo code names the line that establishes it**, and every "must happen
before X" comment sits next to the ordering that enforces it (§2.4).

**Shape 4 — an entire notification layer specified but never built.** Foreclosed
by specifying **none**. Nothing is emailed or texted about a promo — not on
apply, not on commit, not on exhaustion, not on expiry. `booking/templates.ts`
gains nothing. Recorded in §11 so a later reader sees the absence was a decision.

The honest cost, since "the admin list says so" was doing more work in revision 1
than it could carry: a studio's only signal is a page it must remember to open,
and revision 1's version of that page reported committed uses only, so it could
not show contention at all. Revision 2 fixes the second half (the list shows
reserved separately, §7.4) and leaves the first half deliberately unfixed —
**§10 Q15** asks whether a single "your campaign has run out" email is worth the
plumbing, so the absence stays a decision rather than an oversight.

### 8.2 The invariants (N-series)

These are what the verify phase checks against.

**N1 — Stage A / Stage B.** A promo is applied **only** inside
`resolvePaymentOptions`, and no callable computes a discounted amount itself. A
gift card is applied **only** at the callable, against `pay.amount`. Nothing is
both.

> **CORRECTED: the grep gate as written now fails on correct code.** Revision 2
> said "`grep` for `promo` in `connect/checkout.ts` returns nothing". P3-B2
> deliberately put `PROMO_RESERVATION_MARGIN_MINUTES` in that file — it is the
> timer margin the ONE hold-window derivation owns, not a discount — so the
> literal grep returns four lines (the constant, two uses, one comment). The
> gate that means what N1 means is: **`connect/checkout.ts` imports nothing from
> `promoCodes.ts`, reads no `PromoModifier`, and contains no arithmetic on a
> percent or a code.** All three hold; verified against the file.

**N2 — the resolver stays pure.** `packages/shared/src/utils/paymentOptions.ts`
imports no firebase symbol, performs no I/O, and `resolvePaymentOptions` is a
function of `(snapshot, target, context)` alone. The impure half of the promo
(exists / active / window / scope / caps / currency) lives in
`packages/functions/src/connect/promoCodes.ts`.

**N3 — a promo can never produce a zero total.** `percent` is capped at 99 at
creation and every derived price clamps to `MIN_CHARGE_MAJOR`, so
`pay.amount >= 0.50` on every promo path. There is no promo-only
no-Stripe-session branch; the only full-cover path remains the gift card's.

**N4 — one decision, two projections.** `result.promo.status === 'applied'` ⟺
exactly one option carries `appliedPromo`, and both are written from a single
computed variable inside the resolver. `appliedBenefit` and `appliedPromo` are
never both present on one option — but a superseded benefit IS carried on
`appliedPromo.supersededBenefit`, so provenance survives a campaign (§2.2).

**N5 — a modifier never raises a price, and the comparator is asymmetric.** For
any base, benefit and promo, the resolved `pay.amount <= base`. A **benefit**
applies (and stamps) when `benefitPrice <= base`; a **promo** applies (and
stamps) only when strictly lower than the incumbent. Ties therefore keep the
member benefit's stamp and never let a promo claim a discount it did not give
(§3.2).

**N6 — the `product` arm never covers and never denies.** For every snapshot,
`resolvePaymentOptions(s, { kind: 'product', priceAmount })` returns exactly one
option, of type `pay`, with `denial: null`.

**N7 — reservations are written with `tx.update`, never `set(…, {merge:true})`.**
A merge would deep-merge the map and resurrect every expired key the same
transaction just dropped.

**N8 — one writer of `usage_count`.** `commitPromoRedemption`'s transaction is
the only code that writes `PromoCode.usage_count` or `PromoRedemption.count`
after creation, and it writes an absolute value computed from its own read set.
No `FieldValue.increment` touches either field anywhere in the repo. The two
manager corrections (`clearPromoRedemption`, `releasePromoReservations`) delete
lifecycle state and never adjust a counter.

**N8b — a use is consumed by a completed sale, never by an attempt.** The commit
runs only where a purchase is confirmed (§5.2's four handler confirm points and
two full-cover branches) and **never** on a branch that refunds the whole charge
(`dropin-dup:`, `dropin-full:`, `apt-dup:`, `apt-refund:`). No promo reversal
path exists, because none is needed.

**N9 — a reservation is bounded on BOTH sides against the checkout it guards.**
For every path that creates a Stripe Checkout Session with a promo reservation
and/or a gift-card hold, both derived from the **one** instant passed to Stripe:
`session.expires_at < giftCardHold.expires_at ≤ session.expires_at + PROMO_RESERVATION_MARGIN_MINUTES`
and
`session.expires_at < promoReservation.expires_at ≤ session.expires_at + PROMO_RESERVATION_BACKSTOP_MINUTES`.
Additionally, on every rail except a waitlist claim,
`session.expires_at ≤ now + SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES` whenever any
reservation rides the session. The claim rail's exception is stated and bounded
in §5.3.

> **CORRECTED (post-implementation).** The two upper bounds were one number (4)
> and are now two. A gift-card hold is released by a committed-hold marker, so a
> tight margin costs nothing; a promo slot is released by
> `checkout.session.expired`, and at +4 its lazy expiry raced Stripe's delivery of
> the OTHER webhook that decides the same slot — a lease in minutes cannot
> arbitrate an event whose delivery horizon is hours. See §5.2 CORRECTION 2 and
> `connect/checkoutWindow.test.ts`.

**N10 — a PROMO-CARRYING checkout never charges a price the caller was not
shown.** Two halves, because revision 1's N10 only had the first: (a) if the promo
reservation cannot be taken, the checkout is **refused** with a reason code and
never silently re-priced; (b) if the caller supplied a code **and** a
`quotedAmount`, and the resolver produced a HIGHER `payOption.amount`, the
checkout is refused with `price_changed` and the new figure — which the surface
then shows and offers, so the refusal is a decision point and not a dead end
(§2.4 step 3 and its post-implementation correction). Without a code there is no
quote to keep: the client's figure is an optimistic render the server is
documented as free to disagree with, and asserting it refuses ordinary sales.

**N10b — a supplied code always reaches the resolver.** If a `promoCode` was
passed to a checkout callable and the resolver result carries **no** `promo`
outcome at all, that is a programming error — the callable throws `internal`,
and never charges. This is what makes a missed resolver call site a loud failure
instead of a silent full-price charge (see §9 P3-H: `createDropInCheckout` has
**four** resolution points, not one).

**N11 — a promo that does not apply consumes nothing.** When
`promo.status !== 'applied'`, no reservation is written, `usage_count` is
unchanged and no `redemptions/{identityKey}` doc is created.

**N12 — `fixed_price` promos are currency-guarded; `percent_off` promos are
not.** The reserve transaction compares the promo's stamped `currency` against
the charge currency, case-insensitively, for `fixed_price` only.

**N13 — expiry is lazy; there is no promo sweep.** `promoLiveReservations` is
THE predicate and nothing re-derives it. No entry is added to `dailyTasks` or
`bookingRemindersHourly`.

**N14 — no client ever writes a promo document.** `firestore.rules` denies all
writes on `promo_codes/**`; every mutation goes through a callable.

**N15 — public routes read no promo document.** The client never reads
`promo_codes` directly; the only public read path is the `previewPromoCode`
callable, on its own `'promo-check'` rate-limit bucket.

**N16 — gates control creation only.** `requirePlan(teamId, 'studio')` is called
by `createPromoCode` and by nothing else. A team downgraded to `free` can still
have its live codes previewed, reserved, committed and released.

**N17 — the promo commit never rides on `commitGiftCardDrawdown`.** That
function's `promoRedemptionId` parameter is deleted, and its removal is recorded
on the line where it stood.

**N18 — i18n lockstep.** `apps/web/messages/{en,de,fr,it}.json` have identical
key **sets** in `Promo`, `PromoCodes` and `Nav`.

**N19 — the 60 existing resolver fixtures are unchanged.** `git diff` on
`packages/functions/src/booking/paymentOptions.test.ts` shows additions only, in
the six pre-existing `describe` blocks' region, plus new blocks — no edits to
any existing row, and `pnpm --filter @linyup/functions test` reports at least
551 passing / 8 pending / 0 failing.

**N20 — the promo document is size-bounded.** It carries **no** committed
history; live reservations are capped at `PROMO_MAX_LIVE_RESERVATIONS` in the
reserve transaction, one entry per person per target. Worst case ≈5 KB, two
orders of magnitude under Firestore's 1 MiB limit, for any campaign, forever
(§5.1). Falsifiable by grep: no `committed` field on `PromoCode`.

**N21 — a retry is a refresh, not a second use.** Two consecutive
`reservePromoRedemption` calls for the same `(code, identity, target)` leave
**exactly one** reservation, with the later expiry, and neither cap moves. The
reservation key is derived, never random (§5.1).

**N22 — the preview cannot quote a price the checkout would not charge.** For
each rail, `previewPromoCode` constructs its `PaymentTarget` and its
`ContactPaymentSnapshot` through the **same** helpers the corresponding callable
uses — including `usageAt` — so `quotedAmount` equals the amount that checkout
would resolve for the same caller at the same instant (§7.2).

> **CORRECTION (post-implementation).** This was asserted and not true on the
> course rail. `loadCoursePricing` was written for exactly this, imported by
> `payments.ts` — and never called: `createCourseCheckout` still assembled its
> own course refusals, its own contact + purchase reads, its own `relevantTypeIds`
> union and its own `CourseTarget`, with a comment claiming the two shared the
> helper. Two assemblies that must agree, plus a note saying they already do, is
> worse than an obvious duplication, because nothing fails when they drift. The
> checkout now calls the helper; `CoursePricing` gained `contact` (the audience
> gate's input, already read for the snapshot) and `listMajor` (the validated
> authored price) so no caller has to re-narrow `accessRule.priceAmount`.
> Falsifiable by grep: `loadCoursePricing` has two call sites, and
> `COURSE_PURCHASES_SUBCOLLECTION` no longer appears in `payments.ts`.

**N23 — one client computation per surface.** Every public price breakdown is
rendered from a single `resolvePaymentOptions(..., { promo })` result, and
renders `appliedBenefit` XOR `appliedPromo` from it. No surface holds two
independent price computations (§7.2).

**N24 — the Stripe idempotency key includes every instrument that changes the
request.** Re-submitting the same purchase with a different promo or gift-card
code inside one minute produces a different key and a fresh session; submitting
with no instruments produces a key byte-identical to `4b3177f`'s
(`moneyCore.test.ts:103-120` stays green unedited).

---

## 9. Work items

Ordered. Items inside an **⚛ ATOMIC GROUP** land in one commit.

---

### P3-A · Shared code normalisation, and the stale gift-card comments (B4)

**Files + symbols**
- new `packages/shared/src/utils/codes.ts` — `normalizeRedemptionCode(raw: string): string`
- `packages/functions/src/connect/giftCards.ts:81-85` — `normalizeCode` delegates
- `packages/shared/src/types/giftCard.ts:13-15`, `:76` — the stale
  "keyed by Stripe Checkout Session id" comments
- `packages/shared/src/index.ts` — export the new module

**Change.** One trim-and-uppercase, used by both instruments. Correct the two
comments to say the key is caller-minted (`generateSecureToken(16)` at
`payments.ts:535`, `payments.ts:750`, `dropIn.ts:548`) **before** any Stripe
session exists, and say why that ordering is forced.

**Shipped wider than the file list, deliberately.** B4 named two stale comments;
the code holds **six** live re-typings of the rule itself outside
`normalizeCode` — `payments.ts` x4 (two `paymentRef` builders, two
`metadata.giftCardCode` stamps), `dropIn.ts` x1 (`metadata.giftCardCode`) and
`shared/types/finance.ts` x1 (`buildGiftCardReclassTxns`'s `sourceRef`). Those
six ARE the fork this item exists to foreclose: the reclass `sourceRef` and the
callables' `paymentRef` must agree character for character. All six now call the
shared helper. Note also that the FUNCTIONS-side header (`giftCards.ts:22-23`)
was ALREADY correct ("keyed by a fresh id the caller mints") -- only the shared
type file was stale, which is exactly how the two drifted unnoticed.

**Failure mode prevented.** Two instruments forking on what "the same code"
means; and the next reader keying a promo reservation off a session id that does
not exist yet.

**Verify.** `pnpm typecheck`. Redeem a gift card typed as `gc-xxxx-xxxx` with
surrounding whitespace → resolves.

---

### P3-B · The `PromoCode` type, helpers, paths, plan caps

**Files + symbols**
- new `packages/shared/src/types/promoCode.ts` (§1.2)
- `packages/shared/src/paths.ts:195-200` — `PROMO_CODES_SUBCOLLECTION`,
  `PROMO_REDEMPTIONS_SUBCOLLECTION`
- `packages/shared/src/index.ts:48-49` — export beside `benefit` / `giftCard`

**Change.** Types, pure helpers and `PROMO_CODE_LIMITS`. No behaviour. Record in
the file header that no `tenantData.ts` registration is needed and why (§1.1), so
nobody adds one. Specifically owns:

- `promoIdentityKey` and `promoReservationKey` (§1.1, §5.1) — the two derivations
  everything else depends on;
- `promoUsesLeft`, returning **both** cap halves (§1.2), and
  `PROMO_MAX_LIVE_RESERVATIONS`;
- `PromoCode.max_uses` as a **required** field and `restrict_to_contact_id`;
- **the `audience` axis** (§10 Q12): the `PromoAudience` type, the optional
  `audience` field defaulting to `'all'` when absent, and
  `promoAudienceMatches(p, { joined })`. "New" is `!joined`, i.e. NOT
  `acquisition_stage === 'joined'` — the same fact `ContactPaymentSnapshot.joined`
  and the `members` access rule already run on. Q12's phrasing ("in a pre-member
  stage") read literally would exclude every guest and every off-funnel contact,
  who carry **no** stage at all — which is the population the axis exists to admit;
- **no** `committed` map and **no** `PromoCommitted` type (§5.2).

> **CORRECTION (post-implementation).** The `!joined` reading is right and was
> re-verified; what shipped broken was not the predicate but **what each rail fed
> it**. `promoCallerFromContact(null, email)` answers `joined: false` for anyone
> without a contact document, and on the drop-in rail `contactDoc` is null
> whenever the (email + exact firstname + exact lastname) match misses — so a
> joined member booking as "A. Smith" instead of "Ann Smith" took a
> `new_contacts` code, which is the whole failure Q12 was answered to prevent.
> The appointment rail had closed the same hole with an inline `resolveSingleContact`
> lookup, i.e. one rail carried a second definition of "new customer".
>
> Both now call **`resolvePromoCaller`** (`connect/promoCodes.ts`): the lookup
> runs only when a code was typed; `joined` is true if **any active contact**
> under that email has joined (a household mailbox must not launder a member into
> a newcomer), while `contactId` keeps the never-guess rule because it feeds
> `restrict_to_contact_id`. **The drop-in rail passes its own pre-mint query
> results in** — it creates a provisional contact before the promo loads, so a
> query issued at the promo site sees that document too, reads as ambiguous and
> fails open.
>
> **CORRECTION 2 (the third break, and the one that says the seam was wrong).**
> The version above also said the lookup runs "only when the rail holds no
> contact document", and `resolvePromoCaller` implemented exactly that — it
> returned early on `params.contact`, discarding the email evidence. That is the
> **household case**, i.e. the case the fan-out was added for: the drop-in rail's
> (email + exact first + exact last) match hits the not-yet-joined member of a
> shared mailbox, the rail holds a document, and the member's own household takes
> the `new_contacts` code. Three breaks, three layers — the predicate, then what
> the rails fed it, then what the resolver did with what it was fed.
>
> **THE INVARIANT, stated once so the next fix is not a fourth instance:**
> *"joined" is a property of the EMAIL ADDRESS, never of one contact document — a
> `new_contacts` code is refused whenever any active contact of the team under the
> caller's email has joined, whichever document the rail happens to be buying as.*
>
> Made structural rather than patched: `promoCallerFrom` is the only constructor
> of a gate-bearing `PromoCaller` and takes **both** halves of the evidence (the
> held document AND the email's contacts) as **required** properties — a call site
> missing the email half does not compile. `resolvePromoCaller` is the only
> producer of that evidence and never short-circuits on a held document; the one
> skip left cannot change the answer (`joined` is a union, so an already-joined
> held document settles it). `promoCallerFromContact` — the single-document
> constructor that made all three breaks expressible — is **deleted**, and
> `promoCallerNotAsked` is the one place a `joined: false` may be built with no
> evidence, named so it cannot be mistaken for an answer. The cost is one extra
> query per promo-carrying checkout by a not-yet-joined caller.
>
> Fixtures: `connect/promoLifecycle.test.ts` → "the audience axis: 'joined' is a
> property of the EMAIL, not of a document" — anonymous guest, off-funnel contact,
> trial contact, signed-in member, guest form with a name mismatch, guest form
> with an exact-name match to a joined contact, the household mailbox (buying as
> the non-member AND as a guest), archived/deleted contacts, the drop-in mint
> ordering, and `promoCallerNotAsked`.

**Verify.** `pnpm typecheck` + `pnpm build`. New unit file
`packages/functions/src/connect/promoCode.test.ts` covering `promoWindowOpen`
(both ends absent / open / closed / boundary), `promoUsesLeft` (uncapped, capped,
capped-with-live-reservations, expired-reservations-ignored, per-identity
capped, **the caller's own live reservation does not count against them**),
`promoAppliesTo` (each kind, each id allow-list, `isTrial`),
`promoIdentityKey` (same email in different cases and with whitespace → one key;
no email → the contact key) and `promoReservationKey` (stable across two calls;
different per target).

**CORRECTED: `restrict_to_contact_id` is not `promoAppliesTo`'s to check** — that
helper takes a `PromoTargetScope` and never sees the caller. The caller-identity
gates therefore get their own single expression, added in P3-B alongside the
audience axis they share a decision with:

```ts
export type PromoCallerRefusal = 'restricted_to_other_contact' | 'audience_mismatch'
export function promoAllowsCaller(
  p: Pick<PromoCode, 'restrict_to_contact_id' | 'audience'>,
  caller: { contactId?: string | null; joined: boolean }
): { ok: true } | { ok: false; reason: PromoCallerRefusal }
```

The ORDER inside it is load-bearing and pinned by a fixture: the **binding is
checked first**, so a code that is both bound to somebody else and
new-contacts-only reports the secretive refusal, never the friendly one. A
binding maps out to a bare `invalid` (§7.3); an audience mismatch names itself.
An anonymous caller fails a binding — a bound code names one person.

---

### P3-B2 · The timer-ordering fix (B3) and the 24-hour hole (B3b)

**Files + symbols**
- `packages/functions/src/booking/dropIn.ts:549-557` — `reserveGiftCardDrawdown`
  called without `holdMinutes`
- `packages/functions/src/booking/dropIn.ts:840-842` — the variable Stripe expiry
- `packages/functions/src/connect/payments.ts:602-614` (product, plain) and
  `:823-835` (course, plain) — **no `expiresAtEpochSeconds` today**
- `packages/functions/src/connect/payments.ts:585`, `:806` — the gift-card
  branches that already pass it (the pattern to generalise)
- `packages/functions/src/connect/giftCards.ts:72` (`DEFAULT_HOLD_MINUTES`),
  `:206` (`holdMinutes?`)
- `packages/functions/src/connect/checkout.ts:92-98` — `SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES`
  and the docblock that states Stripe's 24-hour default; the new
  `resolveCheckoutHoldWindow` + `PROMO_RESERVATION_MARGIN_MINUTES` land here
- `packages/shared/src/types/giftCard.ts` — `GiftCardHold.expires_at`'s comment,
  which asserted the flat "+35 min" this item deletes (the same B4 shape)

**Change.** Two parts, one derivation.

1. Derive the checkout-expiry instant **once per call** and pass `holdMinutes`
   computed from it plus `PROMO_RESERVATION_MARGIN_MINUTES` (4), on every rail —
   so the 35-vs-31 constant pair becomes one expression.
2. **Pass `expiresAtEpochSeconds` on the plain product and course branches
   whenever any reservation rides the session.** Revision 1 asserted these were
   "fixed at 31 minutes"; they are not — they take Stripe's 24-hour default
   (B3b), which would have forced a 24-hour promo reservation under N9 and let
   one abandoned cart hold a scarce campaign hostage for a day. A checkout with
   no instrument keeps its 24 hours, unchanged.

The waitlist claim keeps its own window (§5.3) — do **not** clamp it.

**Shipped as ONE derivation, not two call-site patches.**
`resolveCheckoutHoldWindow({ nowMs, carriesReservation, fixedExpiresAtEpochSeconds,
alwaysBounded })` in `connect/checkout.ts` returns `{ expiresAtEpochSeconds,
holdMinutes, promoHoldMinutes }` from a single instant, beside
`SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES` and `STRIPE_MAX_CHECKOUT_EXPIRY_MINUTES`, and
owns both `PROMO_RESERVATION_MARGIN_MINUTES` (4, gift card) and
`PROMO_RESERVATION_BACKSTOP_MINUTES` (60, promo — added post-implementation, see
the N9 correction). Enumerating the call sites is the wrong shape for the same
reason §2.4 gives for the release paths: the numbers must be COPIES of one
instant, never separate computations. Every rail now calls it once and reads all
three fields.

Behaviour at `4b3177f` is preserved exactly where it was already right: the short
window is 31 and `31 + 4 === 35 === DEFAULT_HOLD_MINUTES`, so a plain drop-in,
a gift-card product and a gift-card course are byte-identical, and the plain
product/course branches thread `expiresAtEpochSeconds: undefined` (which
`createOneOffCheckoutSession` spreads only when truthy) rather than omitting the
key — the seam P3-H flips by OR-ing the promo into `carriesReservation`.
Only the waitlist claim changes, which is B3.

**Failure mode prevented.** B3 exactly (a 120-minute claim whose gift-card hold
dies at +35, letting another purchase spend the held value), and B3b (a 24-hour
promo reservation, or — worse — a 35-minute reservation guarding a 24-hour
session, which is B3 reproduced for promos in the very phase that generalises it
away).

**Verify.** Emulator, three cases:
- 120-minute claim window paid by gift card → the card's `holds[key].expires_at`
  is **after** the Stripe session's `expires_at`, and within MARGIN of it;
- plain drop-in → 31 + 4 = 35, unchanged from `4b3177f`;
- **product bought with a promo → the Stripe session's `expires_at` is ~31
  minutes out, not 24 hours**; the same product with no promo and no gift card →
  no `expires_at` on the session at all (byte-identical payload).

---

### ⚛ ATOMIC GROUP A — the resolver signature, the `product` arm, the fixture gate

Binding: `docs/fareharbor-analysis.md:486` — *"Promo's resolver signature +
`product` arm + the fixture regression gate in `paymentOptions.test.ts`"* is one
commit. Splitting it means either a signature nothing exercises or an arm with no
regression net.

---

#### P3-C · `bestModifier`, base-as-candidate (B1), and the third parameter

**Files + symbols**
- `packages/shared/src/utils/paymentOptions.ts:238-335` — `applyBenefitToPrice`,
  from which `priceAfterModifier` is extracted (`:301-318`, `:320-333`)
- `:116-135` — `PaymentOption`, gains `appliedPromo`
- `:147-151` — `PaymentOptionsResult`, gains `promo?: PromoOutcome`
- `:355-358` — the signature
- `packages/shared/src/utils/money.ts:18`, `:34` — `MIN_CHARGE_MAJOR`, `round2Major`

**Change.** Extract `priceAfterModifier` (the ONE clamp + round site), add
`bestModifier` with base as the incumbent and the **asymmetric** replacement rule
of §3.2 (benefit applies at `<= base`; promo only strictly lower), add
`PromoModifier` / `PaymentContext` / `PromoOutcome` and
`appliedPromo.supersededBenefit`, and thread `context` through the four
promo-accepting arms. `class_booking` and the `asTrial` branch report
`not_applicable`.

**Failure mode prevented.** B1 (a `fixed_price` benefit above base charging the
member more than the list price) — and, structurally, the same class of bug for
promos, because both go through one comparator. The asymmetry additionally
prevents two regressions a naive "strictly lower everywhere" rule would have
shipped: an equal-value benefit silently losing its `appliedBenefit` stamp
(§0.3 B1), and every campaign blanking `subscription_type_id` on the bookings of
members who used the code (§2.2).

**Verify.** `pnpm typecheck` across all six packages with **no call-site edits**
(the third parameter is optional). `pnpm --filter @linyup/functions test` still
551/8/0 before the new fixtures land.

**Shipped, and where the shape differs from the sketch.** `bestModifier` is not
a standalone function taking two `Candidate`s: it is the tail of
**`applyModifiers`**, which replaces `applyBenefitToPrice` in place. Splitting
the comparator from the thing that resolves the benefit would have meant
resolving the benefit twice or passing a half-resolved candidate around, because
the benefit's own resolution is not purely a price — `included` and
`spend_credits` return COVERAGE and short-circuit before any comparison exists.
So the split that shipped is by *what the benefit turned out to be*, not by
*which modifier it is*:

- **`priceAfterModifier(base, effect, percent?, amount?) → number | null`** —
  the ONE clamp-and-round site, exactly as specified. Both modifiers call it.
- **`resolveBenefitCandidate(...) → {kind:'coverage'} | {kind:'price'} | null`**
  — the benefit's half. B1's fix lives on its last line (`price > base → null`),
  which is also the only place the `<=` half of the asymmetry is expressed.
- **`applyModifiers(...)`** — the comparator. The incumbent starts at `base` and
  is only ever lowered, which makes N5 true by construction rather than by a
  check that could be forgotten.

`resolvePaymentOptions` became a thin wrapper over a module-private
`resolveTarget(snapshot, target, promo)`. The wrapper owns the two outcomes no
arm can produce (`not_needed`, `not_applicable`) and the `PROMO_TARGETS` gate;
the arms own the three the comparator decides. That is what keeps "one decision,
two projections" (N4) local: `outcome` and `appliedPromo` are assigned in the
same three branches, never re-derived.

---

#### P3-D · The `product` arm, and `createProductCheckout` through the resolver (B2)

**Files + symbols**
- `packages/shared/src/utils/paymentOptions.ts:102` — `PaymentTarget` union;
  new `ProductTarget`; new `PRODUCT_EFFECTS` beside `:337-351`
- `packages/functions/src/connect/payments.ts:505-506` —
  `resolveProductPrice` → `requireChargeableAmountFromMajor`
- `packages/shared/src/types/product.ts:60-70` — `resolveProductPrice` (unchanged)
- `apps/web/src/lib/pricingSurface.ts:138` — the already-declared `'product'` source

**Change.** `createProductCheckout` keeps `requireChargeableAmountFromMajor` as
the authored-price pre-flight (return discarded, `dropIn.ts:229`'s pattern),
resolves through the new arm, then validates `payOption.amount` on the way to
Stripe. The gift-card block at `:534-543` is untouched — it already reads the
resolved total (§2.6).

**Failure mode prevented.** A promo on merchandise applied outside the resolver
— the exact Stage-A violation the governing rule forbids.

**Verify.** Emulator: buy a product with no promo → identical Stripe amount and
identical metadata to before (byte-compare the session payload). Buy with a
variant override → the variant price.

**CORRECTED: the third verify item was unfalsifiable.** "`/offer/pricing` renders
a product row without a type cast" cannot be checked, because that page has no
product *row* — it renders products through `productPriceRange`
(`pricingSurface.ts:238`), which never touches a `PriceCell` or the resolver.
What P3-D actually does to `pricingSurface.ts:138` is make its already-declared
`'product'` source **type-consistent** with `PaymentOption['source']` instead of
a wider copy of it (`fromResult` needed no edit, and got none). Turning the dead
arm LIVE on that page is P3-F / P3-K work, and the corrected item is: *the
`'product'` member of `PriceCell`'s source union and of `PaymentOption`'s source
union are now the same set.*

**Shipped: which snapshot the callable passes, and why it is not lazy.**
`createProductCheckout` resolves with **`GUEST_SNAPSHOT`**, not a loaded one. The
product arm is snapshot-INVARIANT by construction — it never covers, never
denies, and `Product` carries no benefit — so loading this buyer's subscription
facts would be Firestore reads that cannot change the answer, on a login-first
callable that deliberately reads no contact document today. The invariance is
pinned twice in P3-E (a row per snapshot shape, and the N6 loop), so if `Product`
ever gains a benefit the fixture named *"the arm IGNORES the snapshot"* fails
before anybody ships a benefit that silently never applies. This stays correct
through P3-G: the promo comparator reads no snapshot either, and the audience
gate lives in the loader, which has `session.contactId`.

Also shipped: the callable now keeps **two** money checks rather than one — the
authored-price pre-flight on `resolveProductPrice`'s output (return discarded,
`dropIn.ts:229`'s pattern) and the seam assertion on `payOption.amount`. And one
variable was renamed: `priceMajor` is now the RESOLVED total (what the gift-card
reservation, the full-cover branch and Stripe all read), with `listMajor` for the
authored list price. Equal today; the point of the arm is that they stop being
equal.

---

#### P3-E · The fixture regression gate

**Files + symbols**
- `packages/functions/src/booking/paymentOptions.test.ts` — `runRows` (`:34-40`),
  the **seven** existing `describe` blocks (`:51`, `:132`, `:203`, `:317`,
  `:398`, `:583`, `:657`). *(Corrected: the prose said "six" while listing seven
  line numbers; the file has seven.)*

**Change.** Three new `describe` blocks in the established style (a
`(over) => PaymentTarget` factory, one whole-object `deepEqual` per row):

- **`product` arm** — guest, member, priced, variant-priced, benefit ignored
  (products carry none), and the never-covers / never-denies invariant (N6).
- **`promo (Phase 3)`** — a matrix, not anecdotes:
  - one row per arm × `applied` / `superseded` / `not_needed` / `not_applicable`;
  - `percent_off` normal, `percent_off` clamping to `MIN_CHARGE_MAJOR`,
    `percent_off` malformed (`0`, missing, negative) → base, not applied;
  - **the rounding case, pinned rather than described**: 15% off 33.30 →
    **28.30** (`(33.3 * 85) / 100 === 28.304999999999996`), the example revision 1
    got wrong in the one section whose job is to pin rounding policy;
  - `fixed_price` below base, **above base → `superseded`** (the promo half of
    B1), exactly equal → `superseded`, non-finite → `not_applicable`;
  - promo vs benefit: promo lower → `applied`, no `appliedBenefit`, **and
    `appliedPromo.supersededBenefit` carrying the beaten type**; benefit lower →
    `superseded` + `appliedBenefit` present; **equal → benefit wins**;
  - covered / `spend_credits` → `not_needed`, price unchanged;
  - `asTrial: true` → `not_applicable` (§3.4);
  - `class_booking` + a promo → `not_applicable`, and the result is otherwise
    byte-identical to the no-promo case.
- Plus the B1 rows in the existing benefit block's style: a `fixed_price` benefit
  **above** base returns base with **no** `appliedBenefit`; a `fixed_price`
  benefit **exactly at** base returns base **with** `appliedBenefit` (the
  equal-value decision, §0.3 B1) — the row that stops a later "tidy-up" from
  silently blanking booking provenance.

**Failure mode prevented.** Any new key added *unconditionally* to a `pay` option
breaks ~35 rows and any new key on `PaymentOptionsResult` breaks all 60 — the
omitted-when-absent convention (`paymentOptions.ts:245-248`) is what keeps them
green, and this block is what proves it.

**Verify.** `pnpm --filter @linyup/functions test` — at least 551 passing, 8
pending, 0 failing, with `git diff` on the test file showing **additions only**.

**Shipped: a SECOND harness, not a widened one.** `runRows` (`:34-40`) is
byte-identical to `4b3177f`; the promo rows run through `runContextRows`, which
differs only in passing `row.context`. Widening `runRows` would have been three
characters and would also have been the one edit that makes "additions only"
untrue for the file whose whole job is to prove nothing regressed. The B1 rows
got their own block (`B1: a modifier never raises a price`) rather than being
appended to the generalized-Benefit block, for the same reason: a reader looking
for what B1 changed should find it under that name.

Two rows beyond the list above, both earning their place:
- **`a promo that beats NO benefit carries no supersededBenefit key at all`** —
  the omitted-when-absent convention applied one level deeper than anywhere else
  in the file. Without it, `supersededBenefit: null` would pass every other
  fixture and quietly break `deepEqual` for downstream consumers.
- **`N4/N5` as a loop, not a row** — six bases × six modifiers, asserting
  `amount <= base`, `applied ⟺ appliedPromo`, and that the product arm never
  stamps `appliedBenefit`. A matrix of anecdotes cannot state a universal; this
  can.

---

### P3-F · `pricingSurface` and the display consumers learn `appliedPromo`

**Files + symbols**
- `apps/web/src/lib/pricingSurface.ts:121-140` (`PriceCell`), `:142-186`
  (`fromResult`, whose `CoverageVia` switch at `:157-174` is a compile gate),
  `:192`, `:216`, `:228`
- `apps/web/src/app/[locale]/(auth)/offer/pricing/page.tsx`,
  `apps/web/src/components/howto/pricing/PricingSimulator.tsx`

**Change.** `PriceCell.pay` gains `promoCode?: string`; `fromResult` reads
`appliedPromo` where it already reads `appliedBenefit` (`:180-185`), **and falls
back to `appliedPromo.supersededBenefit` for `baseAmount` / `viaTypeId`** so a
member badge is not lost the moment a code beats the benefit (§2.2). The pricing
page's persona simulator gains no promo input in v1 (a persona has no code) — the
field exists so a real quote flowing through the same helper renders correctly.

**Failure mode prevented.** `/offer/pricing`'s guarantee that it "can never
disagree with what a booking/checkout would actually charge"
(`pricingSurface.ts:1-4`) breaking quietly; and the member badge disappearing
from every row for the duration of a campaign.

**Verify.** `pnpm typecheck`; the pricing page renders unchanged with no promo in
play; a member row whose benefit is exactly the list price still shows the badge
(the equal-value case, §0.3 B1).

**Shipped, with one correction.** `supersededBenefit` carries
`{ subscriptionTypeId, effect }` and **no `baseAmount`** — so "falls back to
`appliedPromo.supersededBenefit` for `baseAmount` / `viaTypeId`" is only half
possible as written. It needs no more: `appliedPromo.baseAmount` IS the same list
price `appliedBenefit.baseAmount` would have carried (both are assigned `base` in
`applyModifiers`). So `fromResult` reads
`appliedBenefit?.baseAmount ?? appliedPromo?.baseAmount` for the struck-through
figure and
`appliedBenefit?.subscriptionTypeId ?? appliedPromo?.supersededBenefit?.subscriptionTypeId`
for the badge — which is the behaviour the item asked for, sourced correctly.
`PriceCell.pay` also gains `promoCode?: string` (omitted when absent). The page
itself needed no edit: a persona has no code, so `promoCode` is never set there
today, and the `CoverageVia` compile gate is untouched.

---

### ⚛ ATOMIC GROUP B — reserve, commit, release, and every call site

Splitting this group leaves reservations nobody commits (the discount is given
and the count never moves) or commits with nothing to commit.

---

#### P3-G · `connect/promoCodes.ts` — the lifecycle and the preview

**Files + symbols**
- new `packages/functions/src/connect/promoCodes.ts`
- export from `packages/functions/src/index.ts` beside the gift-card callables
- `packages/functions/src/connect/giftCards.ts:418-427` — **delete**
  `promoRedemptionId` and record why (§0.4(a), N17)
- reuses `checkoutRateLimit` (`checkout.ts:163-189`), `generateSecureToken`
  (`utils/crypto.ts:19-21`), `giftCardCurrency` (`giftCards.ts:116-118`)

**Change.** `loadPromoForTarget` (returns a `PromoModifier` **or** a reason —
never throws, §2.4 step 1), `reservePromoRedemption` (§5.1),
`commitPromoRedemption` (§5.2), `releasePromoReservation` (§5.3), and the public
`previewPromoCode` callable (§7.2) on the `'promo-check'` bucket. **No
`prunePromoCommitted`** — there is no `committed` map to prune (§5.2).

The preview builds its target and snapshot through the **same** helpers each
callable uses (N22) — `resolveDropInForContact` with `usageAt = session.start`,
`loadAppointmentBookingContext`, the course and product loads — and calls
`promoUsesLeft` rather than re-deriving either cap.

**Failure mode prevented.** The lost-update class on `max_uses`; a promo commit
placed where it cannot run (§0.4(a)); an enumeration surface sharing the buying
quota; a preview that quotes a price the checkout would refuse (the
usage-window divergence, §7.2).

**Verify.** Emulator:
- `max_uses: 1`; two concurrent `reservePromoRedemption` calls from **different
  identities** → one succeeds, one throws `promo_exhausted`, the doc holds
  exactly one reservation;
- **the same identity, same target, twice** → exactly ONE reservation, the later
  expiry, neither cap moved (N21) — the retry case revision 1 refused;
- commit twice with the same key → `usage_count` moves by exactly 1 (the second
  finds no reservation and writes nothing);
- release a key twice → no error, no change;
- `PROMO_MAX_LIVE_RESERVATIONS + 1` distinct identities → the last gets
  `promo_busy`, **not** `promo_exhausted`;
- a code with `restrict_to_contact_id` previewed by anyone else → bare `invalid`,
  never a distinguishable reason;
- for each rail, `previewPromoCode`'s `quotedAmount` equals what the checkout
  resolves for the same caller — including a "3 per week" member booking a class
  nine days out, whose preview must report `not_needed`, not a discount (N22).

---

#### P3-H · Wire `promoCode` into the four one-off checkouts and the webhook

**Files + symbols**
- `packages/functions/src/booking/dropIn.ts` — input (`:107-115`); **all FOUR
  resolution points**, not one (see below); the payOption seam (`:454-468`); the
  new promo reserve + `releaseReservedPromo` closure immediately above the
  gift-card block (`:547-557`); the full-cover branch (`:560-685`); the two
  transaction catches (`:637-640`, `:766-769`); metadata (`:790-800`); the
  idempotency key (`:801-802`); the Stripe `catch` (`:845-849`); **and the stale
  comment at `:535-537` (B7)**
- `packages/functions/src/booking/dropIn.ts:74-92` — **`resolveDropInForContact`
  gains `context?: PaymentContext`**
- `packages/functions/src/connect/payments.ts` — `createProductCheckout`
  (`:447-615`) and `createCourseCheckout` (`:624-836`), same points each, plus
  the plain-branch `expiresAtEpochSeconds` from P3-B2
- `packages/functions/src/appointments/checkout.ts:41-54` (input), `:96-122`
  (resolve/price), **`:174-186` (`runAppointmentSlotTransaction` — MOVED inside
  the guard)**, and `:214-239`
- `packages/functions/src/connect/webhook.ts` — the commit at each of the **four
  per-kind confirm points** (`handleProductCheckout` `:1150`,
  `handleCourseCheckout` `:1207`, `handleDropInCheckout` `:1393` after the
  confirm transaction, `handleAppointmentCheckout` `:1673` after
  `confirmed = true`), **never** before the dispatch at `:945-969`;
  `:1961-1987` (`handleCheckoutExpired`, release beside `:1964-1970`)

**Change — the resolver call sites, because this is the one that fails
silently.** Revision 1 listed `dropIn.ts:448` as "the resolver call". That is the
**brand-new-guest branch only**. The other three resolution points —
`:354` (waitlist claim), `:377` (signed-in contact), `:410` (matched existing
contact) — go through the wrapper `resolveDropInForContact` (`:74-92`), which
builds the snapshot and calls `resolvePaymentOptions` itself. An implementer
threading `context` only into `:448` breaks nothing loudly: `result.promo` is
simply absent, §2.4 step 5 sees no win, no reservation is taken, and the callable
charges the **undiscounted** price to a visitor who was quoted a discount — for
every signed-in member and every waitlist claimant, i.e. the surface §0.2 hook 3
says this phase exists to serve. So: widen the wrapper's signature, thread all
four, and rely on **N10b** (a supplied code with no `promo` outcome throws) to
make any future missed site loud.

**Change — everything else.**
- Metadata keys on every promo-carrying session — `promoCode`,
  `promoReservation`, `promoAmount` — mirroring the gift card's `giftCardCode` /
  `giftCardHold` / `giftCardDrawdown` trio. **Corrected post-implementation:
  there are SIX**, and the three extra are not decoration. `promoIdentity` keeps
  the per-person ledger writable when a provisional contact has been purged;
  `promoInstance` and `promoExpires` are the two halves of slot ownership (which
  attempt this session is, and when its claim was due to lapse) without which the
  commit cannot spend a slot exactly once — see the §5.2 correction. All six are
  stamped from the reservation **ticket**, so none can exist without a
  reservation behind it.
- The `quotedAmount` input and its `price_changed` refusal on all four callables
  (§2.4 step 3).
- The order of operations is §2.4's — reserve **after** the non-money gates,
  **before** the gift card — and steps 5–7 sit inside ONE guard whose release
  order is the reverse (N9/§5.3's checklist is the verify step).
- Instrument parts appended to `defaultIdempotencyKey` (§5.5), last, never
  reordered.
- The commit at the four confirm points, never before the dispatch, never on a
  refund branch (§5.2, N8b), taking its identity from the **reservation**.
- **The `subscription_type_id` fallback** on both booking writes —
  `appliedBenefit?.subscriptionTypeId ?? appliedPromo?.supersededBenefit?.subscriptionTypeId ?? null`
  (`appointments/checkout.ts:173` and the drop-in booking doc) — so a campaign
  never blanks which membership priced a booking (§2.2).
- **B7's stale comment** at `dropIn.ts:535-537` corrected in the same edit that
  adds `releaseReservedPromo` beside it.

**Failure mode prevented.** A discount quoted and not charged, silently, on three
of four drop-in paths; a reservation stranded until lazy expiry on any of eight
throw sites; a use consumed by a purchase the platform itself refunded; a Stripe
idempotency collision turning "change the code and resubmit" into two
unrelated-looking errors.

**Verify.** Emulator + Stripe CLI, per rail: apply a code, reach Stripe → session
amount is the discounted figure and the six metadata keys are present. Complete
→ `usage_count` +1, the reservation gone, `redemptions/{identityKey}` created.
Replay the same event → the event ledger short-circuits, no second increment.
Expire the session → the reservation released, `usage_count` unchanged. Then the
cases revision 1 could not have caught:

**Two more checklist items, added post-implementation for the two defects §5.2's
and §7's corrections describe.** Both FAIL loudly if the fix regresses:

- **N concurrent sessions, one use.** Product rail, `max_uses: 1`,
  `max_uses_per_contact: 1`: apply a code, click Pay, go Back, click Pay again
  (two live sessions, one reservation), then pay **both**. Expect: two orders,
  `usage_count` **1**, `PromoRedemption.count` **1**, and one `[promo] a paid
  checkout did NOT consume a use …` at ERROR. Repeat paying them in the opposite
  order — the numbers must be identical. Before the fix this is 2 and 2, silently.
- **The household mailbox.** One team, two contacts on `a@b.c`: "Mum Smith"
  (`acquisition_stage: 'joined'`) and "Kid Smith" (`trial_booked`). On the
  drop-in guest form, book as **Kid Smith / a@b.c** with a `new_contacts` code —
  an exact-name match, so the rail holds Kid's document. Expect
  `promo_audience_mismatch`. Before the fix the code applies.

**LANDED IN TWO PASSES — the second one is recorded here because the gap was
silent.** The drop-in and product rails were wired first; the COURSE rail, the
APPOINTMENT rail and the whole webhook half were not, and the tree did not say
so. What the P3-F/J/K/L pass found and finished:

| Gap | Consequence had it shipped |
|---|---|
| `payments.ts` imported `promoCheckoutMetadata` and **never called it** | A promo-carrying product session reached Stripe with NO promo metadata, so the webhook could neither commit nor release it: every discount given, no use ever counted, every reservation stranded to lazy expiry |
| `Timestamp` was used in `payments.ts` and never imported | `pnpm typecheck` was **red** at the start of this pass (`src/connect/payments.ts(655,18)`) |
| `createCourseCheckout` took no `promoCode` at all | The shop's Courses tab would mount a promo field that silently did nothing |
| `createAppointmentCheckout` took no `promoCode` at all | Same, on the appointment picker |
| The webhook had **no** commit at any of the four confirm points, and no release on expiry | `usage_count` could never move: every cap unenforced, and the admin page's "used" number permanently zero — i.e. the one report §8.1 shape 4 leaves as the studio's only signal would have been a lie |

All five are closed, following the drop-in/product pattern verbatim:
`commitPromoFromMetadata` at `handleProductCheckout`'s and
`handleCourseCheckout`'s TOP (neither refunds, and their early returns leave the
payment standing), after `handleDropInCheckout`'s confirm transaction and past
its two refund branches, after `handleAppointmentCheckout`'s
`confirmed = true` and past both of its refund branches; and
`releasePromoFromMetadata` beside the gift-card release in
`handleCheckoutExpired`, for any kind.

The appointment rail additionally got the move the item asks for:
`runAppointmentSlotTransaction` now sits **inside** the guard, so two visitors
racing one slot with the same code no longer strand the loser's reservation. Its
`CHECKOUT_EXPIRY_MINUTES` constant is gone — the expiry comes from
`resolveCheckoutHoldWindow({ alwaysBounded: true })`, which yields the identical
31 minutes while making the session and the reservation two copies of one
instant. And its catch now re-throws an `HttpsError` unchanged instead of
collapsing every failure to `internal`: with the slot transaction inside the
guard, "the slot was taken" is a real eligibility answer that must keep its own
code.

- **the signed-in member path** (`dropIn.ts:377`): quote 30 on a 40 class with a
  25% code, submit → Stripe charges **30**, not 40;
- **the waitlist claimant path** (`:354`): same;
- force each of §5.3's eight throw sites → the promo doc holds **zero**
  reservations afterwards;
- two visitors race one appointment slot with the same code → the loser's
  reservation is released, the winner's stands;
- class fills between checkout creation and payment → the oversell branch refunds
  in full and `usage_count` is **unchanged** (N8b);
- submit without a code, then with a code, **inside the same minute** → the
  second call returns a fresh Stripe session at the discounted amount (N24).

---

#### P3-I · The gift-card full-cover branches commit the promo

**Files + symbols**
- `packages/functions/src/booking/dropIn.ts:560-685`
- `packages/functions/src/connect/payments.ts:546-568`, `:761-789`

**Change.** In each branch, `commitPromoRedemption` beside the existing
`applyPaymentEffects` + `commitGiftCardDrawdown` pair, **after** the sale is
recorded. This branch creates no Stripe session, so no webhook will ever run for
it and this is the only place the redemption can be recorded
(`payments.ts:556-558`). Once-only comes from the branch running synchronously
inside a callable whose booking write already refuses a second attempt — there is
no `committed` marker to consult (§5.2).

**Failure mode prevented.** The most common promo+gift-card combination —
a code plus a card that covers the discounted remainder — giving the discount and
never counting it.

**Verify.** Emulator: a code and a card that fully covers the post-promo total →
`url: null, paidWithGiftCard: true`, booking confirmed, `usage_count` +1,
`redemptions/{identityKey}` written, card debited by the post-promo amount.
Repeat with an `admin_comp` card (which hits `giftCards.ts:466`'s early return)
and assert the promo still committed — the case §0.4(a) reason 2 names.

**Completed in the P3-F/J/K/L pass:** the drop-in and product full-cover branches
were already committing the promo; the COURSE one (`payments.ts`, the
`plan.residual === 0` arm) was not. It now does, beside its
`commitGiftCardDrawdown` and separately from it, for the reason §0.4(a) gives —
that function returns early for a comped card and only runs when a gift-card code
was supplied at all.

---

### P3-J · Manager callables, rules, indexes

**Files + symbols**
- `packages/functions/src/connect/promoCodes.ts` — `createPromoCode`,
  `updatePromoCode`, `setPromoCodeStatus`, `clearPromoRedemption`,
  **`releasePromoReservations`**
- `firestore.rules` — a block beside `gift_cards` (`:605-612`)
- `firestore.index.json`

**Change — callables.** `assertManager` (the `voidGiftCard` / `issueGiftCard`
bar); `requirePlan(teamId, 'studio')` **on create only**; format validation
(§1.1); `percent` 1–99 and `amount >= MIN_CHARGE_MAJOR` (§4, authored → throw);
**`max_uses` REQUIRED** — `null` accepted only when the caller sends it
explicitly, never by omission (§7.1); `restrict_to_contact_id` validated against
the team; `currency` stamped from `giftCardCurrency(team.default_currency)`;
`.create()` with `ALREADY_EXISTS` → `already-exists { reason: 'code_taken' }`,
**no retry loop**; the active-code cap from `getPromoCodeLimits`.
`updatePromoCode` may never write `usage_count` or `reservations`.

Two corrections, both deletes of lifecycle state, never counter adjustments
(N8): `clearPromoRedemption({ code, contactId | email })` deletes one
`redemptions/{identityKey}` doc; `releasePromoReservations({ code })` clears the
whole `reservations` map for one code (§5.3, §5.4).

**Change — rules.**
```
match /promo_codes/{code} {
  allow read:  if hasTeamRole(teamId, 'manager') || hasTeamRole(teamId, 'owner');
  allow write: if false;                    // callables only
  match /redemptions/{identityKey} {
    allow read:  if hasTeamRole(teamId, 'manager') || hasTeamRole(teamId, 'owner');
    allow write: if false;
  }
}
```

**Change — indexes: none.** Every access is by document id (`promoRef`,
`redemptionRef`), a single-field ordered list for the admin page
(`orderBy('created_at','desc')`, the same shape `useTeamGiftCards` uses,
`apps/web/src/hooks/useGiftCards.ts:17-32`), or — **the one the item's
enumeration missed, added in P3-J** — a single-field EQUALITY query,
`where('status','==','active')`, which the plan cap needs to count active codes.
Firestore indexes single fields automatically, so that one needs no composite
either; it is named here because "by document id or an ordered list" would have
read as forbidding it. Gift cards have **zero** entries in
`firestore.index.json` for exactly this reason. Record the absence deliberately,
so nobody adds a collection-group query later without also adding the override
(memory: `firestore-index-query-gotcha`).

**Verify.** Rules emulator: a manager reads the list; a coach cannot; every
client write is denied, including from a `schedule.manage` holder. Create a
duplicate code → `already-exists`. Create on a `coach` team → `permission-denied`
with `reason: 'plan_required'`.

---

### P3-K · Admin UI — `/offer/promo-codes`

**Files + symbols**
- new `apps/web/src/app/[locale]/(auth)/offer/promo-codes/page.tsx`
- new `apps/web/src/hooks/usePromoCodes.ts` (modelled on `useGiftCards.ts`)
- `apps/web/src/app/[locale]/(auth)/layout.tsx:166-213` — the nav item with
  `minPlan: 'studio'`
- reuses `usePlan()` (`apps/web/src/hooks/usePlan.ts:23`), `usePlanName()`
- **`apps/web/src/components/pricing/BenefitEditor.tsx:74-88`** — extract the
  numeric half of `benefitPercentInvalid` / `benefitAmountInvalid`, or write
  promo twins

**Change.** §7.1. `Link` / `useRouter` / `usePathname` from `@/i18n/navigation`.
Specifically owns: the required total cap with its explicit "no limit" escape;
the one-person binding; the `used / max` **and** `reserved` columns; the
**Release reservations** row action; and **promo-specific validators**.

**Why the validators cannot be reused as-is.** Both
`benefitPercentInvalid` (`:76`) and `benefitAmountInvalid` (`:84`) short-circuit
to VALID when `subscriptionTypeIds.length === 0` — and a promo form has no
subscription types, so borrowing them (revision 1's instruction) validates
nothing at all: `150` in the percent field would pass the client and return a
raw `invalid-argument` with no key to render.

**Verify.** A Studio team creates, lists, edits and disables a code. A Coach team
sees the item locked with the upsell modal. At the cap the Create button is
disabled with a reason. A code with live reservations cannot be deleted (there is
no delete). Typing `150` into percent, `0.20` into amount, and a `valid_until`
before `valid_from` each blocks submission with its own message. The list shows
a code with 3 committed and 5 reserved as **both** numbers, not "3 of 20".

**Shipped, plus three things the item did not name.**
- **The reserved figure comes from `promoUsesLeft(promo, now, '', 0)`** — the
  same expression the reserve transaction calls. The identity arguments are inert
  for a row (it asks about the code, not about a person), and reading `liveTotal`
  through the shared helper rather than counting the map inline is what stops the
  page and the gate from drifting.
- **The code field is disabled on EDIT.** The code IS the document id, so
  changing it would orphan every reservation and every `redemptions/*` row under
  it. `updatePromoCode` writes the definition only.
- **`releasePromoReservations` and `clearPromoRedemption` both have surfaces**
  (a row action behind an `AlertDialog`, and a small email dialog). Without them
  §5.4's "the remedy is a manager action" names two callables nothing can reach
  — the Phase-2 shape where a layer is specified and never built.

**One correction to §7.6's key list.** `PromoCodes` needs more than the 50 keys
listed there — the page also renders `save` / `cancel` / `saved` / `errorSave` /
`quota` / `enable` / `windowAlways` / `labelHint` / `noDelete` /
`usedUnlimited` / `percentOff` / `fixedPriceAt` / `scopeRequired` /
`contactInvalid` / `perContactInvalid` / `clearRedemptionEmailLabel` /
`clearedToast` / `looksLikeGiftCard`. All 71 shipped in lockstep across the four
locales; §7.6's list is a floor, not the full set.

---

### P3-L · `PromoCodeField` and the THREE public mounts

**Files + symbols**
- new `apps/web/src/components/booking/PromoCodeField.tsx` (+ the exported
  `promoCheckoutErrorMessage`)
- `BookingForm.tsx:1924-1931` (mount, gated `willCharge && !isPricedTrial`),
  `:716-729` (`dropInMemberPrice` — **widened to carry the promo and become the
  ONE call**), `:1936-2005` (breakdown, fed from that one result), `:825-857`
  (error catch)
- `ShopHome.tsx:1171-1178` (mount), `:512-514` (eligibility), `:521-532`
  (reset), `:470-484` (`courseOptions` / `courseMemberPrice` — the one call),
  `:660-690` (errors)
- ~~`waitlist/page.tsx:405-411`~~ — **no mount (§10 Q11).** `claimErrorKey`
  (`:126-154`) still gains the `price_changed` reason. It is now doubly
  unreachable there (the page sends no quote, and the claim rail takes no code),
  and kept for the same reason as before: a refusal with no mapped copy is this
  feature's most likely failure mode
- `AppointmentPicker.tsx:433-466` (new mount), `:139-159` (`toEffectivePrice` —
  the one call), `:1249` (the checkout call)

**Change.** §7.2. Three requirements, each of which revision 1 got wrong or left
implicit:

1. **The mount gate is `willCharge && !isPricedTrial`**, not bare `willCharge` —
   which is true on the priced-trial door, the one door §3.4 guarantees a promo
   must fail on.
2. **One resolver call per surface** (N23). The breakdown renders `appliedBenefit`
   XOR `appliedPromo` from a single `resolvePaymentOptions(..., { promo })`
   result. Three surfaces hold a second, independent benefit computation today
   and each must be folded in, or a member with a benefit *and* a code sees two
   discount rows and a total the Stripe page contradicts.
3. ~~**`quotedAmount` is sent with every checkout call**~~ — **CORRECTED
   post-implementation (§2.4): the quote rides the CODE.** Sent with every call it
   let an ordinary, promo-free purchase be refused over a divergence the two
   snapshots are documented as allowed to have, with no way out. Each mount now
   sends `promoCode` and `quotedAmount` **together or not at all**, and the server
   enforces the same scope through a required `promoAttempted` argument. And "a
   `price_changed` refusal re-renders the server's figure" is not a recovery: a
   re-render re-derives the same optimistic number. The mount stores the figure as
   `acceptedPrice`, renders **that** (dropping the discount rows the server just
   declined to honour), and sends it back on the next submit.

Every mount handles a promo refusal **at pay time**, not only at apply time (the
preview is advisory about availability, §7.2).

**Failure mode prevented.** A preview that says "valid" and a checkout that says
"not for this class"; a breakdown that promises 22 and charges 30; a promo field
rendered on the one door it can never work on; a client-applied promo whose
displayed total disagrees with the server's claim response on the waitlist page.

**Verify.** Each of the three surfaces: apply a valid code → the discount row and
the new total. Apply a code the member benefit beats → the `superseded` message
and the member price, **with exactly one discount row on screen**. Exhaust the
code in another tab, then pay → the pay-time refusal renders its own message.
Plus: the priced-trial door renders **no** promo field; a member holding a 20%
benefit who applies a 25% code sees 40 / −10 / 30 and is charged 30.

**Shipped, and two places the mount differs from the file list.**

1. **The appointment mount is on the GUEST screen, not the `memberPay` screen
   (`:433-466`).** `SlotBookingForm` holds the applied code in its own state, and
   that state survives the sign-in offer — so a code applied before signing in is
   already inside `onVerifiedAppointment`'s price resolution and the member's
   figure carries it. Mounting on `memberPay` instead would put the field
   *after* the amount it is supposed to change was computed, which is the two-
   computations defect this item exists to prevent. One mount, both screens
   honour it.
2. **`promoOutcomeMessage` lives in the widget and the SURFACE supplies the
   outcome.** The widget never re-derives "did it win?" — each mount passes its
   own single `resolvePaymentOptions(..., { promo })` result's `promo` field
   down as `outcome`, and the widget renders the sentence. That is what makes
   N23 structural here rather than a rule to remember: a widget that decided the
   verdict itself would be the second price computation.

Also shipped beyond the list: `claimErrorKey` (`waitlist/page.tsx:126-154`) maps
`price_changed` → a new `Waitlist.priceChanged`, even though that page sends no
`quotedAmount` and (per Q11) carries no promo field, so it cannot currently fire.
A refusal with no mapped copy is the failure mode this phase is most exposed to;
mapping it now costs four message keys and removes the trap from a rail a later
phase could start quoting on.

---

### P3-M · Stamp the code on the payment row

**Files + symbols**
- `packages/shared/src/types/payment.ts:46-58` — `PaymentLineItem.promoCode`
- `packages/shared/src/types/connect.ts:189` — widen `MemberPayment.kind` to
  **all seven** members the single writer actually stamps (B5): the four declared
  plus `'appointment'` (`webhook.ts:510`), `'gift_card'` (`:517`) and
  `'policy_fee'` (`:520`). Note on the line that the union is derived from
  `webhook.ts:472-520`
- `packages/functions/src/connect/webhook.ts:427-433` (`lineItemFromMetadata`),
  `:449` (`financeDescription`)
- `apps/web/src/components/payments/PaymentsTable.tsx`,
  `apps/web/src/lib/payments.ts`

**Change.** Carry `promoCode` from checkout metadata onto the line item, and show
it as a chip in the payments list. **No** `PaymentLineItemKind` member, **no**
finance change (§6).

**Verify.** A promo-discounted drop-in appears in `/payments` with the code
visible, and the same row appears in the contact's Payments tab and the Space
payments list.

---

### P3-N · i18n — all four locales, in lockstep

**Files**: `apps/web/messages/{en,de,fr,it}.json`; `en.json` first. Keys per
§7.6. Anchor each insertion on a key **unique to the target namespace** — several
namespaces share key names and a naive anchor lands the key in the wrong one.

**Verify.** A key-set diff across all four files is empty for `Promo`,
`PromoCodes` and `Nav`.

---

### P3-O · Documentation

- New `docs/promo-codes.md`: the Stage A / Stage B split, the model, the
  reserve/commit/release lifecycle with its read sets, the best-one-wins rule
  **and its deliberate asymmetry**, the identity the per-person cap binds to and
  what it does not promise (§1.1), the two-sided timer rule (N9), the
  "a use is consumed by a sale, never by an attempt" rule (N8b), and the
  "no journal row, ever" statement.
- `docs/fareharbor-analysis.md`: mark Phase 3 done; append **B1–B7** to §7.3's
  pre-existing-bug list with their resolutions; record Franco's answers to
  §10 Q9–Q15 once given.
- `docs/waitlist.md`: the claim page now takes a promo (subject to Q11); the
  gift-card hold window is derived from the claim window (B3); and a code applied
  on a claim holds its use for the whole claim window.
- `docs/payment-contact-studio.md`: one line that a one-off checkout may now
  carry `quotedAmount`, and what `price_changed` means.
- `CLAUDE.md`: one paragraph under Key patterns — promo is a Stage A modifier,
  gift card is a Stage B tender, `usage_count` has exactly one writer, a use is
  consumed by a completed sale rather than by an attempt, and a promo never
  writes a journal row. **Plus two one-line corrections Group A made stale:**
  the resolver is quoted as `resolvePaymentOptions(snapshot, target)` (line ~277)
  and now takes a third `context`; and its list of what it answers for
  ("class bookings, drop-ins, appointments AND courses") is missing **products**.
  Same two facts in `docs/appointments.md:158`.

---

### 9.1 Atomic groups

| Group | Contents | Why splitting breaks |
|---|---|---|
| **A** | P3-C + P3-D + P3-E | Bound at `docs/fareharbor-analysis.md:486`. A signature nothing exercises, or a new arm with no regression net; and B1's fix and the promo comparator are literally the same function |
| **B** | P3-G + P3-H + P3-I | The reserve without the commit gives the discount and never counts it; the commit without the reserve has nothing to commit; the full-cover branch without the others is the most common combination silently uncounted |

### 9.2 Ordered work list

| # | Item | Group | Blocks |
|---|---|---|---|
| 1 | **P3-A** shared code normaliser + stale comments (B4) | — | P3-B, P3-G |
| 2 | **P3-B** `PromoCode` type, helpers, paths, plan caps | — | everything below |
| 3 | **P3-B2** timer-ordering fix (B3) + the 24-hour hole (B3b) | — | P3-G, P3-H |
| 4 | **P3-C** `bestModifier` + base-as-candidate (B1) + the third parameter | **A** | P3-D, P3-F |
| 5 | **P3-D** `product` arm + `createProductCheckout` (B2) | **A** | P3-F, P3-H |
| 6 | **P3-E** fixture regression gate | **A** | — |
| 7 | **P3-F** `pricingSurface` / `PriceCell` | — | P3-K |
| 8 | **P3-G** `promoCodes.ts` lifecycle + preview; delete the rider | **B** | P3-H, P3-L |
| 9 | **P3-H** wire the four checkouts + the webhook | **B** | P3-L |
| 10 | **P3-I** full-cover branches commit the promo | **B** | — |
| 11 | **P3-J** manager callables + rules (no indexes) | — | P3-K |
| 12 | **P3-K** admin UI + nav | — | — |
| 13 | **P3-L** `PromoCodeField` + the three public mounts (NOT the claim page — Q11) | — | — |
| 14 | **P3-M** stamp the code on the payment row (B5) | — | — |
| 15 | **P3-N** i18n, all four locales | — | — |
| 16 | **P3-O** docs | — | — |

---

## 10. Open questions — these need Franco

> **RESOLVED 2026-08-14.** Franco answered the four load-bearing questions
> directly; the remaining eleven proceed on the recommendation recorded under
> each. The full decision list is authoritative for implementation:
>
> | Q | Decision |
> |---|---|
> | **Q12 audience** | **YES — build the audience axis.** `audience?: 'all' \| 'new_contacts'`, "new" = `Contact.acquisition_stage` in a pre-member stage. Decided now precisely because retrofitting it changes the meaning of codes already in customers' hands |
> | **Q8 memberships** | **Excluded entirely in v1.** Not the one-off half either — a Subscriptions tab that takes a code on some rows and not others is worse than a clean "not on memberships" |
> | **Q9 refuse vs over-issue** | **Refuse — never exceed the cap.** A live reservation consumes a use, as designed. Ship the full bounding: deterministic reservation key, `PROMO_MAX_LIVE_RESERVATIONS` + `promo_busy`, short windows, reserved-vs-used in the admin list, and the manager release lever |
> | **Q4 effects** | **`percent_off` + `fixed_price` only.** No `amount_off` in v1 |
> | Q1 secrecy | Keep the `invalid` / `not_applicable` distinction — better UX, bounded harm |
> | Q2 refund restores use | No in v1. One writer of `usage_count` |
> | Q3 plan tier | Follow the recorded decision (`docs/fareharbor-analysis.md:271`): Studio flat — free/coach 0, studio 20, organization 100 |
> | Q5 priced trial | No — a promo does not stack on a paid trial |
> | Q6 finance CSV | No `promo_code` column in v1; the payments-row stamp (P3-M) is the record |
> | Q7 auto-apply | Neither. Every code is typed in v1 — no `?promo=` prefill, no auto-apply |
> | **Q11 claim page** | **No promo field on the waitlist claim page in v1.** This follows from Q9: with a strict cap, the claim rail is the one that would lock a use for the whole claim window (~124 min default, up to 24 h if configured) and whose deadline cannot be shortened without re-breaking Phase 2's one-deadline invariant. Strict-cap plus longest-hold is the worst pairing in the design |
> | Q10 payment window | Moot for products/courses given Q11 and Q8, but where it still applies: ship the short window, as the gift-card branches already do |
> | Q13 once-per-person | (a) Ship as is, keyed on hashed normalised email, with admin copy saying plainly "counted per email address" |
> | Q14 100% off | Not in v1. Recorded as a decision, not left to arrive as a support ticket |
> | Q15 exhaustion notice | None in v1. The admin page is the signal, and §7.4 makes it truthful |

These are not tidied away. Each is a decision this design pass could not make
alone, with my recommendation and the cost of the alternative.

**Q1 — Is a promo code a secret?** `previewPromoCode` currently distinguishes
`invalid` (unknown / disabled / expired / exhausted) from `not_applicable`
(a live code, wrong item). The second answer is a much better experience — "this
code is for courses" instead of "we could not find that code" — but it confirms
that a guessed string **is** a real code. Promo codes are short and
human-readable (`SUMMER26`), so the guess space is small and the 30/hour/IP limit
does not make harvesting impossible, only slow. **My recommendation: keep the
distinction** — the harm from a harvested flyer code is bounded (it is a discount
the studio advertised) and the UX gain is large. If Franco judges an
unadvertised code (a newsletter-only or influencer code) to be genuinely
confidential, collapse to a single opaque `invalid` — a one-line change in the
preview, plus two fewer i18n keys.

**Q2 — Should a HUMAN-initiated refund or cancellation restore the redemption?**
Note the narrowing: the *platform*-initiated auto-refunds (class filled after
checkout, duplicate charge, appointment slot retaken, session missing) are
already resolved — nothing is committed on those branches at all, because the
commit sits at each handler's confirm point (§5.2, N8b). What is left is the
studio cancelling a booking, or a manual refund. §5.4 says no in v1, to keep
exactly one writer of `usage_count`. The cost: a 50-use campaign with three
refunds becomes 47, and a customer whose booking the *studio* cancelled stays
barred if `max_uses_per_contact` is 1 (mitigated by `clearPromoRedemption`). The
alternative — decrement on refund — is a second counter writer with an ordering
question against a late webhook commit and a reversal marker of its own; roughly
the size of P3-G again, and the "counter adjusted four times" shape. **My
recommendation: ship without it and see whether any studio asks.**

**Q3 — `PROMO_CODE_LIMITS`: the right numbers, and should Coach get any?**
§1.4 proposes free/coach 0, studio 20, organization 100. The `PRODUCT_LIMITS`
precedent grades across all four plans rather than zeroing the bottom two, and a
solo coach's "first 10 clients get 20% off" launch is a real, sympathetic use. A
capped Coach allowance (1–2 live codes) would preserve the Studio pull while not
making that launch impossible — but it also puts promos on Free, since Free
inherits Coach. The recorded decision
(`docs/fareharbor-analysis.md:271`) says Studio flat.

**Q4 — `fixed_price` vs `amount_off`.** V1 reuses the existing `BenefitEffect`
vocabulary verbatim, so a promo can say "this costs CHF 10 with this code"
(`fixed_price`) but not "CHF 10 off" (`amount_off`). The second is what studios
usually ask for. Adding it later is a `BenefitEffect` widening whose blast radius
is `normalizeBenefit`, `resolveBenefitCandidate`'s exhaustive switch over the
effect and the `priceAfterModifier` clamp site it calls (both carved out of the
former `applyBenefitToPrice` by P3-C), the three (soon five) effect allow-sets,
`BenefitEditor` and every fixture — real but bounded work. **Is `percent_off` + `fixed_price` enough for the campaigns Franco has in
mind at launch?**

**Q5 — Should a promo apply to a priced trial?** §3.4 says no: a paid trial is
already an acquisition price, enforced once per person, and stacking a promo on
it double-discounts the cheapest thing in the product. Reversing this is a
one-line predicate change plus fixtures, precisely because the predicate lives in
one place. **Confirm the product intent.**

**Q6 — Should `promo_code` be appended to the finance CSV export?** Not in v1
(§6). The schema is a documented append-only public contract
(`docs/finance-reports.md:78-100`), so adding a trailing column later is safe —
but it would mean putting the code on `FinanceTransaction`, i.e. a schema change
to an otherwise immutable log. **Does any studio need forgone revenue in the
export, or is the payments-row stamp (P3-M) enough?**

**Q7 — Auto-applied and single-click codes.** Out of scope in v1: every code must
be typed. A campaign link that pre-fills the field (`?promo=AUTUMN25`) is a
small addition (one query-param read per surface); a code that applies with no
visitor action at all is a different feature — it is really "a scheduled sale
price" and belongs on the entity, not on a code. **Which, if either, does the
launch need?**

**Q8 — One-off membership purchases.** `createMembershipPayment`
(`payments.ts:182`) is an ordinary one-off charge and could take a promo through
the same rail as products, while `createMembershipCheckout`'s recurring branch
(`:409-423`) could not without Stripe coupons. Including only the one-off half
means the shop's Subscriptions tab accepts a code on some rows and not others,
which is worse than a clean "not on memberships". **My recommendation: exclude
memberships entirely in v1** — but this is the single most likely thing a studio
will ask for ("first month 50% off"), so it deserves an explicit answer rather
than a silent omission.

---

The eight above were in revision 1. The seven below came out of the three
adversarial reviews — each is a decision this pass could not make alone, and each
costs a sentence now against a rebuild later.

**Q9 — When a capped code is contested, which way should it fail: refuse, or
over-issue?** This is the question that governs the phase, and revision 1 answered
it silently. Today a **live, uncompleted reservation consumes a use** of
`max_uses`, so a contested code refuses genuine customers, and a burst of
abandoned carts can hold a campaign closed for the reservation window. The
opposite choice — count committed only — means a contested code over-issues by a
bounded few. The asymmetry worth weighing: **a promo slot is not stored value.**
Giving one extra 25%-off booking costs the studio one discount; refusing a paying
customer costs a sale. Revision 2 has bounded the refusal side hard (deterministic
key so N abandonments need N distinct emails; a `PROMO_MAX_LIVE_RESERVATIONS`
ceiling with its own "try again shortly" message; short windows; reserved shown
in the admin list; a manager release lever), which is why it is defensible as
shipped — but the direction itself is Franco's, and flipping it is one line in
`promoUsesLeft`.

**Q10 — Does attaching a code shorten the buyer's payment window?** Today a plain
product or course checkout gives the buyer **24 hours** to pay (Stripe's default;
only the gift-card branches shorten it). P3-B2 cuts that to ~31 minutes whenever a
promo rides the session, because the alternative is a promo reservation that lives
24 hours and one abandoned cart holding a scarce code hostage for a day. That is a
customer-facing product decision, not an implementation detail: a buyer who wants
to think overnight loses that option the moment they type a code. **My
recommendation: ship the short window** — the gift-card branches already made
exactly this trade for exactly this reason — but it needs a yes.

**Q11 — Is the promo field wanted on the waitlist claim page at all?** §0.2 hook 3
treats it as settled because `claim.ts:211-215` mentions a promo in a comment. But
the claim rail is the one with the longest, studio-configurable window, and its
session deadline cannot be shortened without re-breaking Phase 2's one-deadline
invariant (§5.3). So on this rail alone, applying a code locks that use for the
whole claim window — ~124 minutes at the default, up to 24 hours if a studio
configures it that way. **Worth an explicit yes**, or a decision to leave the
claim page code-free in v1.

**Q12 — Should a code be restrictable by AUDIENCE ("new customers only")?**
There is no audience axis in the model, and combined with best-one-wins this has a
sharp consequence: a studio with 120 members prints "20% off, code AUTUMN20, 50
uses", its members already hold a 10% `memberBenefit`, every member who sees the
flyer gets 20% instead, the 50 uses are gone in a week, **zero new contacts are
acquired**, and `/offer/promo-codes` reports a fully-used campaign — the report
§7.4 calls "the report a studio actually wants" cannot say the campaign failed.
Cost if yes: one optional field (`audience?: 'all' | 'new_contacts'`) and one
predicate in the loader that already reads the caller's contact. The cheapest
defensible definition of "new" here is `Contact.acquisition_stage` in a pre-member
stage (the funnel field the drop-in rail already stamps at `dropIn.ts:433`), not a
prior-bookings query. **My recommendation: decide it now, before any code is
live** — retrofitting an audience axis afterwards changes the meaning of codes
already in customers' hands.

**Q13 — Is "once per person" a promise or a nudge on the guest rails?** Revision 2
keys the cap on a hash of the normalised email (§1.1), which defeats the
name-spelling evasion revision 1 was open to. A second mailbox still defeats it.
Options: (a) ship as is, with the admin copy saying "counted per email address"
(current plan); (b) offer the per-person cap **only** where a contact session
exists — the shop, the Space, the claim page — and hide it on the guest drop-in
and appointment forms; (c) require sign-in for any code carrying a per-person cap.
(b) and (c) both cost conversions on the acquisition surface. **My recommendation:
(a), with honest copy.**

**Q14 — Is "first class free" a campaign the launch needs?** `percent: 100` is
structurally inexpressible (§4, N3) and the workaround — the free-trial door — is
a different feature with its own once-per-person gate, no code, no window and no
campaign report. So "first class free, 100 seats, January only" cannot be run at
all. The cost of allowing it is a payment-less confirm path for promos, which the
gift-card full-cover branch (`dropIn.ts:560-685`) proves is buildable but which
would put a second no-Stripe path into every rail. **My recommendation: leave it
out of v1 and record the answer**, so it arrives as a decision rather than as a
support ticket.

**Q15 — Who is told when a campaign exhausts?** §8.1 shape 4 forecloses **all**
promo notifications, which is right about email plumbing and leaves the studio's
only signal behind a page they must remember to open. Revision 2 at least makes
that page truthful (reserved shown separately, §7.4). The minimal alternative is
one email on first `promo_exhausted` per code — a single send, no template
family, no preference surface. **My recommendation: none in v1**, but this is the
one absence most likely to read as a bug from the studio's side.

---

## 11. Explicitly out of scope

| Item | Reason |
|---|---|
| Promo on recurring memberships | A modifier on a Stripe subscription is a Stripe **coupon**, not an amount we compute. Different mechanism, different lifecycle, no shared code with Stage A |
| Promo on gift-card purchases | A discount on stored value mints value the studio was not paid for. `createGiftCardCheckout` already refuses a gift card for the same reason (`giftCards.ts:696-699`) |
| Promo on the free `bookSession` path | Nothing to discount; the `class_booking` arm never prices |
| A `Product.benefit` field | The `product` arm accepts `benefit` so a later phase adds **data**, not a signature. No products carry one today |
| `amount_off` as a third effect | §10 Q4 |
| Restoring a redemption on a human-initiated refund | §5.4, §10 Q2. The platform-initiated ones need no restore — nothing is committed on those branches (N8b) |
| ~~Audience scoping (`new_contacts` only)~~ | **NO LONGER OUT OF SCOPE.** §10 Q12 answered YES. Owners: **P3-B** (the `audience` field, its `'all'` default, `promoAudienceMatches`), **P3-G** (the loader predicate + the `promo_audience_mismatch` refusal), **P3-K** (the create/edit control), **P3-L** (the visitor copy), **P3-N** (`Promo.audienceMismatch`, `PromoCodes.audience*`), **P3-E** (fixtures) |
| A 100%-off code | §4, §10 Q14 |
| A `committed` map on the promo doc | §5.2 — replay is the `connect_webhook_events` ledger's job; a per-reservation marker was unbounded (N20) |
| A promo reservation sweep job | Expiry is lazy, exactly as gift-card holds are (`giftCards.ts:22-29`). N13 |
| Any notification about a promo | No email, no SMS, no push, on any promo event. §8.1 shape 4 |
| Campaign analytics — attribution, cohort lift, per-channel ROI | `docs/fareharbor-analysis.md` §7's third non-goal. The admin list's `used / max` is the report |
| A new `FinanceCategory`, a reclass pair, or a CSV column | §6 |
| Auto-apply / pre-filled campaign links | §10 Q7 |
| Stacking two promo codes | The field is single-valued and the settled decision is best-one-wins |
| Reusing `commitGiftCardDrawdown` as the commit seam | §0.4(a). The rider is deleted, not implemented |
| Reusing `planGiftCardRedemption` for the promo floor | It is the CHARGE floor; a promo uses the PRICE floor. §4 |
| Fixing B6 (`mapCategory` has no `'appointment'`) | Named, not fixed — no promo path depends on it |

---

## 12. Whole-phase verification checklist

Every line is a gate.

- [ ] `pnpm typecheck` (6/6) · `pnpm lint` (0 errors) · `pnpm build`.
- [ ] `pnpm --filter @linyup/functions test` — **at least 551 passing / 8 pending
      / 0 failing**, and `git diff` on `paymentOptions.test.ts` shows additions
      only (N19).
- [ ] **Stage A / Stage B (N1):** `connect/checkout.ts` imports nothing from
      `promoCodes.ts` and does no percent/code arithmetic — the bare
      `grep "promo"` this line used to specify now matches
      `PROMO_RESERVATION_MARGIN_MINUTES`, which P3-B2 deliberately put there.
      And no callable computes a discounted amount itself — every one reads
      `payOption.amount`.
- [ ] **One counter writer (N8):**
      `grep -rn "usage_count" packages/functions/src apps/web/src` shows exactly
      one write site, and
      `grep -rn "usage_count: FieldValue.increment\|count: FieldValue.increment" packages/functions/src`
      is empty.
- [ ] **The rider is gone (N17):** `grep -rn "promoRedemptionId" packages/` is
      empty, and the comment at its former site explains why.
- [ ] **Promo + gift card, the headline case:** CHF 40 drop-in, 25% code, CHF 20
      card → Stripe charges 10.00; the breakdown shows 40 / −10 / 30 / −20 / 10;
      `usage_count` +1; card balance −20.
- [ ] **Full cover with a promo:** same code, CHF 35 card → `url: null`,
      `paidWithGiftCard: true`, booking confirmed, `usage_count` +1,
      `redemptions/{identityKey}` written. Repeat with an `admin_comp` card and
      assert the promo still committed.
- [ ] **Global cap under concurrency (§5.6):** `max_uses: 1`, two concurrent
      checkouts → one succeeds, one throws `promo_exhausted`, `usage_count`
      settles at 1, exactly one reservation ever existed.
- [ ] **Per-contact cap:** default 1 → the same contact's second checkout throws
      `promo_already_used`, and a *different* contact still succeeds.
- [ ] **Per-person cap binds to the EMAIL, not the contact doc (§1.1):** book a
      guest drop-in as `Ann Smith / ann@x.com`, then as `A. Smith / ann@x.com`
      (which mints a **new** contact, `dropIn.ts:429-447`) → the second is
      refused `promo_already_used`.
- [ ] **A retry is a refresh, not a second use (N21):** apply a code, reach
      Stripe, go back, submit again → the promo doc holds **one** reservation,
      no cap moved, and the second call succeeds. Repeat on a waitlist claim.
- [ ] **Idempotency:** replay `checkout.session.completed` → the event ledger
      short-circuits, `usage_count` unchanged, no write to the promo doc.
- [ ] **Stripe idempotency key (N24):** submit without a code, then with a code,
      inside the same minute → a fresh session at the discounted amount, no
      `internal` "Failed to start checkout". And `moneyCore.test.ts:103-120`
      passes **unedited**.
- [ ] **Timer ordering (N9, B3, B3b):** a 120-minute waitlist claim paid by gift
      card → both the card hold's and the promo reservation's `expires_at` are
      **after** the Stripe session's, and within MARGIN of it. A plain 31-minute
      drop-in: same. **A product bought with a promo → the session expires in
      ~31 minutes, not 24 hours**; the same product with no instrument → no
      `expires_at` at all.
- [ ] **A use is consumed by a sale, not an attempt (N8b):** fill the class
      between checkout creation and payment → the oversell branch refunds in
      full, `usage_count` is **unchanged**, the buyer can use the code again.
      Repeat for the drop-in duplicate charge and both appointment refund
      branches.
- [ ] **Release paths (all eight sites, §5.3):** force each of —
      `reserveGiftCardDrawdown` not-found / currency / unusable, the full-cover
      transaction, the pending-hold transaction, `startOneOffCheckout`,
      `runAppointmentSlotTransaction`, `handleCheckoutExpired` — to throw or
      fire, and assert the promo doc holds **zero** reservations afterwards.
- [ ] **The mistyped gift card (§2.5's flagship case, one character wrong):**
      valid promo + invalid gift-card code → the reserve throws, the promo is
      released, and re-submitting with the correct card **succeeds**.
- [ ] **Every resolver call site reached (N10b, P3-H):** as a signed-in member
      with a 25% code on a CHF 40 class, Stripe charges **30**. Same as a
      waitlist claimant. Then remove the context from one call site in a scratch
      build → the callable **throws**, and does not charge 40.
- [ ] **The `quotedAmount` guard (N10b):** with a code, send a stale
      `quotedAmount` → refused `price_changed` carrying the current figure; send
      none → proceeds. **Then press the button again**: the surface now names the
      server's price, re-sends it, and the purchase COMPLETES — a refusal that
      cannot be acted on is a failed test, not a passed one.
- [ ] **The refusal says what actually happened (§7.3 CORRECTION 3):** as a
      JOINED member on the public booking page, apply a `new_contacts` code
      **before** filling in the guest form (the preview sees an anonymous caller
      and accepts it), then submit with the member's email. The message must name
      the audience — "This code is for new customers only." — and then state the
      price without it. Reading "The price changed while you were checking out" is
      a FAILED test: the studio's price never moved, and the visitor cannot act on
      a sentence about the wrong thing.
- [ ] **An ordinary purchase is never refused over a price (the scope):** with NO
      code, buy as a member whose primary subscription type is a credit pack with
      **0 remaining** that is listed in the activity's `memberBenefit`. The screen
      shows the member rate, the server resolves base — and the booking must
      complete at base, not refuse. Same with a product price raised in the admin
      while the shop tab stays open.
- [ ] **No price ever rises (N5):** a `fixed_price` benefit of 999 on a base of
      25 charges 25 with **no** `appliedBenefit` (B1); a `fixed_price` promo of
      999 reports `superseded`. **And the equal-value case:** a `fixed_price`
      benefit of 25 on a base of 25 charges 25 **with** `appliedBenefit`, so
      `/offer/pricing` still shows the member badge and an appointment booking
      still records its `subscription_type_id`.
- [ ] **`superseded` says by WHAT (§2.2, corrected in P3-C):** a code beaten by
      the LIST price reports `by: 'base'` → `supersededByBase`; a code beaten by
      a member benefit reports `by: 'benefit'` → `supersededByBenefit`. The
      client switches on `by` and never re-derives it from `appliedBenefit`.
- [ ] **Attribution survives a campaign (§2.2):** a member with a benefit who
      uses a better code → the booking's `subscription_type_id` is still their
      membership, sourced from `appliedPromo.supersededBenefit`.
- [ ] **One computation per surface (N23):** a member holding a 20% benefit
      applies a 25% code to a CHF 40 drop-in → **one** discount row (−10), total
      30, and Stripe charges 30. Repeat in the shop modal and the appointment
      picker.
- [ ] **The priced-trial door renders no promo field** (§7.2) — an activity with
      `trialPriceAmount` set, guest takes the trial door.
- [ ] **Preview and checkout agree (N22):** a "3 per week" member who has spent
      this week booking a class nine days out → the preview reports
      `not_needed`, never a quoted discount.
- [ ] **The live-reservation ceiling:** `PROMO_MAX_LIVE_RESERVATIONS + 1`
      distinct identities → the last gets `promo_busy` (not `promo_exhausted`),
      and the admin list shows the reserved count.
- [ ] **Manager levers:** `releasePromoReservations` clears the map and leaves
      `usage_count` untouched; `clearPromoRedemption` by email and by contactId
      resolve the same doc.
- [ ] **Document size (N20):** `grep -rn "committed" packages/shared/src/types/promoCode.ts`
      finds no map field, and a code with 25 live reservations is well under
      100 KB.
- [ ] **No zero total (N3):** no promo configuration produces `pay.amount === 0`;
      `createPromoCode` refuses `percent: 100` with `invalid-argument`.
- [ ] **A losing promo consumes nothing (N11):** apply a code a member benefit
      beats → `superseded`, no reservation written, `usage_count` unchanged.
- [ ] **A covered booking (N11):** apply a code as a subscription holder →
      `not_needed`, price unchanged, nothing written.
- [ ] **The `product` arm (N6, B2):** buying a product with no promo produces a
      byte-identical Stripe session payload to `4b3177f`'s.
- [ ] **Rules (N14, N15):** every client write to `teams/{t}/promo_codes/**` is
      denied by the rules emulator, including from a manager and from a
      `schedule.manage` holder; no client code reads the collection.
- [ ] **Plan gate, creation only (N16):** downgrade a Studio team with a live
      code to `free` → previews, reserves, commits and releases all still work;
      `createPromoCode` is refused with `reason: 'plan_required'`.
- [ ] **Rate limiting:** 31 `previewPromoCode` calls from one IP → the 31st
      throws `rate_limited`, while `createDropInCheckout` from the same IP still
      succeeds (separate bucket).
- [ ] **Duplicate code:** creating an existing code returns `already-exists` with
      `reason: 'code_taken'` — and **no second document is created under a
      different code**.
- [ ] **i18n (N18):** identical key sets across all four `messages/*.json` in
      `Promo`, `PromoCodes` and `Nav`.
- [ ] **No index was added** to `firestore.index.json`, and every promo query is
      a document `get` or a single-field ordered list.
- [ ] **Finance (§6):** the promo **adds no row of its own**. Stated as a
      difference, not as an absolute count, because revision 1's wording
      contradicted the spec's own flagship case: a promo **+ gift card**
      purchase writes the charge row *and* the gift-card reclass pair
      (`buildGiftCardReclassTxns` → `recordGiftCardReclass`,
      `giftCards.ts:472-493`), so "exactly one row, `by_category.gift_card`
      untouched" would fail on correct behaviour. The gate:
      **the row count and the `gift_card` reclass are byte-identical to what the
      same purchase produces WITHOUT the code, with `gross` reduced to the
      discounted charge.** Concretely for CHF 40 / 25% / CHF 20 card: charge row
      gross 1000, plus the reclass pair +2000 `drop_in` / −2000 `gift_card`;
      `assertFinanceInvariant` holds; no row mentions the promo.
