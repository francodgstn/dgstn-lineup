# Wave 3 — Phase 0 + Phase 1 implementation spec

Corrected, implementable spec produced by reconciling the Wave 3 gift-card design
against its adversarial critique and the cross-cutting collisions analysis
(workflow `wf_fc749ebe-409`), then re-verifying **every** load-bearing claim
against this worktree. Authoritative context: `docs/fareharbor-analysis.md` §7.

**Every line reference below was re-read in this tree.** Where the design spec
and the critique disagree, the critique wins — except in the two places named in
§0.2, where the critique is demonstrably wrong and the evidence is cited.

**Scope.** Phase 0 (shared foundations) + Phase 1 (gift cards). Waitlist, promo
and waivers are Phase 2–4; the only obligation here is to leave the hooks the
cross-cutting analysis identified (§7).

---

## 0. Corrections to the source material

### 0.1 The four BLOCKERS, resolved

| # | Blocker | Resolution | Work item |
|---|---|---|---|
| 1 | Admin-mint idempotency is query-then-create and does not dedupe | **Claim-first.** `teams/{teamId}/gift_card_issues/{issueRef}.create()` is the serialisation point; mint only when the create wins, stamp the code back on the claim. `mintGiftCard`'s `.where(...)` dedupe is never used on this path. | **P1-G** |
| 2 | The reclass pair is not atomic and the webhook cannot retry it | **One `WriteBatch`, both rows or neither** (`WriteBatch.create` exists — `@google-cloud/firestore/types/firestore.d.ts:1213`), plus a `committed_holds[holdKey].reclassed_at` marker on the card so a backfill can find one-sided state. | **P1-D** |
| 3 | Nothing validates card currency against charge currency | **Currency guard inside `reserveGiftCardDrawdown`**, plus one source of truth for a card's currency (the charge currency, never a caller-supplied string). See §0.2 — the *premise* both source documents used is wrong, the *conclusion* is right. | **P1-B** |
| 4 | Major vs minor units disagree; a literal implementation records 100× the cash | **One naming rule, stated once and enforced by suffix**: `…Major` / `…Minor`, no bare `amount`. `requireChargeableAmountFromMajor` is used on the mint path as a **validator only — its return value is discarded** (it returns MINOR: `connect/checkout.ts:41-48`). | **P1-G** |

### 0.2 Where the critique is mistaken (verified)

**(a) Blocker 3's premise — "fixing the `'CHF'` hardcode converts a cosmetic
defect into a money defect" — is false.**

`resolveStripeCurrency` (`packages/shared/src/types/currency.ts:53-55`)
**deliberately ignores its argument and always returns `'chf'`**:

```ts
export function resolveStripeCurrency(_teamDefaultCurrency: string | null | undefined): string {
  return DEFAULT_CURRENCY.toLowerCase()
}
```

Its own doc comment (`:44-52`) says the Connect rail is CHF-only in Phase 1 and
that honouring `default_currency` is "a one-line, separately-reviewed change".
`startOneOffCheckout` passes the team's currency through it
(`connect/checkout.ts:148`), so **every Connect charge is CHF today regardless of
`teams/{id}.default_currency`.**

Consequences:
- The design spec's §0 "latent bug 1" (`webhook.ts:1258` hardcodes `'CHF'`
  "while `startOneOffCheckout` charges in `team.data.default_currency`") is
  **not a bug today** — the literal is correct.
- Deriving the card currency from `session.currency` cannot mint a EUR card:
  `session.currency` is `chf` because the session was created that way.
- The only thing that *could* mint a non-CHF card is an admin-mint `currency`
  input. **So that input is removed** (P1-B), not "considered".
- The guard in `reserveGiftCardDrawdown` is still **mandatory** — it is the
  tripwire that makes widening `resolveStripeCurrency` safe, it is ~4 lines, and
  it is unreachable today, which is exactly when to add it.

**(b) Line-ref corrections.** `planHasHardContactCap` is
`packages/shared/src/types/plan.ts:62-64` — the design spec is right, the
critique's `:61-63` is off by one. `resendPolicyFeeLink` is exported at
`packages/functions/src/index.ts:195` — **both** sources are wrong (`:197` and
`:196`). `scripts/backfill-finance-journal.ts` `create()` at `:142`, ALREADY_EXISTS
swallow at `:146`.

### 0.3 New findings — neither source caught these

**N1 — `bookingHoldsSeat` alone does NOT fix bug #3.** `docs/fareharbor-analysis.md:412`
claims Phase 0 item 2 "Fixes bug #3 standalone". It does not.
`trackBookings` is `onDocumentWritten('sessions/{sessionId}/bookings/{bookingId}')`
(`analytics/index.ts:51-52`) — it only recomputes `bookings_count` when a booking
doc is **written**. `bookSession`'s capacity gate reads the stored count and
throws *before* writing anything (`booking/index.ts:636-643`). So a session stuck
at `bookings_count == max` because of a lapsed hold stays stuck: the next booker is
refused, no booking write happens, no recount happens. It unsticks only on a
cancellation or the 02:00 sweep (`dailyTasks/index.ts:36`). **P0-2 therefore must
also add a re-count on the "looks full" path.**

**N2 — `createDropInCheckout` has NO capacity check at all.** Verified: the only
`bookings_count` reference in `booking/dropIn.ts` is the increment at `:397`; no
`max_participants` read, no `resource-exhausted` throw anywhere in the file. A
drop-in can oversell a full class today. This is a sibling of
`docs/fareharbor-analysis.md:383-385`'s `rebookSession` hole. **Out of scope
here** — it belongs with Phase 2's transactional capacity work, and
`bookingHoldsSeat` (P0-2) is the predicate it will use. Recorded so it is not
re-discovered.

**N3 — `payments.ts:545` and `:748` also hardcode `currency: 'CHF'`** on the
full-cover `applyPaymentEffects` calls. Same class as `webhook.ts:1258`; folded
into P1-B.

**N4 — `connect_checkout_attempts` has no retention.** `checkout.ts:112` writes
one doc per `{ip}:{hour}` and nothing ever deletes them (only reference in the
tree). Not in scope; recorded.

### 0.4 Design decisions taken from the critique over the spec

| Topic | Spec said | **Decision** |
|---|---|---|
| Guest idempotency key | make `data.idempotencyKey` **required, client-supplied**, fall back to hashed IP | **Server-generated** `crypto.randomUUID()` on the guest path. A client-supplied key on an unauthenticated callable hands Stripe's dedupe key to an attacker, and the hashed-IP fallback reproduces the very NAT collision it was meant to fix (`checkout.ts:88-90`). Two Checkout Sessions are harmless — only one can be paid. |
| `confirmProvisionalContact` on the gift path | add it "as a parity fix" | **Do not add it.** It flips a provisional contact — deliberately excluded from the Free cap (`utils/contactCap.ts:22-33`, `types/plan.ts:62-64`) — into one that consumes a slot, for the one purchase the design argues has no per-person effect. Comment the deliberate asymmetry at `webhook.ts:1239`. |
| Outstanding-liability figure | `sum('balance')` "or `giftCardAvailable` net of holds" | **Aggregation only, and label it honestly.** `giftCardAvailable` (`types/giftCard.ts:58-67`) is a pure client function over a map field (`:41`); a server aggregation cannot apply it. Add a currency equality filter — `sum('balance')` across mixed currencies is meaningless. |
| Chart-of-accounts migration | "verify whether `loadAccountingSettings` re-seeds mappings" | **It does not — a migration is mandatory.** Verified: `accounting/seed.ts:53-56` is a plain read; `ensureAccountingSeeded` (`:137-145`) re-seeds accounts but never touches `mapping`; `seedAccounts` is create-only (`:59-89`); `setChartTemplate` hard-refuses once entries exist (`accounting/settings.ts:32-38`). |
| Reclass amount | "the amount actually deducted" | **`card.balance − newBalance`**, computed inside the commit transaction after the `Math.max(0, …)` clamp (`giftCards.ts:214`) — never the requested amount, never the metadata value. |
| Reclass throwing | unstated | **Never throws.** The wrapper is called after goods are delivered (`dropIn.ts:426`, `payments.ts:549`, `:752`); `finance/journal.ts:10-12` is explicit that a journal failure must never break payment processing. |
| Ship "(i) then (iii)" as two phases | recommended | **One commit.** (i) is a strict subset of (iii) — same enum, same `mapCategory` case, same three template edits. |
| "Explicitly reject `giftCardCode`" | listed as a change | **A comment, not a change** — `createGiftCardCheckout` never reads that field (`giftCards.ts:278-285`). |
| `sanitizeEmail(...)` | used in the sketch | **No such helper exists** (verified). Use `EMAIL_RE` (`dropIn.ts:50`) + `normalizeEmail` (`packages/shared/src/utils/normalizeEmail.ts:5`). |

### 0.5 Rejected outright, with the constraint that forbids it

- **Zero-cash reclass row** (`gross = +d, net = 0`) — violates
  `assertFinanceInvariant` (`types/finance.ts:204-226`) and produces `−gross ≠ 0`
  in `buildEntryFromFinanceTxn` (`accounting/posting.ts:121-126`).
- **Deferred-revenue treatment** (gift sale as a liability, ASC 606 / IFRS 15) —
  forbidden by `docs/accounting.md:105` ("Cash-basis only — entries mirror money
  events; no deferred revenue or accruals"). It is the accounting-correct answer
  and the locked rule rules it out; the `gift_card` bucket's running balance is
  its cash-basis shadow.
- **A maintained outstanding-balance counter on the team doc** — a second source
  of truth that drifts on any missed path.

---

## 1. Binding invariants (restated — every work item is checked against these)

1. **Stage A / Stage B.** A price modifier belongs inside `resolvePaymentOptions`.
   A tender belongs at the checkout callable. Nothing may be both. A gift card is
   a **tender** — verified: zero `gift` hits in
   `packages/shared/src/utils/paymentOptions.ts`. Nothing in this spec adds a
   gift-card arm to the resolver.
2. **Two floors.** Authored prices below `MIN_CHARGE_MAJOR` **throw**
   (`connect/checkout.ts:41-48`); arithmetic-derived prices **clamp**
   (`shared/src/utils/money.ts:5-10`). `planGiftCardRedemption`
   (`types/giftCard.ts:82-99`) protects the residual by **shrinking the
   drawdown**, never by clamping the residual.
3. **Finance invariant.** `gross + stripe_fee + platform_fee === net` on every
   row (`types/finance.ts:204-226`). The reclass pair satisfies it per row and
   sums to exactly zero in `totals`, `by_category`, `by_source` and every fee
   bucket (`types/finance.ts:284-290, 336-365`).
4. **Cash basis.** Entries mirror money events. A comp is not a money event and
   writes nothing.
5. **Public routes read only `public_profile` mirrors.** The shop reads gift-card
   config from the team mirror (`sync/syncTeamPublicProfile.ts:213-221`). Guest
   purchase adds **no** new client read of `teams/{id}` or `gift_cards`.
6. **Bookings are keyed by `contactId`** — `sessions/{id}/bookings/{contactId}`.
7. **`packages/functions/src/finance/journal.ts` is the ONLY writer of
   `finance_transactions`.** The reclass helper lives there; the outstanding
   figure is computed from `gift_cards` and never journaled.
8. **i18n.** Every user-visible string is a message key present in **all four** of
   `en/de/fr/it.json` in the same namespace. Email copy does **not** live there
   (see P1-H).
9. **Imports.** `Link` / `useRouter` / `usePathname` from `@/i18n/navigation`.

---

## 2. PHASE 0 — shared foundations

No user-visible feature. Each item is otherwise re-invented in three later phases.

### P0-1 · `checkoutRateLimit(ipRaw, prefix?, limitPerHour?)`

**Files + symbols**
- `packages/functions/src/connect/checkout.ts:102-122` —
  `CHECKOUT_RATE_LIMIT_PER_HOUR`, `checkoutRateLimit`
- All 7 call sites: `connect/giftCards.ts:290`, `:350`;
  `connect/payments.ts:300`, `:462`, `:625`; `booking/dropIn.ts:114`;
  `appointments/checkout.ts:72`

**Change**
```
checkoutRateLimit(ipRaw: string | undefined, prefix = 'checkout', limitPerHour = CHECKOUT_RATE_LIMIT_PER_HOUR)
doc id: `${prefix}:${ip}:${bucket}`      (was `${ip}:${bucket}`)
```
Assign prefixes: `'gift-buy'` (`giftCards.ts:290`), `'gift-check'`
(`giftCards.ts:350`), `'checkout'` for the five purchase callables (unchanged
default → byte-identical behaviour for them). `limitPerHour` exists so Phase 3's
promo-preview bucket is a parameter, not a second function (cross-cutting D-6).

**Failure mode prevented.** Today one 30/hr counter is shared by every public
checkout attempt AND `checkGiftCard`. Once guest gift purchases land on the same
bucket, a purchase burst locks a legitimate customer out of *redeeming* a card at
another studio-adjacent surface from the same IP (office/gym Wi-Fi, NAT).

**Verify.** Emulator: call `checkGiftCard` 31× from one IP → the 31st throws
`resource-exhausted`; then call `createDropInCheckout` from the same IP → still
succeeds (separate bucket). Inspect `connect_checkout_attempts` doc ids.

**Note.** The doc-id change orphans existing `{ip}:{bucket}` docs. Harmless
(hourly counters), but see §0.3 N4 — nothing prunes that collection. Not in scope.

---

### P0-2 · `bookingHoldsSeat` + `isExpiredWaitlistClaim`, and the stale-full re-count

**Files + symbols**
- `packages/shared/src/types/session.ts` — add beside `isExpiredAppointmentHold`
  (`:6-11`) and `appointmentSlotBlocked` (`:17-22`); they are the third and
  fourth members of one family.
- `packages/functions/src/analytics/index.ts:106-110` — `trackBookings`' inline
  `NON_HOLDING` set.
- `packages/functions/src/booking/index.ts:636-643` — `bookSession`'s capacity gate.

**Change**
```ts
// shared/src/types/session.ts
export function isExpiredWaitlistClaim(
  b: { waitlist_claim?: boolean; claim_expires_at?: { toMillis(): number } | null },
  nowMs = Date.now()
): boolean            // true only when waitlist_claim === true AND claim_expires_at <= now

export function bookingHoldsSeat(
  b: {
    status?: string
    payment_status?: string
    expires_at?: { toMillis(): number } | null
    waitlist_claim?: boolean
    claim_expires_at?: { toMillis(): number } | null
  },
  nowMs = Date.now()
): boolean
// false when: status ∈ {cancelled, no_show, rebooked}
//          OR (payment_status === 'required' && expires_at <= nowMs)
//          OR isExpiredWaitlistClaim(b, nowMs)
// true otherwise — an ABSENT status is pending and still holds a seat
//                  (preserves today's semantics at analytics/index.ts:107-110)
```
`trackBookings` replaces its reduce with `bookingHoldsSeat(d.data(), nowMs)`.
`isExpiredWaitlistClaim` is **inert today** — no booking carries `waitlist_claim`.
It lands now so Phase 2 adds a field, not a family member.

`bookSession`'s gate becomes: when `bookings_count >= maxGroup`, **re-count live
bookings** with `bookingHoldsSeat` before throwing `resource-exhausted`; if the
live count is below the cap, write the corrected `bookings_count` and proceed.
One extra read, only on the path that was about to refuse a customer.

**Failure mode prevented.** `docs/fareharbor-analysis.md:386-389` bug #3: an
abandoned drop-in checkout keeps its seat until the 02:00 sweep
(`dailyTasks/index.ts:36`). **The `trackBookings` switch alone does not fix it**
— see §0.3 N1: the refusal happens before any booking write, so no recount is
triggered. The re-count on the full path is what closes it.

**Verify.** Emulator: session `max_participants: 1`; create a drop-in hold
(`payment_status: 'required'`, `expires_at` = now − 1 min); assert
`bookSession` for a second contact **succeeds** and that `bookings_count`
settles at 1, not 2. Unit-test both predicates in a new
`packages/functions/src/booking/sessionHolds.test.ts` (pure, no Firestore).

**Do not** change `dailyTasks/expirePendingBookings.ts` here. Phase 2 makes
`sweepWaitlistOffers` the single owner of claim holds (cross-cutting D3).

---

### P0-3 · `commitGiftCardHold` returns the committed amount; null-guard the dedupe query

**Files + symbols**
- `packages/shared/src/types/giftCard.ts` — **new pure helper**
- `packages/functions/src/connect/giftCards.ts:99` (`mintGiftCard` dedupe query),
  `:186-224` (`commitGiftCardHold`)

**Change**

(a) New pure helper, so the arithmetic is unit-testable in the file that already
owns gift-card math (this resolves the critique's finding #17 for this case):
```ts
// shared/src/types/giftCard.ts
export function applyGiftCardCommit(
  balanceMajor: number,
  requestedMajor: number
): { newBalanceMajor: number; committedMajor: number }
// newBalance = Math.max(0, round2(balance - requested))
// committed  = round2(balance - newBalance)     ← the ACTUAL movement
```

(b) `commitGiftCardHold` returns `Promise<number>` = `committedMajor`, `0` when
nothing was committed (card gone, or no hold and no fallback — `:199`, `:206-211`).
The transaction uses `applyGiftCardCommit`; it must **not** return the input.

(c) `mintGiftCard:99` — skip the dedupe query entirely when
`params.paymentIntentId` is falsy. Never run `.where('payment_intent_id','==',null)`.

**Failure mode prevented.**
- Returning the requested amount instead of the movement books more value than
  moved, because of the `Math.max(0, …)` clamp at `:214` (critique #6). Every
  downstream reclass would then be wrong by the clamped remainder.
- The null query would return `GC-DEMO-CARD` — which exists today with
  `payment_intent_id: null` (`scripts/seed-emulator.ts:1830`) — and hand a
  *different* studio's demo card back to the caller as "already minted".

**Verify.** `packages/functions/src/connect/giftCardMath.test.ts`: `applyGiftCardCommit(20, 25)`
→ `{ newBalanceMajor: 0, committedMajor: 20 }`; `(20, 5)` → `{ 15, 5 }`;
`(0.30, 0.30)` → `{ 0, 0.30 }`. Emulator: commit against a card with
`balance < fallbackAmountMajor` and assert the returned value equals the balance
that disappeared.

---

### P0-4 · The client price breakdown calls `planGiftCardRedemption`

**Files + symbols**
- `apps/web/src/app/[locale]/(public)/public/[slug]/booking/BookingForm.tsx:1716-1753`
  (the computation at `:1725-1728`). Namespace: `PublicBooking`
  (`BookingForm.tsx:279`).
- `apps/web/messages/{en,de,fr,it}.json` → `PublicBooking` (existing price keys at
  `en.json:3596-3599`).

**Change.** Replace
```ts
const giftCardDeduction = giftCardApplied ? Math.min(giftCardApplied.balance, afterBenefit) : 0
const total = Math.max(0, afterBenefit - giftCardDeduction)
```
with `planGiftCardRedemption(giftCardApplied.balance, afterBenefit)` — the same
pure function the server uses, already imported and used this way in
`ShopHome.tsx:1143`. Render the cross-cutting §1 target shape, which separates
the **tender** from the **discounts**:

```
Price                    CHF 20.00     priceSubtotal      (existing)
Member discount         −CHF  2.50     priceMemberDiscount (existing, conditional)
────────────────────────────────────
Subtotal                 CHF 17.50     priceAfterDiscounts (NEW — only when a discount line showed)
Gift card GC-7F3K       −CHF 17.00     priceGiftCard      (existing — the DRAWDOWN, never the balance)
────────────────────────────────────
To pay now               CHF  0.50     priceTotal         (existing)
Gift card remaining      CHF  2.80     priceGiftCardRemaining (NEW, conditional)
```

New keys in **all four** locale files under `PublicBooking`:
`priceAfterDiscounts`, `priceGiftCardRemaining`. When
`planGiftCardRedemption` returns `null` (no usable balance) the gift lines are
omitted entirely.

**Failure mode prevented.** `docs/fareharbor-analysis.md:390-394` bug #4. Price
20.00 with a 19.80 balance: the UI promises "−19.80, total 0.20" while the server
draws 19.50 and charges 0.50. The customer sees one number at consent and another
on the Stripe page.

**Verify.** The pure branch is already covered by
`packages/functions/src/connect/giftCardMath.test.ts` (`planGiftCardRedemption`).
Manual: a drop-in priced 20.00 against a card seeded to 19.80 must render
`−19.50 / to pay 0.50 / remaining 0.30` — exactly what `createDropInCheckout` then
charges (`dropIn.ts:491`). Today it renders `−19.80 / total 0.20`. Confirm all
four locale files parse and have equal key counts.

**Why before Phase 3.** A promo lowers the price and therefore makes the
floor-shrink branch (`giftCard.ts:92-97`) far more common. The display must model
the server before a third line is added to it.

---

## 3. PHASE 1 — Gift cards

Phase 1 is the only project *fixing existing production behaviour on real money*.
Order within the phase matters: **P1-A → P1-B → P1-C/P1-D → everything else.**

### ⚛ ATOMIC GROUP A — the `gift_card` category

**Must not be split. A partial landing fails CI or silently mis-posts.**

#### P1-A · `FinanceCategory` + `PaymentLineItemKind` + three chart templates

**Files + symbols**
- `packages/shared/src/types/finance.ts:72` — `FinanceCategory += 'gift_card'`
- `packages/shared/src/types/finance.ts:186-200` — `mapCategory` gains
  `case 'gift_card': return 'gift_card'`
- `packages/shared/src/types/finance.ts:292-298` — `FINANCE_CATEGORIES += 'gift_card'`
- `packages/shared/src/types/payment.ts:32` — `PaymentLineItemKind += 'gift_card'`
- `packages/functions/src/payments/effects.ts:36-43` — `LINE_ITEM_KINDS += 'gift_card'`
- `packages/functions/src/payments/effects.ts:296-314` — add an explicit
  `case 'gift_card':` alongside the record-only default, with its own log message
- `packages/functions/src/connect/webhook.ts:421-423` — `lineItemFromMetadata`
  returns `{ kind: 'gift_card', label: 'Gift card' }` (was `kind: 'other'`)
- `packages/shared/src/accounting/chartTemplates.ts` — one new **revenue** account
  and one mapping key per template:

| Template | New account | Names | Mapping |
|---|---|---|---|
| `ch_kmu` (accounts `:52-89`, mapping `:90-109`) | `3404` | de `Ertrag Geschenkkarten` · fr `Produits des cartes-cadeaux` · it `Ricavi carte regalo` · en `Gift card revenue` | `gift_card: '3404'` |
| `de_skr04` (`:117-154`, `:155-175`) | `4404` | de `Erlöse Gutscheine` · en `Gift card revenue` | `gift_card: '4404'` |
| `it_standard` (`:182-219`, `:220-240`) | `3004` | it `Ricavi carte regalo` · en `Gift card revenue` | `gift_card: '3004'` |

All three codes are free (verified against each template's account list). Each
template must ship names for **every locale it declares** (`locales` at `:51`,
`:116`, `:181`) — the test enforces it.

**Failure mode prevented.** Today a gift-card sale journals as
`category: 'other'` (`mapCategory` default at `finance.ts:197-198`) even though
`MemberPayment.kind` is already `'gift_card'` (`webhook.ts:507`) — it sits in the
same bucket as no-show fees and manager one-offs. Without the
`PaymentLineItemKind` addition, `normalizePaymentLineItem` (`effects.ts:51`)
returns `null` for the admin-mint row and it lands in `'other'` too — the exact
bug being fixed. Without the template edits, `AccountingMapping.revenue_by_category`
(`types/accounting.ts:68`) is `Record<FinanceCategory, string>` and **does not
compile**.

**Verify.** `pnpm typecheck` (the `Record` is the compile-time tripwire) and
`pnpm --filter @linyup/functions test` — `accounting/chartTemplates.test.ts:32-49`
asserts every `FINANCE_CATEGORIES` entry maps to a seeded account, and `:51-64`
asserts the mapped account is typed `revenue`. **The test needs no edit; it is the
tripwire, and it must be green in the same commit.**

**Note.** No `Record<PaymentLineItemKind, …>` exists anywhere (verified), so that
union widening is not itself a compile break — it is in this group because the
category is otherwise unreachable from the manual rail.

**Accepted side effect.** `applyPaymentEffects`' record-only branch merges
`last_payment_at` onto the contact and appends a `payment_received` activity entry
(`effects.ts:296-313`). For an admin **paid** mint linked to a purchaser contact
this is correct — they did pay. Documented rather than special-cased.

---

### P1-B · One source of truth for a card's currency + the reserve guard

**Must land in the same commit as any change that touches a card's `currency`.**

**Files + symbols**
- `packages/functions/src/connect/giftCards.ts:140-178` — `reserveGiftCardDrawdown`
- `packages/functions/src/connect/giftCards.ts:330` — the `Gift card CHF ${amount}`
  product name
- `packages/functions/src/connect/webhook.ts:1258` — `currency: 'CHF'` on the mint
- `packages/functions/src/connect/payments.ts:545`, `:748` — `currency: 'CHF'` on
  the full-cover `applyPaymentEffects`
- Reserve call sites: `booking/dropIn.ts:360-365`,
  `connect/payments.ts:531-536`, `connect/payments.ts:734-739`

**Change**
1. **Card currency has exactly one source: the charge currency.**
   Add to `connect/giftCards.ts`:
   ```ts
   /** THE currency a card is minted in and redeemable against — always the
    *  currency the Connect rail actually charges in. Never a caller-supplied
    *  string: a card in a currency the rail cannot charge is unredeemable.
    *  See shared/types/currency.ts:44-55 — resolveStripeCurrency is CHF-pinned
    *  today, so widening the rail widens cards in the same one-line change. */
   export function giftCardCurrency(teamDefaultCurrency?: string | null): string {
     return resolveStripeCurrency(teamDefaultCurrency).toUpperCase()
   }
   ```
   Use it at `webhook.ts:1258` (or `session.currency?.toUpperCase()`, which is
   equal by construction), at `giftCards.ts:330` for the product name, at the
   admin mint (P1-G — **which takes no `currency` input**), and at
   `payments.ts:545`/`:748` (pass the card's currency through from the reserve).
2. **`reserveGiftCardDrawdown` gains a required `chargeCurrency: string`** and,
   inside the transaction after loading the card:
   ```ts
   if (normalizeCurrency(card.currency) !== normalizeCurrency(params.chargeCurrency)) {
     throw new HttpsError('failed-precondition', 'Gift card is in a different currency', {
       reason: 'gift_card_currency_mismatch',
     })
   }
   ```
   All three call sites pass `giftCardCurrency(team.data.default_currency)`.
3. Client copy: map `gift_card_currency_mismatch` in
   `giftCardCheckoutErrorMessage` (`components/booking/GiftCardRedeemField.tsx:58-69`)
   to a new `Shop.giftCardCurrencyMismatch` key (all four locales).

**Failure mode prevented.** `reserveGiftCardDrawdown` (`:140-178`) and
`planGiftCardRedemption` (`types/giftCard.ts:82-99`) are pure number math with no
currency comparison; `checkGiftCard` returns the currency (`:352-358`) but no
caller enforces it. A card in any currency other than the charge currency draws
down 1:1 — CHF 100 of value silently paying a EUR 100 charge. Unreachable today
(§0.2a); reachable the moment `resolveStripeCurrency` widens or anyone adds a
currency input. The guard is what makes that later change a one-liner instead of
a money incident.

**Verify.** Unit: none needed for the guard (it is an equality check), but add an
emulator case — seed a card with `currency: 'EUR'`, call `createDropInCheckout`
with its code, assert `failed-precondition` / `gift_card_currency_mismatch` and
that **no hold was written** to the card. Grep afterwards: zero `'CHF'` string
literals remain in `connect/giftCards.ts`, `connect/payments.ts` gift branches,
and `webhook.ts`'s `handleGiftCardCheckout`.

---

### ⚛ ATOMIC GROUP B — the single commit path

**P1-C and P1-D must land together.** A wrapper without the pair does nothing; a
pair helper without the wrapper leaves four call sites free to commit without it.

#### P1-C · `commitGiftCardDrawdown(...)` — the ONLY way a drawdown is committed

**Files + symbols**
- `packages/functions/src/connect/giftCards.ts` — new export
- `packages/shared/src/types/giftCard.ts` — `GiftCard.committed_holds` field
- Call sites collapsing to it: `connect/webhook.ts:914-926`,
  `connect/payments.ts:549`, `connect/payments.ts:752`, `booking/dropIn.ts:426`
- `packages/functions/src/connect/giftCards.ts:228-247` — `restoreGiftCardDrawdown`
  must clear the committed marker

**Change**
```ts
export async function commitGiftCardDrawdown(params: {
  teamId: string
  code: string
  holdKey: string
  /** Reserved drawdown from checkout metadata — the late-commit fallback. */
  fallbackAmountMajor?: number
  /** The category the redeemed value should be attributed to. */
  targetCategory: FinanceCategory
  contactId?: string | null
  occurredAtMs?: number
  description?: string | null
  // ── riders declared for later phases; UNUSED in Phase 1 ──
  promoRedemptionId?: string   // Phase 3 commits it in the same call
  waitlistEntryId?: string     // Phase 2 flips the entry to 'claimed' here
}): Promise<{ committedMajor: number; reclassed: boolean }>
```

Behaviour, in order:
1. **One transaction** on the card doc:
   - if `card.committed_holds?.[holdKey]` exists → **no-op**, return its stored
     amount with `reclassed: true` (already done);
   - otherwise compute the deduction with `applyGiftCardCommit` (P0-3), delete the
     hold, write `balance` / `status`, and write
     `committed_holds[holdKey] = { amountMajor, at: serverTimestamp() }`;
   - prune `committed_holds` entries older than 90 days while the doc is loaded
     (the same lazy-cleanup idiom as `dropExpiredHolds`, `:69-81`) so the map
     cannot grow without bound;
   - read `issue_kind` off the same snapshot.
2. If `committedMajor > 0` **and** `issue_kind !== 'admin_comp'`, call
   `recordGiftCardReclass(...)` (P1-D) with the card's `currency`.
3. Stamp `committed_holds[holdKey].reclassed_at` on success.
4. Step 2 and 3 are wrapped in `try/catch` and **never throw**. Step 1 may throw —
   it is the money.

`restoreGiftCardDrawdown` gains `holdKey` and deletes
`committed_holds[holdKey]` so a re-charge can re-commit.

**Failure modes prevented**
- **Missed call site (silently wrong, nothing detects it).** Adjustment rows are
  invisible to `reconciliationCheck`, which counts only `type == 'charge'`
  (`finance/monthlyReports.ts:100`). Making the wrapper the only commit path is
  the structural guarantee.
- **Full-cover writes nothing at all.** `payments.ts:539-551`, `:742-761` and
  `dropIn.ts:368-434` create no Stripe session, so `handleCheckoutCompleted`
  (`webhook.ts:900`) never runs and **no `finance_transactions` row exists for a
  real money-equivalent event** (`docs/fareharbor-analysis.md:395-397`, bug #5).
  Writing the pair at those three sites is the fix.
- **The double-spend the sources never named** (critique #5). `commitGiftCardHold`
  deducts `hold?.amount ?? fallbackAmountMajor` (`:205`). If the hold lazily
  expired (`DEFAULT_HOLD_MINUTES = 35`, `:50`) the freed balance can be spent by a
  second redemption, and the first payment landing late deducts again via the
  metadata fallback — value delivered twice, absorbed by the studio because the
  balance clamps at 0 (`:214`). `SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES = 31`
  (`checkout.ts:98`) narrows but does not close the window (async payment methods,
  a dropped `checkout.session.expired`). **`committed_holds` closes it**: a
  re-commit of the same hold key is a no-op, and the reclass fires exactly once.
- **Later phases rediscovering four sites.** Promo's commit and the waitlist
  claim-confirm ride the riders (cross-cutting §2d, §3).

**Category at each site** — verified reachable:
- `webhook.ts:914` runs **before** the per-kind dispatch (`:928-951`) and `md` is
  in hand at `:906` → `mapCategory(md.kind)`.
- `payments.ts:549` → `'product'`; `payments.ts:752` → `'course'`;
  `dropIn.ts:426` → `'drop_in'`.

**Verify.** Emulator, four scenarios: partial drop-in redemption (webhook path),
full-cover product, full-cover course, full-cover drop-in — each produces exactly
two adjustment rows summing to zero, and re-invoking the same commit produces
none. A comped card produces zero rows. Assert `committed_holds[holdKey]` exists
after each.

---

#### P1-D · `recordGiftCardReclass` — the atomic pair

**Files + symbols**
- `packages/shared/src/types/finance.ts` — new pure builder
- `packages/functions/src/finance/journal.ts` — new writer (this file stays the
  only writer of `finance_transactions`)

**Change**
```ts
// shared/src/types/finance.ts
export function buildGiftCardReclassTxns(params: {
  teamId: string
  code: string              // canonical GC-XXXX-XXXX
  holdKey: string
  drawdownMinor: number     // toMinorUnits(committedMajor) — MINOR, positive
  currency: string          // the CARD's currency
  targetCategory: FinanceCategory
  contactId?: string | null
  occurredAtMs: number
  description?: string | null
}): [FinanceTransactionInput, FinanceTransactionInput]
```

| Row | `id` | `category` | `gross` | fees | `net` |
|---|---|---|---|---|---|
| A | `manual:adjustment:gift:{CODE}:{holdKey}:earn` | `targetCategory` | `+d` | 0, 0 | `+d` |
| B | `manual:adjustment:gift:{CODE}:{holdKey}:redeem` | `gift_card` | `−d` | 0, 0 | `−d` |

Both: `type: 'adjustment'`, `source: 'manual'`,
`source_ref: 'gift:{CODE}:{holdKey}'` (the ref shape already exists —
`payments.ts:537`, `:740`), `source_doc: teams/{teamId}/gift_cards/{CODE}`,
`fee_source: 'none'`, `month: monthKey(occurredAtMs)`. Both call
`assertFinanceInvariant`.

```ts
// functions/src/finance/journal.ts
export async function recordGiftCardReclass(
  pair: [FinanceTransactionInput, FinanceTransactionInput]
): Promise<boolean>
// ONE WriteBatch, two batch.create(...) calls, one commit.
// ALREADY_EXISTS (code 6) → return false (idempotent replay), never throw.
```

**Failure mode prevented — BLOCKER 2.** `recordFinanceTransaction` is one
`create()` per row (`journal.ts:52-60`) and `onFinanceTransactionWrite` posts each
row independently (`accounting/onFinanceTransactionWrite.ts:44-66`). Meanwhile the
Connect webhook claims the event id **before** processing (`webhook.ts:1817-1827`)
and swallows handler exceptions with a 200 (`:1897-1902`), so **Stripe never
redelivers**. A crash between row A and row B would leave `by_category` wrong and
the manual clearing account off by `d` **permanently**, and nothing would detect
it (`reconciliationCheck` ignores adjustment rows —
`finance/monthlyReports.ts:100`). The batch makes "one row only" unreachable; the
`reclassed_at` marker on the card is the second line of defence a backfill can
query.

**Why the pair is safe** (each point re-verified):
- Per row `gross + 0 + 0 === net` (`types/finance.ts:221`). ✅
- The pair contributes exactly 0 to `totals`, `by_category`, `by_source`,
  `by_currency` and every fee bucket (`addTotals`, `:284-290`; the loop at
  `:336-365`). Only `txn_count` (+2) and `by_source.manual.count` (+2) move. ✅
- `reconciliationCheck` counts only `type == 'charge'` (`monthlyReports.ts:100`)
  → no false drift alarm. ✅
- Posting: an `adjustment` is not a dispute, so
  `counterAccount = revenue_by_category[category]` (`posting.ts:117-120`); each
  entry balances by construction (`:121-126`, `assertBalanced` at `:146`). ✅
- A March redemption of a December card posts in March — a closed prior period is
  never reopened. ✅
- **Both rows must carry the same currency**, or `computeMonthlyFinanceReport`
  will bucket only the primary-currency one into `by_category` (`:347-352`) and
  the netting breaks. P1-B guarantees it.

**Accepted, documented artefact.** `clearing_by_source.manual` is the **cash**
account (`chartTemplates.ts:102` = `'1000'`, `:167` = `'1600'`, `:232` = `'1000'`)
and `buildEntryFromFinanceTxn` always debits it by `net` (`posting.ts:121`). So
each redemption inflates cash-account *turnover* by `2d` (debit `d`, credit `d`)
in `recomputePeriodSummary`, netting to zero. This is **not** "the textbook
reclassification entry" — a textbook reclass touches only the two revenue
accounts. Options considered: route the pair through a dedicated non-cash reclass
clearing account (a fourth `clearing_by_source` member, or a new mapping key).
**Decision: accept and document for Phase 1** — adding a mapping key is a second
compile-time break across three templates plus the same migration problem as
P1-K, for a cosmetic turnover artefact on a beta-marked, advisor-unreviewed chart
(`chartTemplates.ts:15-16`). Record it in `docs/gift-cards.md` and in the
accounting limitations list.

**What the P&L then shows.** Jan: `gift_card +100` (cash in). Mar:
`course +100 / gift_card −100`, month total 0. Lifetime: `course 100`,
`gift_card 0`. The running `gift_card` bucket is **sold − redeemed** =
recognised-but-unconsumed, which doubles as the liability proxy in P1-I. The
report label must say so.

**Verify.** `packages/functions/src/finance/monthlyReport.test.ts` (synthetic
rows): (a) the pair sums to zero in `totals`, `by_category` and `by_source`;
(b) a partial redemption yields `residual + drawdown == full price` in the target
category; (c) `reconciliation_check.ok` is unchanged by adjustment rows. Emulator
(new integration test — the two Firestore-dependent cases the critique correctly
said `giftCardMath.test.ts` cannot host): a comped card produces no pair; a
double `commitGiftCardDrawdown` produces exactly two rows total.

---

### P1-E · Guest gift-card purchase

**Files + symbols**
- `packages/functions/src/connect/giftCards.ts:276-339` — `createGiftCardCheckout`
- `packages/functions/src/connect/webhook.ts:1239-1291` — `handleGiftCardCheckout`
- `apps/web/src/app/[locale]/(public)/public/[slug]/shop/ShopHome.tsx:328-339`
  (`startCheckout`), `:613-627` (the callable), `:1158-1167` ("buying as")

**Change — callable**
```
:294  - const session = await requireContactSessionForTeam(request, teamId)
      - const email = session.email ?? undefined
      + const session = optionalContactSessionFromRequest(request)   // utils/contactSession.ts:15
      + const contactId = session?.teamId === teamId ? session.contactId : null
      + const prefillEmail = validated(data.purchaserEmail)          // PREFILL ONLY, never identity
```
Exactly the pattern `createDropInCheckout` already uses (`dropIn.ts:217-218`),
including its security comment. `validated` = `EMAIL_RE` (`dropIn.ts:50`) +
`normalizeEmail` (`packages/shared/src/utils/normalizeEmail.ts:5`). **There is no
`sanitizeEmail` helper in this tree** — do not invent one.

- **Metadata (`:314-321`) must spread `contactId` conditionally.** Stripe metadata
  is `Record<string, string>` and rejects non-string values:
  `...(contactId ? { contactId } : {})`. Add `locale` so the webhook can pick the
  email language (accepted at `:288`, never forwarded today).
- **Idempotency (`:323-325`).** Guest path: `crypto.randomUUID()`, server-side.
  A client-supplied `data.idempotencyKey` is accepted **only** when a contact
  session is present, and is namespaced + length-capped. Never
  `defaultIdempotencyKey('gift-pub', teamId, 'guest', amount)` — `checkout.ts:88-90`
  appends only a minute bucket, so two guests buying CHF 100 from one team in one
  minute would collide on Stripe's dedupe key and the second would receive the
  first's Checkout Session URL.
- **Keep unchanged:** `requireChargeableAccount(team)` (`:298`),
  `settings.giftCards.enabled` (`:301`), the amount whitelist against
  `settings.giftCards.amounts` (`:305`), `enforceAppCheck: APP_CHECK_ENFORCE` +
  `monitorAppCheck` (`:276-277`).
- **Rate limit:** `checkoutRateLimit(ip, 'gift-buy')` (P0-1).

**Change — webhook (`handleGiftCardCheckout`)**
```
a. contactId = md.contactId ? await verifiedMetadataContact(teamId, md) : null   // :350-357
b. if (!contactId && purchaserEmail) {
     const { contactId: match } = await resolveSingleContact(teamId, purchaserEmail)  // utils/contacts.ts:28-53
     contactId = match                       // LINK ONLY — never resolveOrCreateContact
   }
c. // NO confirmProvisionalContact — see the comment below (deliberate asymmetry)
d. currency: giftCardCurrency(...)           // P1-B — replaces the :1258 'CHF' literal
e. mintGiftCard(... recipient/message/issue fields ...)   // P1-H
f. delivery split (recipient vs purchaser)                // P1-H
```
`stampFinanceContact` at `:1268` is already conditional on `contactId` — correct
for guests, no change.

**The buyer does NOT become a Contact.** Reasons, in order:
1. `resolveOrCreateContact` exists to attach a **per-person purchase effect**
   (course entitlement, membership fields, credits). A gift card has none — the
   entitlement travels with the **code**, and the holder is usually somebody else.
2. Free plan: 15 confirmed actives, hard (`types/plan.ts:62-64`,
   `utils/contactCap.ts:41-46`). A studio selling 20 Christmas cards would fill
   its own allowance with non-customers. `contactCap.ts:1-5` shows this abuse
   vector was already designed against.
3. The lead is not lost: `purchaserEmail` is stored on the card
   (`types/giftCard.ts:43`) and reaches `member_payments` via `customer_details`.
   Surface a cap-aware **"Add as contact"** action on the gift-card row (P1-I).
4. **But link when it is free**: a unique active match consumes no slot
   (`resolveSingleContact`, `utils/contacts.ts:28-53`, which returns
   `{contactId: null}` on ambiguity rather than guessing — "email is NOT a unique
   key in Linyup", `:23-26`).

Write the comment at `webhook.ts:1239` explaining why `confirmProvisionalContact`
is **absent here** while product (`:1131`) and course (`:1187`) call it — otherwise
the next reader "fixes" the parity gap and re-introduces the cap hole.

**Change — client.** `startCheckout` (`ShopHome.tsx:328-339`) currently forces
sign-in for every kind. Allow `kind === 'giftcard'` through unauthenticated; the
modal shows a "Your email" field for guests and hides the "buying as" block
(`:1158-1167`).

**Failure modes introduced, and their mitigations**

| Mode | Consequence | Mitigation |
|---|---|---|
| Buyer typos the email at Stripe | Card exists, code goes nowhere — **unrecoverable today** | `resendGiftCardEmail` manager callable (P1-H) |
| Address on `mail_suppressions` | Silent skip | Same + the dashboard shows the code |
| `isSyntheticEmail` drop (`mail/messagingPolicy.ts`) | Demo/sandbox purchase yields a card with no email | Documented; dashboard is the recovery path |
| Tenant messaging policy `silent` (sandbox default) | No email at all | Same |
| Connect account disabled between checkout and webhook | Card still mints | Correct — money moved |
| **Stolen card → instant full-cover redeem → chargeback** | Laundering path with no identity attached | See P1-F |

**Verify.** Emulator: buy a gift card with no contact session → checkout starts,
webhook mints, card has `purchaserContactId: null`. Repeat with an email that
matches exactly one active contact → linked. Repeat with an email matching two
contacts of the same team → `purchaserContactId: null` (never guessed). Confirm
`contacts` count is unchanged in all three, and that no `provisional` flag was
cleared anywhere.

---

### P1-F · `refundMemberPayment` — gift-card handling (bug #1)

**Files + symbols**
- `packages/functions/src/connect/refunds.ts:17-76` — the entire callable
- `packages/functions/src/connect/webhook.ts:655-700` — `handleDispute`
- `packages/functions/src/connect/giftCards.ts:228-247` — `restoreGiftCardDrawdown`

**Verified state.** `refunds.ts` is 76 lines and contains **zero** gift-card
handling — no `gift`, no `drawdown`, no `restoreGiftCardDrawdown`. It refunds the
Stripe charge and returns (`:62-71`). Three distinct holes:

**(a) Refunding a gift-FUNDED purchase destroys stored value.** The residual is
refunded; the drawdown is never restored.
- **Change.** `commitGiftCardDrawdown` (P1-C) additionally stamps
  `gift_card_redeemed: { code, holdKey, amountMajor }` onto
  `teams/{teamId}/member_payments/{paymentIntentId}` — it is the only place that
  knows all three. `refundMemberPayment` then, **after** a successful
  `refundDirectCharge` and **only for a full refund**, calls
  `restoreGiftCardDrawdown({ teamId, code, holdKey, amountMajor })` and writes the
  **reversal pair** (`…:earn:rev` / `…:redeem:rev`, signs flipped, same builder).
- **Partial refunds (`data.amount` set) never touch the gift card.** A partial
  refund of a mixed-tender charge has no defensible split. Log it and say so in
  the manager UI.

**(b) Refunding a gift-card PURCHASE does not void the card.** Buyer gets the
money back and keeps live stored value.
- **Change.** Before calling Stripe, read `member_payments/{pi}`; if
  `giftCardCode` is set (stamped at `webhook.ts:1265`), require the card to be
  **untouched** (`balance === amount`, no live holds) and void it in the same
  operation. If it has been partially redeemed, **refuse** with
  `failed-precondition` `{ reason: 'gift_card_partially_redeemed' }` — clawing
  back spent stored value is not solvable in this callable.

**(c) A FULL-COVER redemption cannot be refunded at all.** Verified:
`payments.ts:539-551`, `:742-761` and `dropIn.ts:368-434` write no payment intent
and no `member_payments` doc, and `refundMemberPayment` requires
`member_payments/{paymentIntentId}` (`refunds.ts:40-49`). A full-cover **course**
purchase grants a lifetime entitlement (`payments/effects.ts:258-280`) with no
reversal path.
- **Decision, written down:** full-cover purchases are **not refundable through
  `refundMemberPayment` in Phase 1.** The manager path is: void or manually adjust
  the card, and cancel the booking/entitlement. Say this in the gift-card UI and
  in `docs/gift-cards.md`. A `restoreGiftCardValue(teamId, code, amountMajor,
  reason)` manager callable is the Phase-2 fix; the reversal-pair builder from
  P1-D is the piece it will need.

**(d) Chargeback on a guest purchase.** With sign-in removed (P1-E) and App Check
in **monitor mode** (`utils/appCheck.ts:14` — `APP_CHECK_ENFORCE` defaults false),
buy-with-stolen-card → instant full-cover redeem → chargeback is a clean path with
no identity attached. In-scope mitigation: `handleDispute` already loads
`member_payments/{pi}` (`webhook.ts:690-691`), so on
`charge.dispute.created` where `pay.giftCardCode` is set, **void the card**. Cheap,
correct, and at the right place. The amount whitelist (`giftCards.ts:305`) already
caps per-card exposure; P0-1's split bucket caps rate.

**Verify.** Emulator, four cases: (1) full refund of a part-gift drop-in →
balance restored, reversal pair written, `committed_holds[holdKey]` cleared;
(2) partial refund of the same → Stripe refund only, card untouched, a log line;
(3) refund of an untouched gift-card purchase → card `status: 'void'`;
(4) refund of a partially-redeemed gift-card purchase → `failed-precondition`
before any Stripe call. Plus: a full-cover purchase has no `member_payments` doc,
so `refundMemberPayment` returns `not-found` — assert the UI explains it.

---

### ⚛ ATOMIC GROUP C — admin mint

**P1-G is one commit**: the claim doc, the mint widening, and the manual-payment
linkage. A claim doc without the mint is dead data; a mint without the claim is
BLOCKER 1.

#### P1-G · `issueGiftCard` — the manager mint

**Files + symbols**
- `packages/functions/src/connect/giftCards.ts` — new `issueGiftCard` callable and
  a widened `mintGiftCard` (`:86-130`)
- `packages/functions/src/index.ts:191` — add the export beside
  `createGiftCardCheckout, checkGiftCard, voidGiftCard`
- `packages/shared/src/types/giftCard.ts:30-48` — new optional `GiftCard` fields
- `firestore.rules` — **no change** (see below)

**Name.** `issueGiftCard`, not `mintGiftCard` — the latter is the internal helper
at `giftCards.ts:86`.

**Auth.** `assertManager` (`connect/access.ts:25-29`) — the same bar as
`voidGiftCard` (`giftCards.ts:370`) and `recordManualPayment` (`:167`). A manager
who can *destroy* a card's value and record cash can also create one; requiring
owner breaks the front-desk case. Audit fields make it attributable.

**Idempotency — BLOCKER 1. Claim atomically, never query-then-create.**
```
1. issueRef = 'admin:' + <server-normalised client uuid>         // ≤120 chars, [A-Za-z0-9:_-]
2. teams/{teamId}/gift_card_issues/{issueRef}.create({
     status: 'claimed', amount_major, issue_kind, issued_by: uid, created_at
   })
   └─ ALREADY_EXISTS (code 6) → read the claim:
        • claim.code present  → return { code: claim.code, duplicate: true }
        • claim.code absent   → throw failed-precondition { reason: 'issue_in_flight' }
3. card = await mintGiftCard({ ..., issueRef, paymentIntentId: null })
4. claimRef.update({ code: card.code, status: 'minted' })
```
The existing `.where(...).limit(1).get()` dedupe (`giftCards.ts:99`) survives on
the webhook path **only** because the Connect webhook serialises delivery with an
event-id claim (`webhook.ts:1817-1827`). The admin path has no such serialiser, so
two concurrent submits both read empty and both mint — **two cards** — and the
paid path then writes a manual payment keyed `giftcard:${code}` for each distinct
random code, double-counting the cash. P0-3 null-guarded that query; this path
must never reach it (`paymentIntentId: null` → skipped).

**Rules.** `teams/{teamId}/gift_card_issues/{id}` gets **no rule block**, so it is
deny-all by default — verified: `firestore.rules` has no `match /{document=**}`
wildcard anywhere and the team block starts at `:357`. Same posture as
`connect_checkout_attempts`. No client ever reads it. Teardown: it is a
subcollection of `teams/{teamId}`, which
`packages/shared/src/tenantData.ts:74` (`TENANT_TEAM_DOC_COLLECTION`) removes
wholesale via recursive delete — `TENANT_DATA_COLLECTIONS` lists **top-level**
collections only (`:81-89`), so no registration is needed and the completeness
test is unaffected.

**Inputs — BLOCKER 4. State the unit boundary once, and suffix every variable.**
```ts
{
  teamId: string
  amountMajor: number            // MAJOR units (100 = CHF 100). The ONLY amount input.
  issueKind: 'paid' | 'comp'
  paymentMode?: string           // paid only — free text, e.g. 'Cash' | 'TWINT'
  occurredAtMs?: number          // paid only — default Date.now()
  issueReason?: string           // REQUIRED when issueKind === 'comp', ≤200 chars
  purchaserContactId?: string    // validated against teamId + deleted_at, exactly like recordManualPayment.ts:173-185
  recipientEmail?, recipientName?, giftMessage?, fromName?   // P1-H
  sendEmail?: boolean            // default true when a recipient address is known
  idempotencyKey: string         // REQUIRED — a UUID minted when the dialog opens
  locale?: string
}
// NO `currency` input — see P1-B.
```
| Rail | Unit | Helper |
|---|---|---|
| `GiftCard.amount` / `.balance` | **MAJOR** (`types/giftCard.ts:34-37`) | `mintGiftCard({ amount: amountMajor })` (`giftCards.ts:88`) |
| `writeManualPaymentEvent.amount` | **MINOR** (`recordManualPayment.ts:31`, validated `:61-64`) | `toMinorUnits(amountMajor)` (`money.ts:22`) |
| Floor validation | — | `requireChargeableAmountFromMajor(amountMajor)` — **call it, discard its return.** It returns MINOR (`checkout.ts:41-48`) and is used here purely to throw `below_minimum` on an authored sub-floor value. |

Also enforce an **upper bound** (`amountMajor <= 10_000`) so a fat-fingered comp
cannot mint arbitrary stored value. Not present on any existing path; state it.

**Gates deliberately NOT reused** — comment each at the call site:
- **Not `loadEnabledTeam`** (`access.ts:50-64`): it throws when
  `payments.connectEnabled === false`. That is a *Connect* kill-switch; a studio
  taking cash may have no Connect account at all. Read the team doc directly.
- **Not `requireChargeableAccount`** (`access.ts:67-80`): same reason.
- **Not `settings.giftCards.enabled`**: that flag gates the public shop tab
  (`sync/syncTeamPublicProfile.ts:213-221`); a studio may hand out cards without
  selling them online.
- **Not `settings.giftCards.amounts`** (`giftCards.ts:305`): the front desk takes
  CHF 73. A deliberate divergence from the public path.

**`mintGiftCard` widening (`giftCards.ts:86-130`)**
```ts
mintGiftCard({
  teamId, amount /* MAJOR */, currency,
  purchaserContactId?, purchaserEmail?,
  paymentIntentId: string | null,      // was required
  issueRef?: string,                   // NEW — stamped, never queried
  issueKind: 'purchase' | 'admin_paid' | 'admin_comp',
  issuedBy?: string, issuedByName?: string, issueReason?: string,
  recipientEmail?, recipientName?, giftMessage?, fromName?,
})
```
The dedupe at `:99` runs **only** when `paymentIntentId` is a non-empty string
(P0-3). The 3-attempt collision loop (`:104-127`) is reused verbatim.

**Paid path → `recordManualPayment` linkage**
```
3. card = await mintGiftCard({ ..., issueRef, issueKind: 'admin_paid' })
4. await writeManualPaymentEvent({                        // recordManualPayment.ts:55
     teamId,
     contactId: purchaserContactId ?? null,
     amount: toMinorUnits(amountMajor),                   // MINOR
     currency: giftCardCurrency(team.default_currency),
     occurredAtMs: occurredAtMs ?? Date.now(),
     paymentMode,
     lineItem: { kind: 'gift_card', label: `Gift card ${card.code}` },   // P1-A
     idempotencyKey: `giftcard:${card.code}`,             // → payment_events/manual:giftcard:GC-XXXX-XXXX
     recordedBy: request.auth.uid,
   })
5. await cardRef.update({ payment_event_id: `manual:giftcard:${card.code}` })
```
`writeManualPaymentEvent` is exported precisely for this (`recordManualPayment.ts:46-54`).
Step 4's doc id derives from the code (`:74-75`) and `create()` + swallow
ALREADY_EXISTS (`:101-105`) makes a retry a no-op.

**Honest recovery statement (do not write "self-heals").** `writeManualPaymentEvent`
returns `{ duplicate: true }` at `:103-105` **before** the best-effort journal
write at `:112-128`. So "event doc created, journal write failed" is *not* healed
by re-running the callable. It is caught by `reconciliationCheck` (which **does**
count `payment_events` — `monthlyReports.ts:83-107`) and repaired by
`scripts/backfill-finance-journal.ts`.

**Journal effect (paid).** `buildExternalPaymentTxn` (`recordManualPayment.ts:113-125`
→ `types/finance.ts:580-619`): `source: 'manual'`, `type: 'charge'`,
`gross = net = amountMinor`, both fees 0, `category: mapCategory('gift_card')` =
`'gift_card'` (P1-A).

**Comp path writes NOTHING to `finance_transactions`, and that is correct.**
`docs/accounting.md:105` — *"Cash-basis only — entries mirror money events; no
deferred revenue or accruals."* A comp is not a money event: no cash entered, no
gateway balance changed, no receivable was created (a receivable is accrual
machinery this ledger deliberately lacks). Booking it as revenue would invent
income that never arrived; as an expense, a payment that never left. Either breaks
the one guarantee the journal makes — **summed `net` equals what actually moved.**

**Comp + reclass interaction — decided.** A comped card that is later redeemed
would, under the pair, drive `by_category.gift_card` **negative** by the comped
amount (nothing was ever booked positive for it) and credit the target category
with value nobody paid. **Decision: suppress the pair when
`issue_kind === 'admin_comp'`** (P1-C step 2). Every revenue category then contains
only money actually received, which is the cash-basis promise. Cost: a comped free
course shows zero revenue — which is exactly right.

**Audit fields stamped on the card** (the card *is* the audit record; managers
already read it via `firestore.rules:609-612`, so no extra collection):
```
issue_kind, issued_by, issued_by_name?, issue_reason (required for comp, ≤200),
issued_at, issue_ref, payment_intent_id: null, payment_event_id
```
**The UI must render them** (P1-I) — an invisible audit field is not an audit trail.

**Vocabulary — the one mapping table** (three vocabularies existed with no stated
mapping):

| Callable input | Stored `issue_kind` | i18n key | Badge | Journal |
|---|---|---|---|---|
| — (webhook) | `'purchase'` | `giftCardOrigin_purchase` | "Sold" | the Connect charge row |
| `'paid'` | `'admin_paid'` | `giftCardOrigin_admin_paid` | "Cash" | manual charge row, category `gift_card` |
| `'comp'` | `'admin_comp'` | `giftCardOrigin_admin_comp` | "Comp" | **none** |

Absent `issue_kind` on a legacy card reads as `'purchase'`.

**Verify.** Emulator: (1) two concurrent `issueGiftCard` calls with the same
`idempotencyKey` → exactly **one** card, both callers get the same code;
(2) paid mint of 100 → card `amount: 100` (major) **and**
`payment_events/manual:giftcard:GC-…` with `amount: 10000` (minor) **and** one
`finance_transactions` row with `gross: 10000, category: 'gift_card'` — this is
the direct regression test for BLOCKER 4; (3) comp mint → card exists, **zero**
new `finance_transactions` rows, `issue_reason` present; (4) comp mint without a
reason → `invalid-argument`; (5) `amountMajor: 0.40` → `below_minimum`;
(6) redeem the comped card → **no** reclass pair.

---

### P1-H · Delivery: recipient ≠ purchaser, and real email templates

**Files + symbols**
- **New** `packages/functions/src/connect/giftCardEmails.ts`
- `packages/functions/src/connect/webhook.ts:1270-1290` — replace the inline HTML
- `packages/functions/src/connect/giftCards.ts` — new `resendGiftCardEmail` callable
- `packages/functions/src/index.ts:191` — export it (beside `resendPolicyFeeLink`
  at `:195`, whose shape it mirrors)

**New optional inputs** on `createGiftCardCheckout` **and** `issueGiftCard`,
carried through Stripe metadata and stamped on the card doc:

| Field | Constraint |
|---|---|
| `recipient_email` | validated address; absent ⇒ deliver to the purchaser (today's behaviour) |
| `recipient_name` | ≤80 chars |
| `gift_message` | **≤300 chars plain text**, escaped with `utils/html.escapeHtml` at render. Stripe caps metadata values at 500 chars / 50 keys — 300 leaves headroom |
| `from_name` | ≤80; defaults to Stripe's `customer_details.name` |

**No scheduled delivery in v1.** `deliver_at` needs a scheduler *and* a "not yet
delivered but already redeemable" state on the card — the code is live the moment
it exists. Punt explicitly.

**Two emails when recipient ≠ purchaser.** (1) To the recipient — "You've received
a gift card": studio-branded, code, value, studio name, CTA to the shop, the
message if given. (2) To the purchaser — order confirmation. **The code goes in
both.** They paid for it and it is their only recovery path if the recipient
address was wrong. This is a deliberate call, not an oversight. When recipient ==
purchaser or absent: one email, today's shape.

**Templates.** The current body is inline HTML in the webhook (`:1274-1280`):
English-only, no locale, a literal `"the studio"` fallback (`:1273`), no
`detailsBox`, no team footer. Build:
```ts
buildGiftCardRecipientEmail({ teamName, code, amountMajor, currency, message, fromName, shopUrl, lang })
buildGiftCardPurchaserEmail({ teamName, code, amountMajor, currency, recipientEmail, lang })
```
using `wrapInLayout` / `detailsBox` / `factLines` / `ctaButton` /
`buildTeamFooter` from `@linyup/shared` (`packages/shared/src/emailLayout.ts:79,
52, 64, 72, 125`; the functions package re-exports them via the façade at
`packages/functions/src/utils/emailLayout.ts`). Localise with the
`Record<'en'|'de'|'fr'|'it', string>` idiom at `booking/templates.ts:5-19`.
**Email copy does NOT live in `apps/web/messages/*.json`** — say so in the ticket
or someone will add unused JSON keys.

**Sending.** `sendEmail({ to, subject, html, text, teamId, idempotencyKey })`
(`utils/email.ts:15-32`) — passing `teamId` sends **as the studio**. Keys:
`gift:{code}:recipient` / `gift:{code}:purchaser`. This is belt-and-braces given
the event ledger already blocks redelivery (`webhook.ts:1817-1827`) — the reason
to have it is that `issueGiftCard` has no event ledger. **`resendGiftCardEmail`
must pass a different key (or none)**, or the resend is silently suppressed.

`resendGiftCardEmail(teamId, code, email?)` — manager-only (`assertManager`),
reads the card, re-renders the same template, sends to `email ?? recipient_email
?? purchaser_email`. This is the only recovery for a mistyped address.

**Verify.** Emulator with `MESSAGING_POLICY=allowlist`: buy with
`recipientEmail` set → two `mail_sends` rows, both carrying the code, correct
language from `metadata.locale`. Re-deliver the same Stripe event → no new sends.
Call `resendGiftCardEmail` → one new send. Assert `escapeHtml` on a message
containing `<script>`.

---

### P1-I · Admin UI — issue dialog, origin badge, outstanding strip

**Files + symbols**
- `apps/web/src/components/payments/GiftCardsSection.tsx` — badge row at
  `:206-223`, list rows at `:196-205`
- `apps/web/src/hooks/useGiftCards.ts` — add the aggregation hook (`:17-32` is the
  50-doc list)
- `apps/web/src/app/[locale]/(auth)/payments/page.tsx:310`, `:468-470` — the tab
  already exists; **land the `page.tsx` edit once** (Phase 3 adds a `promos` tab
  to the same `TabsList` — cross-cutting D-3)
- `firestore.index.json`

**Change**
1. **Origin badge** next to the existing status badge (`:207-217`), from
   `issue_kind` (absent ⇒ `purchase`). Comp rows additionally show
   `giftCardIssuedByLine` with `issued_by_name` and `issue_reason`.
2. **"Issue gift card"** button + dialog: amount, paid/comp radio, payment mode
   (paid), reason (comp — required), optional purchaser contact picker
   (`components/payments/ContactPicker.tsx` already exists), optional recipient
   fields. The dialog mints a UUID on open and passes it as `idempotencyKey`.
3. **Outstanding strip** above the list:
   > **Outstanding CHF 1'240** · 17 active cards · CHF 3'050 issued all-time · CHF 210 comped
   ```ts
   getAggregateFromServer(
     query(collection(db, TEAMS_COLLECTION, teamId, GIFT_CARDS_SUBCOLLECTION),
           where('status', '==', 'active'),
           where('currency', '==', teamCurrency)),
     { outstanding: sum('balance'), n: count() }
   )
   ```
   - **The currency filter is required** — `sum('balance')` across mixed
     currencies is a meaningless number.
   - **Label it honestly**: this is the *committed* balance; live holds are not
     deducted. `giftCardAvailable` (`types/giftCard.ts:58-67`) is a pure function
     over a map field (`:41`) and **cannot** be applied by a server aggregation.
   - The `limit(50)` caveat (`useGiftCards.ts:26`) applies to the **list**, not
     the aggregation — the aggregation is what fixes it.
   - **The codebase uses no aggregation queries today** (verified: zero
     `getAggregateFromServer` / `sum(` hits; only `.count()` in
     `utils/contactCap.ts`). This is a new client pattern.
   - **Add the composite index to `firestore.index.json` in the same commit and
     verify against a real project, never the emulator** — per the known trap, the
     emulator hides missing-index errors that break production.
4. **"Add as contact"** action on rows whose `purchaserEmail` is set and
   `purchaserContactId` is null, cap-aware (disabled with an upgrade hint when the
   Free cap is reached).

**Do NOT put the outstanding figure in the finance plugin's report.** It is not a
journal fact. If it must appear there, it goes as a clearly-labelled panel —
*"Memo: gift-card liability (not in the ledger)"* — reading the same aggregation,
never a `finance_transactions` row.

**Cross-check worth building later** (record it, don't build it now): under the
reclass pair, cumulative `by_category.gift_card` should equal
`outstanding + voided + breakage`. A divergence is the only drift alarm for a
missed reclass, since `reconciliationCheck` cannot see adjustment rows.

**Verify.** Seed 60 cards (past the list cap) and assert the strip's total matches
a manual sum. Toggle a card to `void` → the total drops. Deploy the index to
staging and re-run.

---

### P1-J · i18n — all four locales, in lockstep

**Files.** `apps/web/messages/{en,de,fr,it}.json`. Verified baseline: each file
carries **29** `giftCard*` keys today (16 in `PaymentsDashboard` at
`en.json:3063-3078`, 13 in `Shop` at `:3155-3168`). Keep the counts equal.

**`Shop` — guest purchase + delivery form**
```
giftCardBuyerEmailLabel      "Your email"
giftCardBuyerEmailHelp       "We'll send your receipt here."
giftCardGuestNote            "No account needed."
giftCardRecipientToggle      "This card is a gift for someone else"
giftCardRecipientEmailLabel  "Recipient's email"
giftCardRecipientNameLabel   "Recipient's name"
giftCardFromNameLabel        "From"
giftCardMessageLabel         "Message (optional)"
giftCardMessagePlaceholder   "Happy birthday!"
giftCardMessageTooLong       "Message is too long (max 300 characters)."
giftCardDeliveryNote         "The code is emailed as soon as the payment goes through."
giftCardCurrencyMismatch     "This gift card is in a different currency."      ← P1-B
```

**`PublicBooking` — price breakdown** (P0-4)
```
priceAfterDiscounts          "Subtotal"
priceGiftCardRemaining       "Gift card remaining"
```

**`PaymentsDashboard` — mint, audit, liability, resend**
```
giftCardIssue                "Issue gift card"
giftCardIssueTitle           "Issue a gift card"
giftCardIssueKindLabel       "How was this paid?"
giftCardIssueKindPaid        "Paid (cash / bank / TWINT)"
giftCardIssueKindComp        "Complimentary (no payment)"
giftCardIssueKindPaidHelp    "Records a manual payment in your books."
giftCardIssueKindCompHelp    "No entry in your books. Logged on the card for audit."
giftCardIssueAmountLabel     "Value"
giftCardIssueModeLabel       "Payment method"
giftCardIssueReasonLabel     "Reason"
giftCardIssueReasonRequired  "A reason is required for a complimentary card."
giftCardIssueSuccess         "Gift card {code} issued."
giftCardIssueError           "Couldn't issue the gift card. Please try again."
giftCardOrigin_purchase      "Sold"
giftCardOrigin_admin_paid    "Cash"
giftCardOrigin_admin_comp    "Comp"
giftCardIssuedByLine         "Issued by {name} · {reason}"
giftCardRecipientLine        "For {name} · {email}"
giftCardResend               "Resend"
giftCardResendTitle          "Resend this gift card?"
giftCardResendEmailLabel     "Send to"
giftCardResendSuccess        "Gift card email sent."
giftCardOutstandingLabel     "Outstanding"
giftCardOutstandingLine      "{amount} across {count} active cards"
giftCardIssuedTotalLine      "{amount} issued all-time"
giftCardAddAsContact         "Add as contact"
giftCardRefundFullCoverNote  "This purchase was paid entirely with a gift card and can't be refunded here — void or adjust the card instead."
giftCardRefundPartlyRedeemed "This card has already been partly redeemed, so the purchase can't be refunded."
financeCategory_gift_card    "Gift cards"
```
`financeCategory_gift_card` has **no consumer today** (verified: zero
`by_category` consumers in the web app outside tests) — add it anyway so the
category is nameable the moment a finance UI renders it.

**Email copy is NOT here.** It lives in `connect/giftCardEmails.ts` (P1-H).

**Verify.** A script or manual check that all four files have identical key sets
under `Shop`, `PublicBooking` and `PaymentsDashboard`; `pnpm build` for the web
app (next-intl fails loudly on a missing key at runtime, not build time — so the
key-set diff is the real gate).

---

### P1-K · Migration — chart-of-accounts mapping (MANDATORY)

**Files + symbols**
- **New** `scripts/migrate-gift-card-accounting.ts`
- `packages/functions/src/accounting/seed.ts:137-145` — `ensureAccountingSeeded`

**Verified problem.** For a team that already has `accounting_settings`:
`loadAccountingSettings` is a plain read (`seed.ts:53-56`);
`ensureAccountingSeeded` re-runs `seedAccounts` + `seedEntryTemplates` and returns
`existing` **without ever touching `mapping`** (`:139-144` vs the first-seed path
at `:150-161`); `seedAccounts` is create-only (`:59-89`); and `setChartTemplate`
hard-refuses once entries exist (`accounting/settings.ts:32-38`). So an existing
finance-plugin team would get account 3404 and **no
`revenue_by_category.gift_card` key**, posting gift-card revenue to "Other
revenue" **forever** via `?? m.revenue_by_category.other`
(`accounting/posting.ts:120`) — no crash, silent degradation, no in-product repair
path.

**Change (both)**
1. **Structural fix**: `ensureAccountingSeeded`'s existing-settings branch fills
   **missing** `mapping` keys from `CHART_TEMPLATES[existing.chart_template].mapping`
   — additive only, never overwriting a key that is present (a studio may have
   remapped). Future category additions then self-heal on any rebuild.
2. **One-off script** for teams that will not re-run the ensure: for every team
   with an `accounting_settings` doc —
   `seedAccounts(teamId, settings.chart_template, undefined)` →
   `update({ 'mapping.revenue_by_category.gift_card': <template default> })`
   when absent → `rebuildAccountingLedger`.

**Verify.** Emulator: seed a team with the finance plugin **before** P1-A, then run
the migration and assert `accounting_settings.mapping.revenue_by_category.gift_card`
exists and that a gift-card journal row posts to 3404, not 3409. Assert a
hand-remapped key is left alone.

---

### P1-L · Migration — historical `'other'` rows (decide, don't leave implicit)

**Verified.** Changing `mapCategory` does **not** rewrite existing rows, and
`scripts/backfill-finance-journal.ts` will not either — it only `create()`s
(`:142`) and swallows ALREADY_EXISTS (`:146`). `category` is **not** in the
journal's immutable-field list (`types/finance.ts:33-40` names
type/gross/fees/net/currency/occurred_at), so a category-only rewrite is permitted
by the stated contract.

**Decision: run it**, in the same migration as P1-K, given pre-launch data volume.
For each team: find `finance_transactions` rows whose
`member_payments/{source_ref}` doc has `kind === 'gift_card'`,
`update({ category: 'gift_card' })` → `onFinanceTransactionWrite`
(`accounting/onFinanceTransactionWrite.ts:44-105`) re-posts via `upsertAutoEntry`
→ then re-run `generateMonthlyFinanceReport(teamId, month)`
(`finance/monthlyReports.ts:114`) for each affected month.

**If the volume is ever non-trivial**, the alternative is a documented cutover
month. Either way it is written down, not implicit.

**Card back-compat.** Every new `GiftCard` field is optional. Absent `issue_kind`
⇒ `'purchase'`; absent `recipient_email` ⇒ deliver to the purchaser (today's
behaviour). `payment_intent_id` already types `string | null`
(`types/giftCard.ts:44`), so null-PI admin cards need no type change — but the
dedupe query **must** be guarded (P0-3), and `GC-DEMO-CARD`
(`scripts/seed-emulator.ts:1820-1833`) is the exact doc that would otherwise be
returned. Cards minted before the delivery fields existed stay resendable via
`purchaser_email`.

**Verify.** Emulator with `pnpm emulators:seed`, then the migration; assert
`GC-DEMO-CARD` still reads correctly, that a legacy row's category flipped, and
that its accounting entry moved from 3409 to 3404.

---

### P1-M · Documentation

- **New `docs/gift-cards.md`**: the model (code = stored value, tender not price),
  the Stage A/B placement, the three `issue_kind`s, the reclass pair and its cash
  turnover artefact, the refund policy including the non-refundable full-cover
  case, and the outstanding-liability figure's exact meaning.
- **`CLAUDE.md` → "Key patterns"**: a one-paragraph gift-card entry alongside the
  appointments one.
- **`docs/fareharbor-analysis.md` §7.3**: mark bugs #1, #3, #4, #5 fixed with
  their commits; add N1/N2 from §0.3 of this document (N2 → Phase 2).
- **`docs/accounting.md` limitations**: add the cash-account turnover artefact
  from the reclass pair.

---

## 4. Atomic commit groups (must not be split)

| Group | Contents | Why splitting breaks |
|---|---|---|
| **A** | `FinanceCategory` + `mapCategory` + `FINANCE_CATEGORIES` + `PaymentLineItemKind` + `LINE_ITEM_KINDS` + `lineItemFromMetadata` + all three chart templates, with `chartTemplates.test.ts` green | `AccountingMapping.revenue_by_category` is `Record<FinanceCategory, string>` (`types/accounting.ts:68`) — the enum without the templates does not compile; the templates without the enum are dead accounts; the category without the line-item kind lands every manual row in `'other'` |
| **B** | `commitGiftCardDrawdown` + `buildGiftCardReclassTxns` + `recordGiftCardReclass` + all four call sites + `committed_holds` | A wrapper with no pair does nothing; a pair helper with no wrapper leaves four sites free to commit without reclassifying, and nothing detects the omission |
| **C** | `gift_card_issues` claim doc + widened `mintGiftCard` + `issueGiftCard` + the `writeManualPaymentEvent` linkage | The claim doc alone is dead data; the mint alone **is** BLOCKER 1 |
| **D** | The currency guard in `reserveGiftCardDrawdown` + `giftCardCurrency` + every `'CHF'` literal it replaces | Replacing the literals without the guard is the only ordering that can create an unredeemable card |

Inherited from `docs/fareharbor-analysis.md:446-456` and still binding for later
phases: transactional `bookSession` + `bookingHoldsSeat` in `trackBookings` +
retiring the blind `FieldValue.increment()` sites (Phase 2); promo's resolver
signature + `product` arm + the fixture gate (Phase 3).

---

## 5. Ordered work list

| # | Item | Group | Blocks |
|---|---|---|---|
| 1 | **P0-1** `checkoutRateLimit(ipRaw, prefix?, limitPerHour?)` | — | P1-E; Phase 3 preview bucket |
| 2 | **P0-2** `bookingHoldsSeat` + `isExpiredWaitlistClaim` + stale-full re-count | — | Phase 2 |
| 3 | **P0-3** `applyGiftCardCommit`; `commitGiftCardHold` returns the movement; null-guard the dedupe | — | P1-C |
| 4 | **P0-4** `BookingForm` calls `planGiftCardRedemption` | — | Phase 3 promo line |
| 5 | **P1-A** the `gift_card` category, end to end | **A** | P1-D, P1-G, P1-K |
| 6 | **P1-B** one currency source + the reserve guard | **D** | P1-C, P1-G |
| 7 | **P1-C** `commitGiftCardDrawdown` — the single commit path | **B** | P1-F; Phases 2 & 3 riders |
| 8 | **P1-D** `recordGiftCardReclass` — the atomic pair | **B** | — |
| 9 | **P1-E** guest gift-card purchase | — | — |
| 10 | **P1-F** `refundMemberPayment` gift handling + dispute void | — | — |
| 11 | **P1-G** `issueGiftCard` — the manager mint | **C** | P1-I |
| 12 | **P1-H** delivery split + email templates + resend | — | P1-I |
| 13 | **P1-I** admin UI: badge, dialog, outstanding strip, index | — | — |
| 14 | **P1-J** i18n, all four locales | — | — |
| 15 | **P1-K** chart-of-accounts mapping migration | — | — |
| 16 | **P1-L** historical `'other'` row rewrite | — | — |
| 17 | **P1-M** docs | — | — |

---

## 6. Explicitly out of scope

| Item | Reason |
|---|---|
| Deferred-revenue (liability) treatment of gift-card sales | Forbidden by `docs/accounting.md:105`. The accounting-correct answer; the locked cash-basis rule rules it out. |
| A dedicated non-cash reclass clearing account | A second compile-time break across three templates plus a second migration, for a cosmetic turnover artefact on a beta chart (`chartTemplates.ts:15-16`). Documented instead (P1-D). |
| Scheduled gift delivery (`deliver_at`) | Needs a scheduler and a "not yet delivered but already redeemable" card state. |
| `restoreGiftCardValue` manager callable (full-cover refunds) | Phase 2. The reversal-pair builder from P1-D is the piece it needs. |
| `createDropInCheckout` capacity check (§0.3 N2) | Phase 2's transactional capacity work; `bookingHoldsSeat` is the predicate it will use. |
| Widening `resolveStripeCurrency` (`types/currency.ts:53-55`) | Its own separately-reviewed change. P1-B's guard is the prerequisite. |
| `connect_checkout_attempts` retention (§0.3 N4) | Unbounded but harmless; not a Wave 3 concern. |
| Any gift-card arm in `resolvePaymentOptions` | Invariant 1 — a gift card is a tender, not a price. |
| Promo / waitlist / waiver behaviour | Phases 2–4. P1-C declares the rider parameters; nothing reads them in Phase 1. |

---

## 7. Hooks Phase 1 must leave for later phases

Required by the cross-cutting analysis; each is a parameter or a predicate, not a
feature:

1. **`commitGiftCardDrawdown` riders** — `promoRedemptionId` (Phase 3 commits the
   reservation in the same call) and `waitlistEntryId` (Phase 2 flips the entry to
   `claimed` inline, because the full-cover branch fires no webhook). Declared in
   P1-C, unused in Phase 1. Without them, Phase 2 and Phase 3 each rediscover the
   same four call sites.
2. **`isExpiredWaitlistClaim`** — landed inert in P0-2 so Phase 2 adds a field,
   not a family member.
3. **`checkoutRateLimit`'s `prefix` + `limitPerHour`** — Phase 3's promo-preview
   bucket is then a parameter, not a second function.
4. **`buildGiftCardReclassTxns` is the reversal builder too** — P1-F already uses
   it with flipped signs; Phase 2's `restoreGiftCardValue` reuses it unchanged.
5. **The client price breakdown's shape** (P0-4) already separates discounts from
   the tender, so Phase 3's promo line is one row inserted above `priceAfterDiscounts`,
   with `appliedBenefit` / `appliedPromo` staying mutually exclusive on the wire.
6. **`bookingHoldsSeat`** is the single seat predicate Phase 2's transactional
   `bookSession` reads — it must not be re-derived inside the transaction.

---

## 8. Whole-phase verification checklist

Run after the last item; every line is a gate.

- [ ] `pnpm typecheck` — the `Record<FinanceCategory, string>` tripwire is green.
- [ ] `pnpm test` — `accounting/chartTemplates.test.ts`, `connect/giftCardMath.test.ts`,
      `finance/journal.test.ts`, `finance/monthlyReport.test.ts`, and the new
      `booking/sessionHolds.test.ts` all pass.
- [ ] `pnpm lint` · `pnpm build`.
- [ ] All four `messages/*.json` have identical key sets in `Shop`,
      `PublicBooking`, `PaymentsDashboard`.
- [ ] **BLOCKER 1**: two concurrent `issueGiftCard` calls, one `idempotencyKey`,
      one card.
- [ ] **BLOCKER 2**: kill the process between the two reclass rows — the batch
      means neither exists; re-run and both appear exactly once.
- [ ] **BLOCKER 3**: an `EUR` card against a CHF charge → `failed-precondition`,
      no hold written.
- [ ] **BLOCKER 4**: a CHF 100 paid mint → card `amount: 100`, payment event
      `amount: 10000`, journal `gross: 10000`.
- [ ] Full-cover redemption of a **purchased** card writes exactly two adjustment
      rows summing to zero; of a **comped** card, none.
- [ ] `reconciliation_check.ok` is unchanged before and after a month containing
      reclass pairs.
- [ ] A full refund of a part-gift booking restores the balance and writes the
      reversal pair; a partial refund touches neither.
- [ ] A guest gift-card purchase creates **no** contact and clears **no**
      `provisional` flag.
- [ ] The stale-full class from §0.3 N1 is bookable without waiting for the sweep.
- [ ] The outstanding-strip composite index is deployed and verified **against a
      real project**, not the emulator.
