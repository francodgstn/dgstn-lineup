# Wave 3 — Phase 2 implementation spec: the WAITLIST

Corrected, implementable spec produced by reconciling the Wave 3 waitlist design
against its adversarial critique and the cross-cutting collisions analysis
(workflow `wf_fc749ebe-409`, result rows 0 / 7 / 8), then re-verifying **every**
load-bearing claim against this worktree at `62fc546`. Authoritative context:
`docs/fareharbor-analysis.md` §7; predecessor: `docs/wave3-phase01-spec.md`.

**Every line reference below was re-read in this tree after Phase 0 + Phase 1
landed.** The design spec's line numbers are pre-62fc546 and are stale almost
everywhere — do not carry them forward. Where the design and the critique
disagree, the critique wins except in the three places named in §0.3, where the
evidence is cited.

**Scope.** Classes only. An appointment session does not exist until it is
booked (CLAUDE.md, "Appointments (1:1) vs classes"), so "this session is full"
has no meaning there; the analogous feature is a waitlist on an *availability
window*, which is a different design (`docs/product-strategy.md` "Slot waiting
list"). Do not conflate.

**Phase 2 is where the capacity model gets fixed.** Roughly half the work items
below are not waitlist features at all — they are the seat-accounting repairs
that the waitlist makes load-bearing, and three of them are live oversell or
miscount bugs today. That is the whole reason `docs/fareharbor-analysis.md:436`
orders the waitlist second.

---

## 0. Corrections to the source material

### 0.1 The three BLOCKERS, resolved

| # | Blocker | Resolution | Work item |
|---|---|---|---|
| 1 | A gift-card full-cover claim loses BOTH the money and the seat | **Two independent fixes, both required.** (a) The entry flip happens in the SAME `WriteBatch` as the full-cover booking confirm (`dropIn.ts:376-394`), not in the webhook and **not** in `commitGiftCardDrawdown` — see §0.3(c). (b) The sweep's release step is a transaction that refuses to delete any booking that is not *still* a live unclaimed claim hold, so even a missed flip cannot destroy a paid seat. | **P2-M**, **P2-N** |
| 2 | `createDropInCheckout` has NO capacity check at all — a live oversell | Add the capacity gate, in the same transaction as the hold write, **and** a capacity re-check in `handleDropInCheckout` that refunds rather than confirming into a full class. Prerequisite, not a residual. | **P2-C**, **P2-D** |
| 3 | `claimWaitlistSeat` is not atomic — a double-click double-spends a credit or a usage unit | `claimWaitlistSeat` is ONE transaction: read entry + booking + grants/window → assert `offered` + token match + not lapsed → spend → flip entry to `claimed` → flip booking. The entry status IS the idempotency guard and it is inside the transaction. | **P2-K** |

### 0.2 The significant findings, resolved

| # | Finding | Resolution | Work item |
|---|---|---|---|
| 4 | §4.1's serialization argument is inverted | Adopted. `tx.get(sessionRef)` **plus a write to `sessionRef`** is the stated serialization point; the bookings query is the source of the *count*, never the lock. See §0.3(a) for the caveat. | **P2-B** |
| 5 | Writing an absolute `bookings_count` from a transaction introduces a lost-update class | Adopted **with** the settled remedy: every blind `FieldValue.increment()` on `bookings_count` is retired in the same commit (`docs/fareharbor-analysis.md:462-465`). The critique attacks the half-measure the settled plan already forbids. §0.4 N1 supplies the missing piece that makes the remedy implementable. | **ATOMIC GROUP A** |
| 6 | Stripe cannot honour a claim window shorter than ~30 min | Resolved by collapsing three timers into one (§2): `claim_expires_at` is the booking hold's `expires_at` AND the Stripe session's `expires_at`. `WAITLIST_MIN_WINDOW_MINUTES = 35` (uniform, free and paid), and `createDropInCheckout` refuses a claim with under 31 minutes left. | §2, **P2-J**, **P2-L** |
| 7 | `markNoShowBookings` turns an unclaimed hold into a no-show | Adopted and widened — it already does this to lapsed **drop-in** holds today (§0.4 N3). Skip any unsettled hold. | **P2-G** |
| 8 | `pending_bookings_count` is not maintained across the claim lifecycle | Adopted and widened — the paid drop-in path never maintained it either (§0.4 N2). The claim path increments exactly where `bookSession` does. | **P2-G**, **P2-J**, **P2-K** |
| 9 | The duplicate guard's pending exemption covers only the authenticated branch | Adopted. Align the guest branch (`booking/index.ts:817`) with the authenticated one (`:777-780`). | **P2-F** |
| 10 | `session.waitlist_enabled` has no writer and no backfill | **Rejected the field.** The flag lives only on `Activity.waitlistEnabled` and its public mirror, exactly like `trialEnabled`. No fan-out, no backfill, no drift. See §0.3(b). | **P2-H** |
| 11 | §11.1's rules block contradicts §10.1's own rule | Adopted. `allow write: if false` on both the nested and the collection-group match. | **P2-T** |
| 12 | `sessionBlockReason` returns `'full'` before `'closed'` | Adopted. Reorder so `'closed'` wins; a class that is both full and past the cutoff then disappears from the list, matching a closed-not-full class. | **P2-Q** |
| 13 | Sweep pass 3 is not expressible as a query | Adopted. Drive the backstop from the queue (`status == 'waiting' && session_start > now`), dedupe by session. | **P2-N** |
| 14 | Plan tiering "unverified" | Answered. `requirePlan(teamId, 'coach')` — `packages/functions/src/utils/plan.ts:10`. Per the settled gate posture it goes on **creation only**. | **P2-V** |
| 15 | `tenantData` caveat | Answered. Teardown uses `db.recursiveDelete` (`saas-billing/index.ts:756, 765, 786`) and the completeness test classifies only top-level `*_COLLECTION` constants, so `sessions/{id}/waitlist` needs no registration. Do **not** add a `WAITLIST_COLLECTION` constant to `tenantData.ts`. | — |
| 16 | `SessionForm` is not an i18n namespace | Confirmed. `apps/web/messages/en.json` has `Sessions` (`:787`), `PublicBooking` (`:3602`), `Manifest` (`:3855`), `SettingsBooking` (`:3875`), `SessionDetail` (`:4095`). No `SessionForm`. | **P2-P** |
| 17 | Waitlist-created contacts are immortal and uncapped | Partly adopted. Mitigations: a dedicated `checkoutRateLimit` bucket, a hard queue cap, and `provisional_expires_at` set on a waitlist-born contact. `canCreateContact` is deliberately **not** applied — see §7. | **P2-I** |
| 18 | Over-built relative to the decision | Adopted. Dropped: `offer_count`, `maxOffers`, re-queue-to-tail, `queue_key`, `requeued_at`, `waitlistMaxOffers`, and the admin `force: true` "book directly" mode. **One offer per entry, ever**; a lapsed offer is terminal (`expired`) and the person re-joins if they still want it. Ordering is always `joined_at ASC`. | §3 |
| 19 | Line drift | Confirmed and superseded — every ref in this document was re-read post-62fc546. | — |

### 0.3 Where a source is mistaken (evidence cited)

**(a) The critique's phantom-read claim is procedurally accepted but is probably
wrong about the Admin SDK — and the design must not depend on either reading.**

Critique #4 asserts that a booking doc created concurrently is "a phantom … so
two `bookSession` transactions for two *different* contacts do not reliably
conflict via the bookings query". Firestore's server client libraries document
**serializable** isolation for read-write transactions, which by definition
excludes phantoms; the Admin SDK already relies on query reads for exactly this
purpose at `booking/index.ts:940` (`tx.get(grantsQuery)` is the sole
concurrency control on the last credit in a pack). I cannot disprove the
critique from a file in this repo, so **the critique wins procedurally** — and
it costs nothing, because the fix is additive: read the session doc *and* the
bookings query, and write the session doc. That is correct under both readings.
Write it down as: *the session doc is the lock, the bookings query is the count.*

**(b) The design's `session.waitlist_enabled` should not exist, and the
critique's proposed fix (a fan-out trigger) is the more expensive of the two
answers.** Verified: `sync/syncActivityPublicProfile.ts:6` writes only the
activity's own mirror, and `sync/onActivityTypeChange.ts:19` is the **only**
activity→sessions fan-out in the repo (and it forwards `type` alone). But the
flag does not need to be on the session: the promoter already has to read
`teams/{teamId}` for `cutoffMinutes` (`booking/index.ts:678-682`), so one more
`activities/{id}` read on a path that runs only when a seat frees is free, and
the public form already loads activity public profiles — the mirror carries
`trialEnabled` and `dropIn` by exactly this pattern
(`syncActivityPublicProfile.ts`, the `trialEnabled` / `dropIn` spreads). Zero
fan-out, zero backfill, zero drift. A per-session override is explicitly out of
scope (§7).

**(c) Phase 1's `commitGiftCardDrawdown({ waitlistEntryId })` rider is the wrong
seam and must be removed, not implemented.** `docs/wave3-phase01-spec.md:1364-1368`
declared it as the hook for exactly this phase. It cannot work:

- `dropIn.ts:376` writes the **confirmed** booking, and `dropIn.ts:433` calls
  `commitGiftCardDrawdown` only afterwards — so the seat is already permanently
  granted before any rider could run.
- `giftCards.ts:428-430` returns early when `committedMajor <= 0` (card gone /
  nothing to commit) and `giftCards.ts:464` returns early for an `admin_comp`
  card — a comped full-cover claim is an ordinary case. A rider placed after
  either return never executes.

So the flip must be atomic with the booking write, which is what §0.1 blocker 1
specifies. **P2-M removes the `waitlistEntryId` parameter** and records why, so
the next reader does not re-add it. `promoRedemptionId` is untouched — Phase 3
commits its reservation *after* the money moves, which is the seam that rider
actually fits.

### 0.4 New findings — neither source caught these

**N1 — `trackBookings` does not recount on a `no_show` flip, which is why
retiring the increments is not a one-line change.** `STATUS_EVENT`
(`analytics/index.ts:45-50`) has no `no_show` key, so a pending→`no_show` write
reaches `:72`, gets `undefined`, and returns at `:73` — **before** the recount at
`:103-129`. That is precisely why `markNoShowBookings` hand-writes
`bookings_count: increment(-pendingDocs.length)` (`markNoShowBookings.ts:70-72`)
in a **batch**, which has no conflict detection at all. The cross-cutting
analysis's D-2 ("retire every increment; the transaction writes the absolute")
is unimplementable there until `no_show` triggers the recount. Fix: add
`no_show: 'booking_no_show'` to `STATUS_EVENT` plus a `descMap` entry
(`analytics/index.ts:140-145`, hardcoded English — no i18n obligation), then
delete the counter write from `markNoShowBookings` entirely.

**N2 — the paid drop-in path never maintains `pending_bookings_count`, while two
jobs decrement it.** `bookSession` increments (`:857` seed for a new contact,
`:1071` for an existing one); `cancelBooking` decrements (`:1359`);
`markNoShowBookings` decrements (`:64-66`); `cancelSession` decrements
(`sessions/index.ts:239`); the kiosk self-scan decrements
(`sessions/index.ts:890`); the admin bookings page decrements
(`apps/web/src/app/[locale]/(auth)/bookings/page.tsx:314, 343, 358`). Neither
`createDropInCheckout` (whole file re-read — no such write) nor
`handleDropInCheckout` (`webhook.ts:1389-1520` — the only
`pending_bookings_count` write in that file is the **appointment** path at
`:1757`) ever increments it. So every abandoned or no-showed paid drop-in drives
a real contact's counter negative **today**. Critique #8 framed this as a gap the
waitlist introduces; it is a live pre-existing drift on the money path.

**N3 — `markNoShowBookings` already corrupts lapsed drop-in holds, not just
waitlist claims.** Its filter is `fromBioLink == true`
(`markNoShowBookings.ts:35`) with status pending-or-absent (`:47-49`).
`createDropInCheckout`'s hold writes `fromBioLink: true` (`dropIn.ts:461`) and
`status: 'pending'` (`:469`). It runs at `dailyTasks/index.ts:41`, **before**
`expirePendingBookings` at `:49`. So an abandoned checkout on a class that ended
in the last seven days is stamped `no_show` on a real person's record and
decrements a counter that was never incremented (N2). The critique found the
waitlist half of this only.

**N4 — every drop-in already double-counts `bookings_count`, transiently.**
`createDropInCheckout` writes the hold at `dropIn.ts:452`, which fires
`trackBookings`; the recount counts the hold (`bookingHoldsSeat` →
`payment_status: 'required'` with a future `expires_at` holds a seat,
`session.ts:59-61`). The webhook then writes `bookings_count:
FieldValue.increment(1)` at `webhook.ts:1491` **on top of** that recount. Same
shape in `bookSession`: `bookingRef.set(bookingDoc)` (fires the recount) followed
by `sessionRef.set({ bookings_count: FieldValue.increment(1) })` (`:915`). The
result is a count one too high until the *next* booking write on that session
heals it — which, on a class that has just filled, makes it look full one seat
early and refuses a real customer. **This is a live bug and it is the concrete
justification for ATOMIC GROUP A**; D-2 is not hygiene.

**N5 — the kiosk self-scan decrements `bookings_count` for a person who is
standing in the room.** `sessions/index.ts:888-891` flips a pending booking to
`confirmed` and writes `bookings_count: FieldValue.increment(-1)` alongside
`conversions_count: increment(1)`. `bookingHoldsSeat` counts a `confirmed`
booking as holding a seat, so `trackBookings`' recount (which the same status
flip triggers) immediately contradicts it. The `-1` is a stale writer from the
pre-merge counter model; it survives only when it wins the race with the
recount, and then the class is one seat under. Retire it with the rest.

**N6 — a token lookup by collection group needs a `fieldOverrides` entry, and
the emulator hides its absence.** `firestore.index.json` carries explicit
collection-group single-field overrides for `bookings.booking_token`,
`participants.booking_token`, `invitations.token` and `team_invitations.token`
(16 `fieldOverrides` entries in total). The design's `entry_token` /
`offer.token` links are resolved by exactly that kind of query and would fail in
a real project with no override — the known trap (memory:
`firestore-index-query-gotcha`). Both waitlist tokens need one.

**N7 — the promotion trigger is loop-safe only because of the edge predicate,
and only if the no-op path writes nothing.** The promotion transaction writes the
session doc, which re-fires the trigger; the edge test
`freeSeats(before) <= 0 && freeSeats(after) > 0` is false on that second pass, so
it terminates. The corollary is binding: **the promoter must not write the
session document on any path where it decides not to promote.** A "harmless"
touch would still re-enter the handler.

**N8 — one promotion must offer every free seat it finds, not one.** With a
one-offer-per-firing promoter, freeing two seats at once (a capacity raise from
10 to 15, or a batch cancellation) fires the edge exactly once and leaves the
remaining seats unoffered until the hourly backstop. The transaction offers
`min(freeSeats, waitingCount, WAITLIST_MAX_OFFERS_PER_RUN)`.

**N9 — `createDropInCheckout`'s bare `.set()` destroys the answers captured at
join.** Both `dropIn.ts:376` and `dropIn.ts:452` are `.set()` with no merge
option; they replace the booking document wholesale. The cross-cutting analysis
spotted the `waitlist_claim` half of this; `question_answers` is the same hazard
and it matters because the design deliberately collects the activity's
`bookingQuestions` at **join** so the claim never re-asks. The claim path must
re-send them (P2-L).

**N10 — the class public mirror does not carry `status`, and must not start.**
`syncSessionPublicProfile.ts:67-88` (class branch) mirrors `max_participants` and
`bookings_count` but no `status`; only the appointment branch mirrors it (`:58`).
The public form therefore derives "full" arithmetically
(`BookingForm.tsx:217-218`), which is already consistent with the seat predicate.
Add `waitlist_count` to the class branch and nothing else.

---

## 1. Binding invariants (every work item is checked against these)

1. **Stage A / Stage B.** A price modifier lives inside `resolvePaymentOptions`;
   a tender is applied at the checkout callable. Nothing may be both. Phase 2
   adds **no** arm to the resolver and **no** new pricing path: the claim prices
   through `loadContactPaymentSnapshot` (`booking/access.ts:263`) →
   `resolvePaymentOptions` with the same `DropInTarget`
   (`paymentOptions.ts:73-85`) `createDropInCheckout` already builds
   (`dropIn.ts:194-201`).
2. **Two floors.** Authored prices below `MIN_CHARGE_MAJOR` throw
   (`connect/checkout.ts:41-48`); derived prices clamp
   (`shared/src/utils/money.ts:5-10`). `planGiftCardRedemption` shrinks the
   **drawdown**, never the residual. Phase 2 derives no new price.
3. **Finance invariant + cash basis.** A free claim writes **no** journal row —
   no money moved. A paid claim is one ordinary `drop_in` charge through the
   existing pipeline. `packages/functions/src/finance/journal.ts` remains the
   only writer of `finance_transactions`. No new `FinanceCategory`.
4. **Public routes read only `public_profile` mirrors.** The queue is never
   public. The only new public field is `waitlist_count` on the session mirror
   and `waitlistEnabled` on the activity mirror. Aggregates only, never
   identities.
5. **Bookings are keyed by `contactId`** — `sessions/{id}/bookings/{contactId}`.
   Waitlist entries mirror that: `sessions/{id}/waitlist/{contactId}`.
6. **Every hold is lazily expired**; sweeps are bookkeeping, never correctness.
   `bookingHoldsSeat` / `isExpiredWaitlistClaim` (`shared/src/types/session.ts:30-66`)
   are THE predicates. Nothing may re-derive them.
7. **One seat writer.** After ATOMIC GROUP A, `bookings_count` is written either
   as an absolute value from inside a transaction that read the bookings
   subcollection, or by `trackBookings`' recount. No `FieldValue.increment()` on
   `bookings_count` survives anywhere.
8. **Gates control creation only** (`docs/fareharbor-analysis.md:341`). An
   outstanding offer completes its lifecycle through a plan downgrade.
9. **i18n.** Every user-visible string is a key present in all four of
   `en/de/fr/it.json`, same namespace. Email and SMS copy lives in
   `packages/functions/src/booking/templates.ts` as `Record<Lang, string>` maps
   (functions cannot read `messages/*.json`).
10. **Imports.** `Link` / `useRouter` / `usePathname` from `@/i18n/navigation`.

---

## 2. The three timers, collapsed into one

This is the crux of the phase; get it wrong and blocker 1, critique #6, and
cross-cutting D-1/D-3 all come back.

Verified timers today:

| | What | Anchor | Enforced at |
|---|---|---|---|
| T1 | booking cutoff | `session.start` | `shared/src/types/session.ts:72-79`; `booking/index.ts:683-685`, `dropIn.ts:146-148` |
| T2 | claim window | offer time | new |
| T3 | drop-in payment hold, 30 min | checkout time | `dropIn.ts:50, 353, 471` |
| T3b | Stripe session expiry | checkout time | `SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES = 31` (`connect/checkout.ts:98`), now passed **unconditionally** on every drop-in (`dropIn.ts:534-535` — Phase 1 fixed the gift-card-only conditional the cross-cutting analysis flagged) |

**The rule.** A claim has exactly ONE deadline. `claim_expires_at` is written on
the booking, mirrored to the entry as `offer_expires_at`, and reused verbatim as
the Stripe session's `expires_at`. T3's `HOLD_MINUTES` does not apply to a claim
at all.

```
cutoffAt          = session.start − cutoffMinutes          (absent cutoff ⇒ session.start)
claimStart        = isWithinSmsSendingHours(now) ? now : nextSmsWindowOpen(now)
claim_expires_at  = min(claimStart + waitlistClaimMinutes, cutoffAt, session.start)

OFFER only if     claim_expires_at − now  >=  WAITLIST_MIN_WINDOW_MINUTES   (35)
CHECKOUT only if  claim_expires_at − now  >=  SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES (31)

booking.expires_at (once in checkout) = claim_expires_at
stripe  expires_at                    = claim_expires_at
```

Why each number:

- **35, uniform for free and paid.** The settled decision is one window for both.
  Stripe's Checkout Session minimum is 30 minutes from creation, and 31 is this
  codebase's already-chosen safe floor (`connect/checkout.ts:92-98`). 35 leaves a
  usable margin so that a claimant who opens the mail promptly can still reach
  checkout. Below 35 the seat is simply not offered — it shows as free on the day
  sheet and the kiosk walk-in door (`bookSession` with `source: 'kiosk'`,
  `apps/web/.../kiosk/WalkIn.tsx:127-139`) can take it, which is the right
  outcome for a seat that frees ten minutes before class.
- **31 at checkout**, because a claimant may reach the pay button at minute 119
  of a 120-minute window. Refuse with `failed-precondition` and
  `details: { reason: 'claim_window_too_short' }` so the page says "this offer is
  about to expire" instead of a generic failure.
- **`claimStart` anchoring.** `sendBookingReminders` handles quiet hours by
  *deferring* (`sendBookingReminders.ts:268` — `if (!smsWindowOpen) continue`).
  Deferring a claim offer is not deferral, it is expiry. So the offer is minted
  and the **email sent immediately at any hour**, and only the window's *start*
  is anchored to the next SMS-sending instant. A seat freed at 23:10 for a class
  the next evening: mail now, window 08:00–10:00. For a 07:00 class the next
  morning, `cutoffAt` clamps it below 35 minutes and no offer is made.

**No deferred SMS in v1.** The SMS is sent only if the offer is minted inside
`isWithinSmsSendingHours` (`sendBookingReminders.ts:61-66`). A deferred-SMS pass
would be a fourth sweep pass carrying its own idempotency marker; the email is
always sent and the anchored window already protects the recipient.

**What this kills.**
- Critique #6: the Stripe session can never outlive the hold, and can never be
  created shorter than Stripe's floor.
- Cross-cutting D1: no late-payment window past the cutoff — `claim_expires_at`
  is clamped by `cutoffAt`, and it is the Stripe expiry.
- Cross-cutting D3: the booking's `expires_at` and `claim_expires_at` are the
  same instant, so `expirePendingBookings` and `sweepWaitlistOffers` can never
  disagree about *when*. The delete is idempotent; the entry transition has one
  owner (`sweepWaitlistOffers`) and is re-derived from the booking's state, so it
  is correct whichever job ran first. **No exclusion is needed in
  `expirePendingBookings`** — do not add one.

---

## 3. Data model

### 3.1 `sessions/{sessionId}/waitlist/{contactId}`

Doc id **is** the contactId, exactly mirroring `sessions/{id}/bookings/{contactId}`:
dedupe is free, the rules mirror the bookings block verbatim
(`firestore.rules:1013-1020`) including the `isSelfContact(bookingId)` self-read at
`:1019`, and the promotion transaction gets the queue for one session in a single
read set.

Add `WAITLIST_SUBCOLLECTION = 'waitlist'` to `packages/shared/src/paths.ts` next
to `PARTICIPANTS_SUBCOLLECTION` (`:111`).

```
WaitlistEntry {
  id                 // = contactId
  teamId             // required — collection-group rules + queries
  session            // sessionId, denormalised
  contact            // contactId, denormalised
  session_start      // Timestamp — the only way the sweep finds entries on
                     //   sessions that already ran, without a join
  firstname, lastname, email, phone    // denormalised: the notification needs no
                                       //   contact read, and the admin list and
                                       //   day sheet render from the entry
  joined_at          // serverTimestamp — THE ordering key, immutable
  status             // 'waiting' | 'offered' | 'claimed' | 'expired' | 'left'
  entry_token        // long-lived: "check my place" / "leave the waitlist"
  offer_token?       // minted per offer, SINGLE USE, dies with the offer
  offered_at?        // Timestamp
  offer_expires_at?  // Timestamp — the SAME instant as booking.claim_expires_at
  source             // BookingSource — parseBookingSource (types/session.ts:236)
  question_answers?  // captured at JOIN, narrowed with sanitizeBookingAnswers
  left_at?, expired_at?, claimed_at?
}
```

**No stored position.** Position is derived at read time from `joined_at ASC`.

**No `offer_count`, no re-queue, no `queue_key`.** One offer per entry, ever; a
lapsed offer sets `status: 'expired'` (terminal) and the person may re-join,
which writes a fresh `joined_at` and puts them at the tail for free. This is the
critique's #18 simplification and it deletes an entire settings field, an entire
ordering field and the whole re-queue ordering problem.

**Two tokens, deliberately.** A leaked join-confirmation email must not be a
claim credential. Both from `generateSecureToken()`
(`packages/functions/src/utils/crypto.ts:19-21`), the generator `booking_token`
already uses (`booking/index.ts:867`). `offer_token` is deleted when the offer
resolves in any direction.

### 3.2 The claim hold — a booking doc, not a new object

`sessions/{sessionId}/bookings/{contactId}` with `status: 'pending'`,
`waitlist_claim: true`, `claim_expires_at`, plus the same denormalised identity
fields a booking always carries. Rationale, all verified:

- `bookingHoldsSeat` already understands it (`shared/src/types/session.ts:62`,
  landed inert in Phase 0) — the recount and the capacity gate agree with zero
  new code.
- `bookSession`'s duplicate guard already exempts a `pending` booking for the
  same contact on the authenticated branch (`booking/index.ts:777-780`); P2-F
  aligns the guest branch.
- `createDropInCheckout`'s already-registered guard only blocks on `confirmed`
  or a `participants` doc (`dropIn.ts:347`), so the claimant's own hold passes.

`status: 'pending'` is written **explicitly** — an absent status is treated as
pending by both `bookingHoldsSeat` (`session.ts:47`) and `markNoShowBookings`
(`:47-49`), and being explicit is what lets P2-G's filter be written in terms of
the hold fields rather than status trivia.

### 3.3 Session and activity fields

- `Activity.waitlistEnabled?: boolean` (`packages/shared/src/types/activity.ts`,
  next to `trialEnabled` at `:172`), mirrored to
  `activities/{id}/public_profile/{id}` by `syncActivityPublicProfile` under the
  same conditional-spread pattern as `trialEnabled`. **Class-only**; meaningless
  without `max_participants` on the sessions.
- `Session.waitlist_count?: number` — count of `status == 'waiting'` entries.
  Written **absolutely**, only from inside a transaction that read the queue.
- `SessionPublicProfile.waitlist_count` — added to the class branch of
  `syncSessionPublicProfile` (`:67-88`) only. No `waitlist_enabled`, no `status`
  (§0.4 N10).
- `team.settings.booking.waitlistClaimMinutes` (default **120**), alongside
  `cutoffMinutes` (`booking/index.ts:678-682`).

### 3.4 A guest with no account

Identical to the guest path `bookSession` runs (`booking/index.ts:783-863`):
exact match on `teamId + email + lowercased firstname/lastname`, else create.
A waitlist-born contact gets:

- `entry: 'waitlist'`;
- `provisional: true` **with** `provisional_expires_at = session.start + 30 days`
  — deliberately unlike `booking/index.ts:852`, so an abandoned queue entry is
  reaped by `purgeProvisionalContacts` (which re-checks `provisional !== true` at
  delete time, `purgeProvisionalContacts.ts:31`, so a claim that confirms the
  contact makes it permanent);
- **no `acquisition_stage`.** Joining a queue is not a trial booking; stamping
  `'trial_booked'` (what `booking/index.ts:846` does) would corrupt funnel
  reporting for someone who never got a seat. Stamp it at claim.

A signed-in contact is identified **only** from the contact session
(`optionalContactSessionFromRequest`, `utils/contactSession.ts`), never a body
`contactId` — the July 2026 audit finding documented at `booking/index.ts:422-428`.

---

## 4. Work items

Ordered. Items inside an **⚛ ATOMIC GROUP** must land in one commit.

---

### ⚛ ATOMIC GROUP A — one seat writer

`docs/fareharbor-analysis.md:462-465` already binds this: transactional
`bookSession` + `bookingHoldsSeat` in `trackBookings` + retiring the blind
increments, in one commit. Splitting it leaves both counting styles live and the
recount papers over the difference non-deterministically. §0.4 N4 and N5 show
that both styles are *already* fighting in production, so this group is a bug fix
before it is a foundation.

---

#### P2-A · `countHoldingSeats` + `seatsFree`, and reason codes on every capacity refusal

**Files + symbols**
- `packages/shared/src/types/session.ts` — new pure helpers beside
  `bookingHoldsSeat` (`:48-63`)
- `packages/functions/src/booking/index.ts:637-674` — the capacity gate
  (condition at `:641`, throw at `:661`)
- `packages/functions/src/booking/index.ts:385-388`, `:401-402` — the two
  rate-limit throws that share the code
- `packages/functions/src/connect/checkout.ts:137-139` — `checkoutRateLimit`'s throw

**Change**
```ts
// shared/src/types/session.ts
export function countHoldingSeats(
  docs: Array<{ id: string; data(): unknown }>, nowMs?: number, excludeId?: string
): number                       // reduce over bookingHoldsSeat, skipping excludeId
export function seatsFree(
  maxParticipants: number | undefined, holding: number
): number                       // Infinity when no cap
```
Every capacity refusal gains `details: { reason: 'session_full' }`, following the
pattern already used at `booking/index.ts:710-713` and `dropIn.ts:313-317`. The
two rate limiters gain `reason: 'rate_limited_ip'` / `'rate_limited_session'`;
`checkoutRateLimit` gains `reason: 'rate_limited'`.

**Failure mode prevented.** `resource-exhausted` is thrown by four unrelated
conditions in the booking path. The public form cannot tell "full → offer the
waitlist" from "you are rate-limited", so the waitlist CTA would appear on a
throttled request and not appear on a genuinely full class behind a NAT.

**Verify.** Emulator: fill a class, call `bookSession` → `resource-exhausted`
with `details.reason === 'session_full'`. Then exceed the per-IP limit on a
non-full session → `resource-exhausted` with `reason: 'rate_limited_ip'`.
Unit-test `countHoldingSeats` / `seatsFree` in
`packages/functions/src/booking/sessionHolds.test.ts` (the file Phase 0 created).

---

#### P2-B · `bookSession`'s capacity check becomes transactional

**Files + symbols**
- `packages/functions/src/booking/index.ts:637-674` — the stale-full gate Phase 0
  added
- `:927-1023` — the three write branches (credit spend `:933-980`, usage window
  `:993-1018`, plain `:1019-1023`)
- `:913-918` — `sessionCounterUpdate`

**Change.** Collapse the gate and the write into **one** transaction per branch.
Reads first, in this order: `tx.get(sessionRef)`, `tx.get(sessionRef.collection('bookings'))`,
then the branch's own reads (`tx.get(grantsQuery)` as today at `:940`, or
`tx.get(windowRef)` at `:994`). Then:

```
holding = countHoldingSeats(bookingsSnap.docs, nowMs, contactId)
if (max && holding >= max) throw resource-exhausted { reason: 'session_full' }
… branch writes (credit / window) …
tx.set(bookingRef, bookingDoc)
tx.set(sessionRef, { has_bookings: true,
                     bookings_count: holding + 1,
                     last_booking_at: serverTimestamp(),
                     …(isNewContact && { bio_link_new_contact_bookings_count: … }) },
       { merge: true })
```

`bookings_count` becomes an **absolute** write; `FieldValue.increment(1)` at
`:915` is deleted. `bio_link_new_contact_bookings_count` stays an increment — it
is a lifetime tally, not a capacity number, and nothing recounts it.

The stale-full pre-read Phase 0 added at `:649-672` is **deleted**: the
transaction now recounts unconditionally, so the correction is a side effect of
every booking rather than a special path.

The session doc is read AND written inside the transaction — that is the stated
serialization point (§0.3(a)); the bookings query supplies the count.

**Failure mode prevented.** Two concurrent bookers both read `bookings_count = 9`
against `max = 10` and both write — the oversell the waitlist's entire promise
depends on not happening (a claim hold that a direct booker can take is not a
hold). Plus §0.4 N4's transient double-count, which today makes a filling class
refuse one seat early.

**Verify.** Emulator: `max_participants: 1`; fire two `bookSession` calls for two
different contacts concurrently → exactly one succeeds, the other throws
`resource-exhausted` with `reason: 'session_full'`, and `bookings_count` settles
at 1. Then book a class to capacity and assert `bookings_count === max` at every
observation (no transient `max + 1`).

**Cost.** One read per existing booking on the session, on every booking. Fine at
class scale (≤ 30). **Do not generalise this shape to `events/`** (hundreds of
attendees) without re-measuring.

---

#### P2-C · `createDropInCheckout` gets a capacity gate (BLOCKER 2)

**Files + symbols**
- `packages/functions/src/booking/dropIn.ts` — whole file re-read: **zero**
  occurrences of `max_participants`. The only capacity-adjacent line is
  `bookings_count: FieldValue.increment(1)` at `:401` (full-cover branch); the
  sole pre-write guard is the already-registered check at `:347`.

**Change.** Two calls to one helper:

1. **Fail-fast pre-flight**, immediately after the cutoff check (`:146-148`) and
   **before** `reserveGiftCardDrawdown` (`:361`): read the session's bookings,
   `countHoldingSeats(..., excludeId: contactId)`, throw
   `resource-exhausted { reason: 'session_full' }` if full. This is not a parallel
   check — it is the same helper, called early so a refusal leaves no reserved
   gift-card drawdown behind (the release at `:540-544` only catches
   `startOneOffCheckout` failures).
2. **Authoritative gate**, inside a transaction wrapping the hold write
   (`:452-472`) and the full-cover write (`:376-405`): re-read session +
   bookings, refuse if full, write the booking and the absolute
   `bookings_count`. The full-cover branch's `FieldValue.increment(1)` at `:401`
   is deleted.

**Failure mode prevented.** A full class sells drop-ins today, deterministically,
with no race required. Every claim hold the waitlist creates can be bought out
from under the queue. Adding a transaction around a missing guard fixes nothing —
the guard is the fix.

**Verify.** Emulator: class with `max_participants: 1`, one confirmed booking,
drop-in enabled and priced → `createDropInCheckout` throws
`resource-exhausted { reason: 'session_full' }` and no `connect_checkout_attempts`
side effects, no gift-card hold, no booking doc. Repeat with a gift-card code and
assert the card's `held` map is untouched.

---

#### P2-D · `handleDropInCheckout` re-checks capacity and refunds instead of overselling

**Files + symbols**
- `packages/functions/src/connect/webhook.ts:1460-1495` — `isNew = !bSnap.exists`
  at `:1462`, the blind confirm at `:1463-1482`, the increment at `:1491`
- `refundDirectCharge` — already imported (`webhook.ts:50`) and used at `:1422-1427`

**Change.** Replace the blind confirm + increment with one transaction:

```
read session + bookings
others = countHoldingSeats(docs, nowMs, excludeId: contactId)
confirmable = !max || others < max            // the caller's own hold never counts against them
if (!confirmable)  → refund via refundDirectCharge, stamp member_payments
                     'refunded', reverse any gift-card drawdown (the exact shape
                     already at :1437-1451), log, return
else               → set the booking confirmed/paid (merge, as today)
                     tx.set(sessionRef, { bookings_count: others + 1, … })
```

`FieldValue.increment(1)` at `:1491` is deleted.

Note the precision: a claimant whose hold survived is confirmed unconditionally —
the seat was held for them and there is no capacity question. Only a payment
landing against a hold that no longer holds a seat (swept, or lapsed while
someone else took it) is tested, and only then refunded.

**Failure mode prevented.** `webhook.ts:1462` deliberately recreates a swept
booking ("a paid charge must never be lost"). The waitlist manufactures
back-to-back claims on one seat by design, so this turns from rare into routine:
claim lapses → sweep releases → next person claims → the first person's payment
lands → class oversold by one, confirmed, nobody checked. Refunding is the honest
default: they did not get the seat.

**Verify.** Emulator + Stripe CLI: create a drop-in hold, delete the booking doc
by hand, fill the class from another contact, then replay the
`checkout.session.completed` event → no booking is created, `member_payments`
shows `status: 'refunded'`, `bookings_count` unchanged. Repeat without filling the
class → the booking is recreated and confirmed exactly as today.

---

#### P2-E · `rebookSession` gets a capacity check and a cutoff check

**Files + symbols**
- `packages/functions/src/booking/index.ts:1561-1670` — validates team
  (`:1614-1615`), `allowBooking` (`:1616-1617`), past-ness (`:1619-1621`),
  exception status (`:1622-1624`), duplicates (`:1626-1632`), then writes
  (`:1640-1670`). **No `max_participants` anywhere. No `isPastBookingCutoff`
  anywhere** — the only booking path with neither.

**Change.** Replace the `db.batch()` at `:1640-1670` with a transaction that
reads the **new** session doc + its bookings, refuses when full
(`resource-exhausted { reason: 'session_full' }`), and writes absolute
`bookings_count` on both sessions (the old one also needs a recount — read its
bookings too, or leave the decrement to `trackBookings`, which fires on the
`rebooked` status flip because `rebooked` **is** in `STATUS_EVENT`
(`analytics/index.ts:49`); prefer the latter and simply delete the `-1` at
`:1648`). Add `isPastBookingCutoff` against the new session, using the same team
settings read the other paths do.

**Failure mode prevented.** A token-holder can oversell any class today, and can
rebook straight into a seat the waitlist is holding — the queue's promise broken
by the one callable that never checked anything.

**Verify.** Emulator: fill class B; rebook a token from class A into B → throws
`resource-exhausted { reason: 'session_full' }` and neither session's counts
move. Then set `cutoffMinutes: 120` and rebook into a class starting in 30
minutes → `failed-precondition`.

---

#### P2-F · The guest duplicate guard learns about pending holds

**Files + symbols**
- `packages/functions/src/booking/index.ts:817` — guest exactMatch branch:
  `if (existingBooking.exists || existingParticipant.exists)`
- `:777-780` — the authenticated branch, which exempts `status === 'pending'`

**Change.** Align `:817` with `:777-780`: a `pending` booking for the same
contact does not block.

**Failure mode prevented.** A guest holding a claim hold (or an abandoned drop-in
hold) who returns to the public booking form gets a bare `already-exists` with no
reason. The asymmetry is pre-existing and wrong on its own terms — the comment at
`:775-776` states the intended rule and the guest branch does not implement it.

**Verify.** Emulator: create a guest drop-in hold, then `bookSession` as the same
guest on a free class → succeeds; with a `confirmed` booking → still
`already-exists`.

---

#### P2-G · Retire every remaining `bookings_count` increment; stop no-shows corrupting holds

**Files + symbols**
- `packages/functions/src/booking/index.ts:1344-1356` — `cancelBooking`'s
  transaction, `bookings_count: FieldValue.increment(-1)` at `:1345`
- `packages/functions/src/sessions/index.ts:888-891` — kiosk self-scan,
  `bookings_count: FieldValue.increment(-1)`
- `packages/functions/src/dailyTasks/markNoShowBookings.ts:35`, `:47-49`,
  `:64-66`, `:70-72`
- `packages/functions/src/analytics/index.ts:45-50` (`STATUS_EVENT`),
  `:140-145` (`descMap`)

**Change**

1. `cancelBooking`: add `tx.get(sessionRef)` + `tx.get(bookingsRef)` to the
   existing transaction and write the absolute post-cancel count. This also makes
   a cancel serialize against a concurrent booking, which is the pairing the
   waitlist depends on.
2. Kiosk self-scan (`sessions/index.ts:889-890`): delete the
   `bookings_count: increment(-1)` line. It is a stale writer from the pre-merge
   counter model and `trackBookings`' recount already contradicts it (§0.4 N5).
   Keep `conversions_count: increment(1)` and the `pending_bookings_count`
   decrement.
3. `analytics/index.ts:45-50`: add `no_show: 'booking_no_show'` to `STATUS_EVENT`
   and a matching line to `descMap` (`:140-145`, hardcoded English — no i18n
   obligation) so a no-show flip reaches the recount at `:103-129`.
4. `markNoShowBookings`: delete the session counter write at `:70-72` entirely
   (the recount now owns it). Narrow the pending filter at `:47-49` to skip
   **unsettled holds** — `payment_status === 'required' || waitlist_claim === true`
   — and skip the `pending_bookings_count` decrement for them too.

**Failure mode prevented.**
- The lost-update class critique #5 names (a batch `increment(-n)` clobbered by,
  or clobbering, an absolute write) — resolved by having exactly one writer.
- §0.4 N3: an abandoned checkout on a class that ended in the last seven days is
  stamped `no_show` on a real person's record, **today**, and decrements a
  counter that was never incremented (§0.4 N2). A free claim hold is the same
  shape and would inherit it.

**Verify.** Emulator: create a drop-in hold on a session that ended yesterday,
run `markNoShowBookings` → the booking is untouched and the contact's
`pending_bookings_count` is unchanged; then run `expirePendingBookings` → the
booking is deleted. Separately: flip a real pending booking to `no_show` and
assert `bookings_count` drops **without** `markNoShowBookings` writing it.

---

### The waitlist proper

---

#### P2-H · Data model, paths, activity flag, settings

**Files + symbols**
- `packages/shared/src/paths.ts:111` — add `WAITLIST_SUBCOLLECTION = 'waitlist'`
- `packages/shared/src/types/session.ts` — `WaitlistEntry` (next to `Booking` at
  `:242-273`); `Session.waitlist_count`; `SessionPublicProfile.waitlist_count`;
  `Booking.waitlist_claim` + `Booking.claim_expires_at` (the fields
  `isExpiredWaitlistClaim` at `:30-35` already reads)
- `packages/shared/src/types/activity.ts:172` — `waitlistEnabled?: boolean`, and
  the same field on `ActivityPublicProfile` (`:255` neighbourhood)
- `packages/functions/src/sync/syncActivityPublicProfile.ts` — mirror
  `waitlistEnabled` under the same class-only conditional spread as `trialEnabled`
- `packages/functions/src/sync/syncSessionPublicProfile.ts:67-88` — add
  `waitlist_count: data.waitlist_count || 0` to the **class** branch only
- new constants file or `booking/waitlist/constants.ts`:
  `WAITLIST_MIN_WINDOW_MINUTES = 35`, `WAITLIST_MAX_OFFERS_PER_RUN = 10`,
  `WAITLIST_DEFAULT_CLAIM_MINUTES = 120`, `WAITLIST_MAX_QUEUE_MULTIPLIER = 2`,
  `WAITLIST_MIN_QUEUE_CAP = 20`
- `team.settings.booking.waitlistClaimMinutes` — read next to `cutoffMinutes`
  (`booking/index.ts:678-682`)

**Change.** Types and constants only; no behaviour. Note explicitly in the
`Session` doc comment that there is **no** `waitlist_enabled` on the session and
why (§0.3(b)), so nobody adds one.

**Failure mode prevented.** The design's `session.waitlist_enabled` has no writer
in this repo and would silently never reach already-created sessions.

**Verify.** `pnpm typecheck` + `pnpm build`. Toggle `Activity.waitlistEnabled` in
the emulator and confirm the activity public profile mirrors it; confirm no
session doc changes.

---

#### P2-I · `joinWaitlist` callable

**Files + symbols**
- new `packages/functions/src/booking/waitlist/join.ts`; export from
  `packages/functions/src/index.ts` next to `createDropInCheckout` (`:64`)
- reuses: `optionalContactSessionFromRequest`, `resolveSingleContact`
  (`utils/contacts.ts`), `sanitizeBookingAnswers`, `parseBookingSource`,
  `isPastBookingCutoff`, `checkoutRateLimit` (`connect/checkout.ts:116`, whose
  `prefix` parameter Phase 0 added for exactly this), `generateSecureToken`

**Change.** Input `{ teamId, sessionId, contactDetails?, questionAnswers?, source? }`.
Order of operations:

1. `checkoutRateLimit(request.rawRequest?.ip, 'waitlist-join')`.
2. Load the session; refuse unless it is a class, in the future, `allowBooking`,
   not past the cutoff, and has `max_participants > 0`.
3. Load the activity; refuse unless `waitlistEnabled === true`.
4. `requirePlan(teamId, 'coach')` — creation gate (§P2-R).
5. Resolve the contact (contact session, else exact email+name match, else
   create per §3.4).
6. **One transaction**: read the queue + the bookings; refuse with
   `failed-precondition { reason: 'already_booked' }` if the caller holds a live
   seat; refuse with `already-exists` if their entry exists and is
   `waiting`/`offered`; refuse with `resource-exhausted { reason: 'waitlist_full' }`
   when `waiting` count ≥ `max(max_participants × 2, 20)`; else write the entry
   and the absolute `waitlist_count`.
7. Send the join-confirmation email (with the `entry_token` link), best-effort.
8. Return `{ position, entryToken }` — position derived from `joined_at ASC`.

**Do not enforce the access gate at join.** A prospective member's subscription
may start before the class. The public form shows the access badge as a warning
and the claim enforces (§P2-J). Similarly, **no promo code and no gift card at
join** — joining snapshots nothing about money (cross-cutting §3).

**Failure mode prevented.** A full class is the one surface an attacker can
hammer, and every join can create a contact. The rate-limit bucket, the queue
cap and `provisional_expires_at` bound it. See §7 for the residual.

**Verify.** Emulator: join twice → `already-exists`, one doc. Join 21 times on a
10-seat class → the 21st throws `waitlist_full`. Join from the same IP 31 times →
`resource-exhausted` on the 31st, while `createDropInCheckout` from the same IP
still succeeds (separate bucket). Join as a guest → contact carries
`entry: 'waitlist'`, `provisional: true`, a `provisional_expires_at` 30 days past
`session.start`, and **no** `acquisition_stage`.

---

#### ⚛ ATOMIC GROUP B — offer and claim

The promoter writes a hold; the claim consumes it. Landing the promoter without
the claim creates seats nobody can take and a queue nobody can leave; landing the
claim without the promoter leaves dead code. Both plus the sweep (P2-M) are the
minimum shippable set — but the sweep is separable *in review* because the
promoter is idempotent, so it is listed after.

---

#### P2-J · `promoteWaitlist` — the transaction, and its trigger

**Files + symbols**
- new `packages/functions/src/booking/waitlist/promote.ts`
- new `onDocumentWritten('sessions/{sessionId}')` handler — the **fifth**
  session-document handler (today: `analytics/index.ts:166` `trackSessions`,
  `sync/syncSessionPublicProfile.ts:10`, `automation/onSessionWrite.ts:26`,
  `sync/onSessionUpdate.ts:103`)

**Change — the edge detector** (pure, in `shared/src/types/session.ts` beside its
siblings):

```ts
export function seatFreedEdge(
  before: { max_participants?; bookings_count?; status? } | null,
  after:  { max_participants?; bookings_count?; status? } | null
): boolean
// true iff before && after && after.status !== 'cancelled'
//   && seatsFree(before) <= 0 && seatsFree(after) > 0
```

The trigger does nothing else. It fires on cancellations, capacity raises, sweep
deletes and admin booking deletes alike, because every one of them converges on a
session-doc write — either the writer's own or `trackBookings`' recount
(`analytics/index.ts:123-128`), which is why hooking call sites was rejected.
**Nothing else in the handler may write the session doc** (§0.4 N7).

**Change — the transaction** (`offerWaitlistSeats`, also called directly by the
admin "Offer now" action and by the sweep's backstop):

```
READS (all before any write):
  tx.get(sessionRef)
  tx.get(sessionRef.collection('bookings'))
  tx.get(sessionRef.collection('waitlist')
           .where('status','in',['waiting','offered'])
           .orderBy('joined_at','asc').limit(50))
  tx.get(teamRef)              // cutoffMinutes  — cache per invocation
  tx.get(activityRef)          // waitlistEnabled — §0.3(b)
GUARDS (re-verified; the event payload is used for nothing but "wake up"):
  session not cancelled, allowBooking === true, start > now
  activity.waitlistEnabled === true
  !isPastBookingCutoff(session.start, cutoffMinutes)
  claim_expires_at per §2; abort if the window is under WAITLIST_MIN_WINDOW_MINUTES
  holding   = countHoldingSeats(bookings, nowMs)
  free      = seatsFree(session.max_participants, holding)
  liveOffers= entries with status 'offered' && offer_expires_at > now
  n = min(free − liveOffers.length, waitingCount, WAITLIST_MAX_OFFERS_PER_RUN)
  if (n <= 0) return                        // ← idempotency lives HERE, and it
                                            //   is the only reason the trigger
                                            //   may fire twice per cancellation
WRITES (n heads, in joined_at order):
  tx.set(bookingRef(id), { …identity…, status: 'pending', fromBioLink: true,
                           source, waitlist_claim: true, claim_expires_at,
                           booking_token, booking_reference,
                           question_answers?, is_new_contact: false })
  tx.update(entryRef(id), { status: 'offered', offer_token, offered_at,
                            offer_expires_at: claim_expires_at })
  tx.update(contactRef(id), { pending_bookings_count: increment(1) })
  tx.set(sessionRef, { bookings_count: holding + n,
                       waitlist_count: <recomputed>, has_bookings: true },
         { merge: true })
```

`claim_expires_at` and `offer_expires_at` are written from **one** computed
`Timestamp` variable — two copies of one instant, never two computations.

Notifications are sent **after** the commit, outside the transaction (P2-O).

**Failure mode prevented.** Offering a seat that a direct booker can take
(the transaction serializes with P2-B/P2-C on the session doc); offering into a
window the cutoff already closed; offering the same seat twice on the trigger's
double fire (cancelBooking's own write *and* `trackBookings`' recount both write
the session); leaving free seats unoffered after a batch cancellation (§0.4 N8).

**Verify.** Emulator: 1-seat class, 3 waiters, cancel the booking → exactly one
`offered` entry, one `pending` claim hold, `bookings_count` back at 1, and the
class still refuses `bookSession`. Raise `max_participants` from 1 to 3 with 3
waiters → 2 offers in one pass. Set `cutoffMinutes` so the window would be under
35 minutes → no offer, entries left `waiting`, seat bookable at the kiosk. Force
the trigger to fire twice (touch the session doc) → still exactly one offer.

---

#### P2-K · `claimWaitlistSeat` — one transaction (BLOCKER 3)

**Files + symbols**
- new `packages/functions/src/booking/waitlist/claim.ts`
- reuses `loadContactPaymentSnapshot` (`booking/access.ts:263`) +
  `resolvePaymentOptions` (`shared/src/utils/paymentOptions.ts:355`) with the same
  `DropInTarget` shape `dropIn.ts:194-201` builds

**Change.** Input `{ teamId, sessionId, offerToken }`. The caller is identified
from the contact session when present; the `offerToken` is the credential
otherwise (it is single-use and unguessable).

Pre-transaction (reads only, no writes): resolve session + activity + team,
re-check `isPastBookingCutoff` and return `failed-precondition
{ reason: 'booking_closed' }` specifically — `bookSession` and
`createDropInCheckout` would refuse anyway (`:683-685`, `dropIn.ts:146-148`), but
the claim page must show the right message. Build the snapshot and resolve.

- `pay` → **never auto-charge.** Return
  `{ requiresPayment: true, amount, appliedBenefit, claimExpiresAt }` and stop.
  The client calls `createDropInCheckout({ waitlistToken: offerToken, … })`
  (P2-L). Nothing is written.
- `covered` / `spend_credits` → **one transaction**:

```
READS:  tx.get(entryRef); tx.get(bookingRef);
        tx.get(grantsQuery)  or  tx.get(windowRef)     // as booking/index.ts:940 / :994
ASSERT: entry.status === 'offered'
        entry.offer_token === offerToken
        entry.offer_expires_at > now
        booking exists, waitlist_claim === true, claim_expires_at > now
        (a second concurrent call fails one of these and throws
         failed-precondition { reason: 'claim_expired' | 'already_claimed' })
WRITES: spend (credit grant or usage window) — identical to booking/index.ts:977 / :1002
        tx.update(bookingRef, { status: autoConfirm ? 'confirmed' : 'pending',
                                waitlist_claim: FieldValue.delete(),
                                claim_expires_at: FieldValue.delete(),
                                subscription_type_id, credit_grant_id?,
                                usage_window_doc_id?, … })
        tx.update(entryRef,  { status: 'claimed', claimed_at,
                               offer_token: FieldValue.delete() })
```

After the commit, best-effort and outside the transaction: the partner-visit
ledger (`booking/index.ts:1030-1064`), the `acquisition_stage` stamp (now, not at
join), clearing `provisional` on a waitlist-born contact, and the confirmation
email (`buildBookingConfirmationEmail` at `booking/index.ts:1126`, sent at
`:1146`). `pending_bookings_count` was already
incremented by the promoter, so **do not increment it again**.

**Failure mode prevented.** BLOCKER 3: two concurrent claims with the same token
each read `status: 'offered'` and each spend a credit — one seat, two credits.
The entry status is the guard and it must be *inside* the transaction. Also: a
claim after the cutoff, which would otherwise surface as a generic error on a
page whose whole job is to explain what happened.

**Verify.** Emulator: a credit-pack contact with exactly 1 credit; fire
`claimWaitlistSeat` twice concurrently with the same token → one succeeds, one
throws `already_claimed`, `credits_used` moved by exactly 1, entry `claimed`,
booking no longer carries `waitlist_claim`. Repeat with a usage-limited
subscription at its last unit. Repeat past the cutoff → `booking_closed`, nothing
written.

---

#### P2-L · `createDropInCheckout` accepts a `waitlistToken`

**Files + symbols**
- `packages/functions/src/booking/dropIn.ts:87-107` (input), `:341-349` (the
  registered guard), `:353` (`expiresAt`), `:372-448` (full cover), `:452-472`
  (pending hold), `:480-498` (metadata), `:534-535` (Stripe expiry)

**Change**

1. New optional input `waitlistToken`. When present, verify the entry: exists,
   `status === 'offered'`, `offer_token` matches, `offer_expires_at > now`, and
   `contact` equals the resolved caller. Otherwise `failed-precondition
   { reason: 'claim_expired' }`.
2. Refuse when `claim_expires_at − now < SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES`
   (`connect/checkout.ts:98`) with
   `failed-precondition { reason: 'claim_window_too_short' }` (§2).
3. The already-registered guard at `:347` already passes the caller's own
   `pending` hold — no change needed. Verified: it blocks only on a
   `participants` doc or a `confirmed` booking.
4. **The pending hold write (`:452-472`) must explicitly re-write
   `waitlist_claim: true`, `claim_expires_at`, and `question_answers` from the
   entry** — it is a bare `.set()` with no merge option and replaces the document
   wholesale (§0.4 N9). Set `expires_at = claim_expires_at`, **not**
   `now + HOLD_MINUTES` (§2).
5. `metadata.waitlistEntry = contactId` (`:480-498`) so the webhook can flip the
   entry.
6. Stripe expiry (`:534-535`) becomes `claim_expires_at` in epoch seconds
   **when a claim is in play**, keeping today's
   `now + SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES` for a plain drop-in. Step 2
   guarantees it is at least 31 minutes out.
7. `handleDropInCheckout` (`webhook.ts:1389-1520`) flips the entry to `claimed`
   and deletes `offer_token` in the same place it confirms the booking — and, on
   the refund branch P2-D adds, flips the entry to `expired` instead.

**Failure mode prevented.** Naively reusing `createDropInCheckout` overwrites the
claim hold: the entry reads `offered` while the hold silently became a plain
drop-in hold, and on abandonment `expirePendingBookings.ts:74` deletes the
booking, leaving the entry stuck at `offered` forever — a permanently blocked
queue. Plus the lost join-time answers (§0.4 N9) and the Stripe-floor collision
(critique #6).

**Verify.** Emulator: claim a paid seat, inspect the booking → `waitlist_claim`
still true, `expires_at === claim_expires_at`, `question_answers` present.
Inspect the Stripe session's `expires_at` → equals `claim_expires_at`. Claim with
30 minutes left in the window → `claim_window_too_short`, nothing written. Pay →
booking confirmed, entry `claimed`, `offer_token` gone.

---

#### P2-M · The gift-card full-cover claim (BLOCKER 1) and the death of the `waitlistEntryId` rider

**Files + symbols**
- `packages/functions/src/booking/dropIn.ts:372-448` — the full-cover branch:
  commits the drawdown at `:433` and returns at `:441-447` **without creating a
  Stripe session**, so `handleDropInCheckout` never runs
- `packages/functions/src/connect/giftCards.ts:403-500` —
  `commitGiftCardDrawdown`; the `waitlistEntryId` rider at `:423-425`; the early
  returns at `:428-430` and `:464`

**Change**

1. The full-cover booking write (`:376-394`) and the waitlist entry flip
   (`status: 'claimed'`, `claimed_at`, `offer_token` deleted) become **one
   `WriteBatch`**, committed together with the absolute `bookings_count` write
   P2-C adds. The batch is written **before** `commitGiftCardDrawdown` at `:433`,
   which is where the seat becomes permanent.
2. **Delete the `waitlistEntryId` parameter** from `commitGiftCardDrawdown`
   (`giftCards.ts:425`) and replace the comment with the reason it cannot work
   (§0.3(c)): the booking is already confirmed before it runs, and both early
   returns (`:428-430` nothing committed; `:464` comped card) skip anything placed
   after them. Leave `promoRedemptionId` alone.

**Failure mode prevented.** BLOCKER 1 exactly: the entry stays `offered`, the
sweep matches it, and the release step deletes a **confirmed** booking that was
paid for with committed stored value — the buyer loses the balance *and* the
seat, which is then handed to the next person. Doubly guarded, because P2-M's
sibling guard lives in the sweep (P2-N): the release transaction refuses to touch
any booking that is not still a live unclaimed claim hold.

**Verify.** Emulator: a gift card that fully covers the drop-in price; claim →
booking `confirmed` + `payment_status: 'gift_card'`, entry `claimed`, card
debited, no Stripe session. Then force-run `sweepWaitlistOffers` with the clock
past `offer_expires_at` → the booking is untouched and the balance is unchanged.
Repeat with an `admin_comp` card (which hits `giftCards.ts:464`) and assert the
entry still flipped.

---

#### P2-N · `sweepWaitlistOffers` — hourly, and the only owner of the entry lifecycle

**Files + symbols**
- new `packages/functions/src/booking/waitlist/sweep.ts`
- `packages/functions/src/dailyTasks/index.ts:18-24` — `bookingRemindersHourly`
  (`every 1 hours`, 300s / 512MiB), whose doc comment at `:13-17` already frames
  it as the job for offset-accurate, time-sensitive booking work
- **not** `dailyTasks` at `:35-53` — an offer made at 09:00 and lapsing at 11:00
  would sit dead until 02:00 UTC

**Change.** Add a third call to `bookingRemindersHourly`, after
`sendBookingReminders()`. Three passes, in order:

1. **Lapsed offers.** `collectionGroup('waitlist').where('status','==','offered')
   .where('offer_expires_at','<=',now)`. Per entry, **one transaction**:
   - read the entry and its booking;
   - if the booking is **not** a live unclaimed claim hold — i.e. it is missing,
     or `status === 'confirmed'`, or `payment_status ∈ {'paid','gift_card'}`, or
     `waitlist_claim !== true` — then **do not delete it**. Instead self-heal:
     flip the entry to `claimed` if the booking is confirmed/paid, else to
     `expired`. This is the guard that makes BLOCKER 1 non-destructive even if a
     flip were ever missed, and it makes the entry a derived view of the booking
     rather than a second source of truth.
   - otherwise: delete the booking, decrement the contact's
     `pending_bookings_count`, set the entry `expired` + `expired_at`, delete
     `offer_token`, and write the absolute `bookings_count` — **release first**,
     for the reason documented at `expirePendingBookings.ts:8-18`.
   - then call `offerWaitlistSeats(sessionId)` for that session, outside the
     transaction. Releasing before re-offering is what stops the seat leaking
     until the next hourly run.
2. **Dead queues.** `collectionGroup('waitlist')
   .where('status','in',['waiting','offered']).where('session_start','<=',now)`
   → flip to `expired`. Without this the queue leaks an entry on every past
   session forever; this is why `session_start` is denormalised onto the entry.
3. **Backstop promotion.** `collectionGroup('waitlist')
   .where('status','==','waiting').where('session_start','>',now)`, dedupe by
   `session`, call `offerWaitlistSeats` per session (it re-reads everything and
   no-ops when there is nothing to do). Catches a dropped trigger event.
   **Not** "sessions with free seats and a queue" — Firestore cannot compare two
   fields and there is no index for it (critique #13).

**Do not touch `expirePendingBookings`.** Its step-2 query
(`expirePendingBookings.ts:63-67`) matches a claim hold once checkout starts, and
that is fine: `expires_at === claim_expires_at` (§2), the delete is idempotent,
and pass 1 re-derives the entry from the booking's absence. Adding an exclusion
would be a second owner of the same decision.

**Hourly granularity is acceptable only because of lazy expiry.** A lapsed hold
stops blocking a seat the instant any transaction reads it (`bookingHoldsSeat`),
and `claimWaitlistSeat` refuses a lapsed offer regardless of whether the sweep has
run. The sweep is bookkeeping and re-offering — the same posture
`connect/giftCards.ts:22-25` documents for gift-card holds ("Expiry is therefore
LAZY").

**Failure mode prevented.** A blocked queue (entry stuck at `offered` after its
hold vanished); a leaked seat (release ordered after re-offer); a destroyed paid
booking (the guard above); an unbounded queue on past sessions.

**Verify.** Emulator with a manipulated clock: offer a seat, let it lapse, run
the sweep → booking gone, entry `expired`, next waiter `offered`,
`bookings_count` correct throughout. Confirm a confirmed/paid booking is never
deleted by seeding an `offered` entry against a `confirmed` booking and running
the sweep → entry self-heals to `claimed`, booking untouched.

---

#### P2-O · `leaveWaitlist`, `listMyWaitlist`, and queue teardown on session cancel

**Files + symbols**
- new `packages/functions/src/booking/waitlist/manage.ts`
- `packages/functions/src/sessions/index.ts` — `cancelSession` (the cancellation
  mail loop around `:215-247`) and the session-delete path

**Change**
- `leaveWaitlist({ entryToken })` — status `left` + `left_at`; when the entry was
  `offered`, run the same release sequence as sweep pass 1 (guarded identically)
  and then re-offer. Rate-limited on the same `'waitlist-join'` bucket.
- `listMyWaitlist({ teamId })` — contact-session only; returns the caller's
  entries with derived positions. Required because the collection-group rule
  needs `isTeamMember` and `isSelfContact(entryId)` authorises a `get`, not a
  `list` (design §11.1's own honest limitation). A per-contact mirror was
  rejected: five state transitions to keep in sync.
- `cancelSession` / session delete: flip every `waiting`/`offered` entry to
  `expired`, release any claim hold with the same guard, and email the
  `offered` person that the class was cancelled.

**Failure mode prevented.** An entry stuck `offered` on a cancelled class, with a
claim hold nobody can use and a person holding a link that 500s.

**Verify.** Emulator: cancel a session with a live offer → entry `expired`, hold
gone, mail sent. `listMyWaitlist` as contact A never returns contact B's entries.

---

#### P2-P · Notifications

**Files + symbols**
- `packages/functions/src/booking/templates.ts` — new `buildWaitlistJoinedEmail`,
  `buildWaitlistOfferEmail`, `buildWaitlistOfferSms`, `buildWaitlistExpiredEmail`,
  following the `Record<Lang, string>` pattern at `:98-153` and `:298`
- `packages/functions/src/dailyTasks/sendBookingReminders.ts:61-66` —
  **lift `isWithinSmsSendingHours` to `packages/functions/src/utils/sms.ts`** and
  re-export from its old home (it is exported today only for its unit test,
  `sendBookingReminders.test.ts`); add a sibling `nextSmsWindowOpen(now, tz)`
- `sendBookingReminders.ts:218-219` — the reminder exclusion

**Change**
- Email always, via `sendEmail(..., { teamId })` so it sends **as the studio** and
  inherits sender resolution and the `mail_suppressions` skip.
- SMS only when the contact has a phone **and** the offer is minted inside the
  sending window. `tag: 'waitlist-offer'`,
  `idempotencyKey: 'waitlist-offer-{sessionId}-{contactId}'` — unique by
  construction now that an entry gets at most one offer (that is what dropping
  `offer_count` buys).
- `sendBookingReminders`' exclusion at `:219` (`payment_status === 'required'`)
  must also skip `waitlist_claim === true`, or a held-but-unclaimed seat gets a
  reminder for a class the person has not got.
- Copy policy: no emoji; "class"/"session", never "lesson"; the shared layout in
  `@linyup/shared` (memory: `email-templating`).
- **No push.** Push is not shipped for reminders; do not build a claim window on
  a channel that does not exist.
- Per-tenant messaging policy is applied inside `sendEmail`/`sendSms`, so sandbox
  and lead tenants need no extra work.

**Failure mode prevented.** Deferring the offer (rather than only the SMS) would
leave the seat dark all night and the class would fill at 08:05 from walk-ins
instead of from the queue.

**Verify.** Emulator with the messaging policy in `silent` mode: assert one
`mail_sends` row per offer and zero SMS outside 08:00–21:00 Europe/Zurich.
Redeliver the same offer → no second SMS.

---

#### P2-Q · Public UI — joining

**Files + symbols**
- `apps/web/.../public/[slug]/booking/BookingForm.tsx` — `sessionBlockReason`
  (`:211-222`), `filteredSessions` (`:644-650`), the deep-link resolver
  (`:507-519`), the session click handler (`:1435-1450`),
  `nextStepAfterSession` (`:201-205`), `DeepLinkNotice` (`:141`)

**Change**
1. Reorder `sessionBlockReason` so the cutoff check (`:219-220`) runs **before**
   the capacity check (`:217-218`). A class that is both full and closed then
   reports `'closed'`, is filtered out at `:649`, and can never show a waitlist
   chip for a queue §2 forbids offering from.
2. Add a `'full'` branch that keeps the slot rendered (it is filtered only for
   `'closed'` today) and shows a "Join the waitlist" chip beside the duration
   chip, gated on `activity.waitlistEnabled` from the **activity** public profile
   (§0.3(b)).
3. Route the click and the `?session=` deep link (which already resolves `'full'`
   at `:508`) to a new `'waitlist'` step instead of dead-ending.
4. The join step reuses `GuestDetailsForm` and the activity's `bookingQuestions`
   (already collected into `answers`); a signed-in contact skips the form —
   `usePublicContactAuth` supplies the session and `joinWaitlist` trusts only that
   token.
5. **Show the access badge as a warning, not a gate** (`badgeMembersOnly` /
   `badgeMembershipRequired` already exist in `messages/en.json`). Enforcement is
   at claim.
6. Confirmation shows the derived position and a "leave the waitlist" link built
   from `entry_token`.

**Failure mode prevented.** Today a full slot renders, is clickable, and
dead-ends on the server throw — the worst moment in the funnel. And without (1),
the new chip would invite joins to a queue that can never be offered from.

**Verify.** A full, bookable class shows the chip and joins. A full class past the
cutoff does not appear at all. A `?session=` link to a full class lands on the
join step; to a closed class, on the existing notice.

---

#### P2-R · Public UI — the claim page

**Files + symbols**
- `packages/shared/src/publicRoutes.ts` — add `'waitlist'` to `PublicRoutable`
  (`:25-33`) and `waitlist: TokenParams` to `PublicRouteParams` (`:93-108`)
- new `apps/web/src/app/[locale]/(public)/public/[slug]/waitlist/page.tsx`, with
  `export const dynamic = 'force-dynamic'` (CLAUDE.md; matches
  `manage-booking/page.tsx`)

**Change.** `/public/{slug}/waitlist?token=…`, built with the same
`publicUrl(getHostingUrl(), slug, 'waitlist', { token })` shape used for
manage-booking at `booking/index.ts:870-872`. One page, two modes, resolved
server-side by which token matched:

- **`entry_token`** → status view: position, session details, "Leave the
  waitlist" → `leaveWaitlist`.
- **`offer_token`** → claim view: a countdown to `offer_expires_at`, session
  details, "Claim my spot" → `claimWaitlistSeat`.
  - `covered` / `spend_credits` → done inline.
  - `requiresPayment` → the price with `appliedBenefit` struck through (same
    shape `BookingForm` renders at `:1750`ff, which Phase 0's P0-4 already
    corrected to call `planGiftCardRedemption`), plus `GiftCardRedeemField`
    (`apps/web/src/components/booking/GiftCardRedeemField.tsx`), then "Pay &
    confirm" → `createDropInCheckout({ waitlistToken })` → Stripe.
  - Stripe return: `buildResultUrls` with `&slug=…&seg=booking`
    (`dropIn.ts:475-479`), landing on the booking flow's verified confirmed step.

**Promo and gift card are both entered HERE, never at join** (cross-cutting §3).
Keep `buildWaitlistOfferEmail` free of codes. Phase 3 adds a promo field to this
page and nothing else changes.

**Failure mode prevented.** A claim credential in a long-lived link; a claim page
that cannot tell "expired" from "taken" from "booking closed" (P2-K's reason
codes are what it renders).

**Verify.** Both token modes render. An expired offer shows the expired state, not
an error. The paid path returns to the confirmed step with the booking visible.

---

#### P2-S · Admin UI

**Files + symbols**
- `apps/web/src/app/[locale]/(auth)/sessions/[id]/page.tsx` — new section after
  "Portal bookings" (`:723-726`), new `useQuery` beside `bookingsQ` (`:361-366`),
  a count in the stat row (`:633-649`, beside `pendingBookingsStat` at `:643`)
- `apps/web/src/hooks/useDaySheet.ts:73-87` — a third `getDocs` and
  `waitlist: WaitlistEntry[]` on `DaySheetEntry` (`:37-44`), plus a
  `waitingEntries()` helper beside `activeBookings` (`:46-49`)
- `apps/web/src/app/[locale]/(auth)/manifest/page.tsx` — print
  "Waitlist (3): A. Müller · B. Rossi · C. Dupont" under each roster
- the activity form (`waitlistEnabled` beside `trialEnabled` / `dropIn`) and
  Settings → Booking (`waitlistClaimMinutes`, in the `SettingsBooking` namespace
  — `en.json:3875`)

**Change.** Rows show position, name, contact, "waiting since", and a status chip
(`waiting` / `offered — expires in 12 min` / `claimed` / `expired` / `left`).
Two row actions, **both via callables, never client writes** — a client write
bypasses the capacity transaction and re-opens the oversell:
- **Offer now** → `promoteWaitlistEntry({ sessionId, contactId })`, which enters
  the same transaction with a pinned head. Disabled with a tooltip when there is
  no free seat.
- **Remove** → `removeWaitlistEntry`, behind a confirmation dialog (destructive
  action rule).

**"Book directly" (`force: true`) is out of scope** (critique #18) — it would be a
second capacity-writing path for a workflow the existing booking surfaces already
serve.

**Failure mode prevented.** The day sheet is the point of the feature: a coach at
the door with a no-show and three names to call.

**Verify.** The session detail count matches the queue; "Offer now" is disabled on
a full class; the manifest prints the waiting names.

---

#### P2-T · Firestore rules and indexes

**Files + symbols**
- `firestore.rules` — inside `match /sessions/{session}` (`:963`), mirroring the
  bookings block at `:1013-1020`; and a collection-group block beside `:1110-1115`
- `firestore.index.json` — `indexes` and `fieldOverrides`

**Change — rules**
```
match /waitlist/{entryId} {
  allow read:  if belongsToUserTeam(get(/databases/$(database)/documents/sessions/$(session)))
                  || hasRole('admin');
  allow read:  if isSelfContact(entryId);
  allow write: if false;            // callables only — NOT the bookings block's
}                                   //   schedule.manage write (critique #11)

match /{path=**}/waitlist/{entryId} {
  allow read:  if request.auth != null
                  && resource.data.teamId != null && isTeamMember(resource.data.teamId);
  allow write: if false;
}
```
Confirm no waitlist collection reaches the public `public_profile` group read at
`:1117-1121`.

**Change — indexes**

| Scope | Fields | Purpose |
|---|---|---|
| COLLECTION_GROUP `waitlist` | `status ASC, offer_expires_at ASC` | sweep pass 1 |
| COLLECTION_GROUP `waitlist` | `status ASC, session_start ASC` | sweep passes 2 and 3 |
| COLLECTION_GROUP `waitlist` | `teamId ASC, contact ASC` | `listMyWaitlist` — mirrors the bookings CG index |
| COLLECTION `waitlist` | `status ASC, joined_at ASC` | the FIFO head inside the promotion transaction |

Plus **`fieldOverrides`** for `waitlist.entry_token` and `waitlist.offer_token`,
each with a `COLLECTION_GROUP` ascending index — copy the shape of the
`bookings.booking_token` entry verbatim (§0.4 N6). Without them the token lookups
work in the emulator and fail in a real project.

Deploy **indexes before functions** (memory: `firestore-index-query-gotcha`).

`offer_expires_at` / `offer_token` / `offered_at` are **flat fields**, not a nested
`offer` map — a nested map subfield index is legal but the flat shape keeps the
queries and the overrides identical to every existing precedent.

**Verify.** Rules unit tests: a team member lists the queue; a contact session
reads only its own entry; every write from a client is denied. Deploy the indexes
to `linyup-sandbox` and run each query **against the real project**, not the
emulator.

---

#### P2-U · i18n — all four locales, in lockstep

**Files + symbols**: `apps/web/messages/{en,de,fr,it}.json`; `en.json` first.

- `PublicBooking` (`:3602`) — `waitlistBadgeFull`, `waitlistJoinCta`,
  `waitlistJoinTitle`, `waitlistJoinSubtitle`, `waitlistJoinedTitle`,
  `waitlistPosition`, `waitlistHowItWorks`, `waitlistAccessWarning`,
  `waitlistUnavailable`, `waitlistFullQueue`.
- new `Waitlist` namespace (the claim page) — `claimTitle`, `claimSubtitle`,
  `claimExpiresIn`, `claimCta`, `claimPayCta`, `claimSuccess`, `claimExpired`,
  `claimTaken`, `claimClosed`, `claimWindowTooShort`, `statusTitle`,
  `statusPosition`, `leaveCta`, `leaveConfirm`, `leftTitle`, `errorGeneric`.
- `SessionDetail` (`:4095`) — `waitlistSection`, `waitlistEmpty`, `waitlistStat`,
  `waitlistOfferNow`, `waitlistOfferNowDisabled`, `waitlistRemove`,
  `waitlistRemoveConfirm`, `waitlistStatusWaiting|Offered|Claimed|Expired|Left`,
  `waitlistOfferExpiresIn`.
- `Manifest` (`:3855`) — `waitlistHeading`, `waitlistCount`.
- `Sessions` (`:787`) / `Activities` (`:1144`) — `waitlistEnabledLabel`,
  `waitlistEnabledHint`, `waitlistRequiresCapacity`. **There is no `SessionForm`
  namespace** (critique #16).
- `SettingsBooking` (`:3875`) — `waitlistClaimMinutesLabel`,
  `waitlistClaimMinutesHint`.

Email and SMS copy is **not** here — it lives in `booking/templates.ts` (P2-P).

**Verify.** A key-set diff across all four files is empty for every namespace
touched.

---

#### P2-V · Plan gate — creation only

**Files + symbols**: `packages/functions/src/utils/plan.ts:10` (`requirePlan`),
already used for non-plugin gates in `automation/previewAutomationRule.ts` and
`automation/triggerAutomationRule.ts`.

**Change.** `await requirePlan(teamId, 'coach')` in `joinWaitlist` and in the
admin's activity-flag write path. **Not** in `claimWaitlistSeat`, not in the
promoter, not in the sweep, not in `leaveWaitlist` — an outstanding offer, and
the queue that already exists, complete their lifecycle through a downgrade
(`docs/fareharbor-analysis.md:341`).

**Verify.** Downgrade a team to `free` with a live offer → the claim still works
and the sweep still runs; a new join is refused with `permission-denied`.

---

#### P2-W · Documentation

- New `docs/waitlist.md`: the data model, the single-deadline rule (§2), the
  claim lifecycle, and the "release before re-offer" ordering.
- `docs/fareharbor-analysis.md` — mark Phase 2 done and correct the stale
  `booking/index.ts:607-614` capacity ref at `:132`.
- `CLAUDE.md` — one paragraph under Key patterns: the waitlist is class-only,
  entries live at `sessions/{id}/waitlist/{contactId}`, `bookings_count` has
  exactly one writing style, and `claim_expires_at` is the only claim deadline.

---

## 5. Atomic commit groups

| Group | Contents | Why splitting breaks |
|---|---|---|
| **A** | P2-A + P2-B + P2-C + P2-D + P2-E + P2-F + P2-G, with `sessionHolds.test.ts` green | Leaving both counting styles live lets the transaction's read set and the surviving `increment()` calls interleave, with `trackBookings` papering over it non-deterministically — and §0.4 N4/N5 show both styles are already fighting. Binding at `docs/fareharbor-analysis.md:462-465`. |
| **B** | P2-J + P2-K + P2-L + P2-M | The promoter alone creates holds nobody can claim; the claim alone is dead code; `createDropInCheckout` without P2-M's full-cover flip **is** blocker 1. |
| **C** | P2-T's indexes + `fieldOverrides`, deployed **before** the functions of groups A and B | The emulator hides a missing index; a real project throws (memory: `firestore-index-query-gotcha`). |

Inherited and still binding for Phase 3: the resolver signature + the `product`
arm + the fixture gate in `paymentOptions.test.ts`, in one commit.

---

## 6. Ordered work list

| # | Item | Group | Blocks |
|---|---|---|---|
| 1 | **P2-A** seat helpers + `resource-exhausted` reason codes | **A** | everything |
| 2 | **P2-B** transactional `bookSession` | **A** | P2-J |
| 3 | **P2-C** `createDropInCheckout` capacity gate (blocker 2) | **A** | P2-L |
| 4 | **P2-D** webhook capacity re-check + refund | **A** | P2-L |
| 5 | **P2-E** `rebookSession` capacity + cutoff | **A** | — |
| 6 | **P2-F** guest duplicate-guard alignment | **A** | P2-J |
| 7 | **P2-G** retire the last increments; no-show stops corrupting holds | **A** | — |
| 8 | **P2-H** data model, paths, activity flag, settings | — | all below |
| 9 | **P2-T** rules + indexes + `fieldOverrides` (deploy first) | **C** | P2-I…P2-S |
| 10 | **P2-I** `joinWaitlist` | — | P2-J |
| 11 | **P2-J** `promoteWaitlist` transaction + trigger | **B** | P2-K |
| 12 | **P2-K** `claimWaitlistSeat` (blocker 3) | **B** | P2-R |
| 13 | **P2-L** `createDropInCheckout({ waitlistToken })` | **B** | P2-R |
| 14 | **P2-M** full-cover flip + remove the `waitlistEntryId` rider (blocker 1) | **B** | — |
| 15 | **P2-N** `sweepWaitlistOffers` hourly | — | — |
| 16 | **P2-O** leave / list / session-cancel teardown | — | — |
| 17 | **P2-P** notifications + the `isWithinSmsSendingHours` lift | — | — |
| 18 | **P2-Q** public UI: join + `sessionBlockReason` reorder | — | — |
| 19 | **P2-R** public UI: the claim page + route contract | — | — |
| 20 | **P2-S** admin UI: session detail, day sheet, manifest, settings | — | — |
| 21 | **P2-U** i18n, all four locales | — | — |
| 22 | **P2-V** plan gate | — | — |
| 23 | **P2-W** docs | — | — |

---

## 7. Explicitly out of scope

| Item | Reason |
|---|---|
| Waitlists on appointment availability windows | A different primitive — nothing exists until booked. `docs/product-strategy.md` "Slot waiting list". |
| A per-session `waitlist_enabled` override | It is what created the fan-out/backfill problem (§0.3(b)). Add later as an optional override that wins when present. |
| Re-queueing a lapsed offer to the tail (`queue_key`, `offer_count`, `maxOffers`) | Critique #18. One offer per entry; the person re-joins. |
| Admin "book directly" (`force: true`) | A second capacity-writing path for a workflow the existing booking surfaces serve. |
| Deferred SMS after quiet hours | A fourth sweep pass with its own idempotency marker; §2's window anchoring plus the always-sent email covers it. |
| Push notification of an offer | Push is not shipped for reminders (CLAUDE.md). Never build a claim window on a channel that does not exist. |
| Promo code at join | Cross-cutting §3 — joining snapshots nothing about money. Phase 3 adds the field to the claim page only. |
| A waiver gate at join | Cross-cutting §4 — advisory at join, enforced at claim, Phase 4. |
| `canCreateContact` on the join path | `bookSession` and `createDropInCheckout` do not apply it either, and provisional contacts do not count toward the cap by design. Applying it here alone would be inconsistent. Tracked as a Wave-3-wide follow-up; P2-I's rate-limit bucket, queue cap and `provisional_expires_at` bound the new vector. |
| `connect_checkout_attempts` retention | Unbounded but harmless; carried over from Phase 1. |
| Any waitlist arm in `resolvePaymentOptions` | Invariant 1. The claim is a normal drop-in resolution. |

---

## 8. Hooks Phase 2 must leave for Phases 3 and 4

1. **The claim page is the one surface that resolves money for a waitlisted
   seat.** Phase 3 adds a promo field to it and nothing else; `createDropInCheckout`
   already takes `giftCardCode` and will take `promoCode` on the same call.
2. **`countHoldingSeats` / `seatsFree` / `seatFreedEdge`** join
   `bookingHoldsSeat` / `isExpiredWaitlistClaim` / `appointmentSlotBlocked` /
   `isPastBookingCutoff` as the seat-and-time family in
   `shared/src/types/session.ts`. Phase 4's waiver gate must not re-derive
   capacity.
3. **The transactional commit boundary in `bookSession`** (P2-B) is the single
   point Phase 4's waiver acceptance write hangs on: refuse before contact
   creation (`booking/index.ts:783`ff), write after the booking commits.
4. **`details: { reason }` on every capacity and rate-limit refusal** (P2-A) is
   the vocabulary the claim page, the booking form and Phase 3's promo errors all
   render.
5. **`commitGiftCardDrawdown` keeps `promoRedemptionId` and loses
   `waitlistEntryId`** (§0.3(c)). Phase 3 must place its commit *after* the money
   moves; Phase 2 proves that seam is wrong for anything that must be atomic with
   the booking.

---

## 9. Whole-phase verification checklist

Every line is a gate.

- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm build`.
- [ ] `pnpm test` — `booking/sessionHolds.test.ts` covers `countHoldingSeats`,
      `seatsFree`, `seatFreedEdge` and the claim-hold branch of
      `bookingHoldsSeat`; `sendBookingReminders.test.ts` still passes after the
      `isWithinSmsSendingHours` lift.
- [ ] **BLOCKER 1**: a full-cover gift-card claim, then a forced sweep past
      `offer_expires_at` → booking untouched, balance untouched, entry `claimed`.
      Repeat with an `admin_comp` card.
- [ ] **BLOCKER 2**: `createDropInCheckout` on a full class → `resource-exhausted`
      with `reason: 'session_full'`, no booking, no gift-card hold, no Stripe
      session.
- [ ] **BLOCKER 3**: two concurrent `claimWaitlistSeat` calls with one token →
      one seat, exactly one credit spent.
- [ ] No `FieldValue.increment` on `bookings_count` remains anywhere:
      `grep -rn "bookings_count: FieldValue.increment" packages/functions/src` is
      empty, and so is the `apps/web` equivalent.
- [ ] Two concurrent `bookSession` calls on a 1-seat class → exactly one wins.
- [ ] `rebookSession` into a full class is refused; into a past-cutoff class is
      refused.
- [ ] A drop-in hold on a class that ended yesterday survives
      `markNoShowBookings` untouched, and the contact's
      `pending_bookings_count` never goes negative across
      join → offer → claim → cancel.
- [ ] A paid claim's Stripe session `expires_at` **equals** `claim_expires_at`,
      and a claim with under 31 minutes left is refused with
      `claim_window_too_short`.
- [ ] A seat freed inside the cutoff window (under 35 minutes of usable window)
      produces **no** offer and shows as free on the day sheet.
- [ ] A seat freed at 23:10 for a class the next evening: email sent immediately,
      no SMS, window opens at 08:00 local.
- [ ] The promotion trigger fires twice for one cancellation and still produces
      exactly one offer.
- [ ] Raising `max_participants` by 3 with 3 waiters produces 3 offers in one pass.
- [ ] All four `messages/*.json` have identical key sets in `PublicBooking`,
      `Waitlist`, `SessionDetail`, `Manifest`, `Sessions`, `Activities`,
      `SettingsBooking`.
- [ ] Every client write to `sessions/{id}/waitlist/**` is denied by the rules
      emulator, including from a `schedule.manage` holder.
- [ ] The `entry_token` and `offer_token` collection-group lookups are verified
      **against `linyup-sandbox`**, not the emulator.
- [ ] A team downgraded to `free` can still claim an outstanding offer; a new
      join is refused.
