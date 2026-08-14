# Appointments (1:1) — architecture

An appointment is **a booking of a provider's exclusive time**, as opposed to a
class, which is **a seat in a scheduled event**. That's the whole distinction —
they are not different entities. Both are `sessions/{id}` docs; `activityType`
(`'class' | 'appointment'`) says which, and `Activity.type` says which scheduling
mechanism an offering uses:

| | **Class** | **Appointment** |
|---|---|---|
| The unit | a scheduled event with N seats | a provider's exclusive time |
| Exists before booking? | **yes** — the studio schedules it onto the calendar | **no** — availability is published; the session is created *at booking* |
| Constraint | seats remaining | provider not double-booked (overlap check) |
| Time chosen by | the studio | the client, from published availability |
| Created via | Schedule → "New session" | client books from availability (`bookAppointment`) |

Everything else — provider, capacity, price — is an ordinary field both kinds
carry, **not** something implied by the type. One deliberate asymmetry: classes
have an **access rule** (`open`/`members`/`subscription`, plus the independent
`trialEnabled` and `dropIn` toggles), while appointments have **none** — for an
appointment, **the price is the gate** (see "Paid appointments").

## The two halves: the *what* and the *when*

This split is the core of the model. Get it wrong and nothing else makes sense.

- **`Activity` (type `'appointment'`) owns the *what***: name, `durations`
  (the lengths a client may book — a "Technique Assessment" is 60 minutes wherever
  it's offered — each carrying an optional **base price**), the ONE
  **`memberBenefit`** rule (see "Paid appointments" below), and
  `confirmationInstructions`. There is deliberately NO capacity field: an
  appointment is a provider's *exclusive* time, so one booking per slot is the
  definition, not a setting (the materialised session carries
  `max_participants: 1` for the recount trigger). And there is NO `accessRule`:
  appointments dropped the access gate in 2026-07 — the field still exists on
  `Activity` because classes use it, but appointment forms don't show it and
  appointment booking paths don't read it. Because appointments are activities,
  they are listed on the website and countable in analytics **exactly like
  classes** — no special-casing.
- **`availability/{id}` (`Availability`) owns only the *when***: `providerId`,
  `title` (the SCHEDULE's admin-facing name — "Saturday mornings" — *not* the
  offering's name), `recurrence.daysOfWeek` + `startDate`/`endDate`,
  `bufferMinutes`, and **`activityIds: string[]`** — which appointment activities
  are bookable in this window. Durations are **never** configured here; they derive
  from the linked activities.

Two entry styles, both **lazy**:

| `mode` | Fields | Meaning |
|---|---|---|
| `'range'` | `window: {start,end}` + `granularityMinutes` | "I'm free 9–12; pick a start on the grid" |
| `'times'` | `times: string[]` | "I offer exactly 19:30 and 20:15" |

> **Why nothing can be pre-generated.** If a window offers a 30-min *and* a 90-min
> activity, the 9:00 slot is **indeterminate** — it isn't one session until the
> client picks the activity. Multi-activity availability is therefore incompatible
> with pre-materialisation. This is *why* the model is lazy; it isn't a preference.

## Booking flow

`packages/functions/src/appointments/window.ts` — two public callables:

- **`listAvailability`** `{ teamId, providerId?, activityId?, days? }` — pure
  compute, no writes. Reads active `availability` docs, resolves their linked
  `type: 'appointment'` activities, and enumerates free starts **per activity**
  (its `durations` drive the grid), minus the provider's booked sessions
  expanded by `bufferMinutes` (busy = `appointmentSlotBlocked`, so an expired
  payment hold doesn't block). Returns coach-first:
  `coaches[] → { providerId, providerName, activities: [{ activityId, activityName, durations, memberBenefit, location, onlineUrl, days: [{ dayMs, slotsByDuration }] }] }`
  where `durations` is the priced menu `[{ minutes, priceAmount }]` and
  `memberBenefit` is the activity's rule, verbatim — the picker runs the SAME
  shared resolver the server uses (`resolvePaymentOptions`, `kind:
  'appointment'`, optimistic client snapshot) to show a verified member their
  price (public-safe: the type ids are already public in the shop; the server
  re-resolves at booking). Days are merged across a provider's several
  schedules; when schedules disagree on location, the first contributor's is
  shown (booking resolves the real one).
- **`bookAppointment`** `{ teamId, providerId, activityId, startMs, durationMinutes, …contact }` —
  the **free-path** booking callable. The client sends **no** `templateId`: the
  server resolves which active availability covers that start (day-of-week, date
  range, window/grid or explicit time), which is both simpler and unspoofable.
  It validates `durationMinutes` against the activity's `durations` and applies
  **the price gate — the only gate** (there is no access check): when the
  caller's effective price is an amount it refuses with `failed-precondition
  { reason: 'payment_required', priceAmount }` (the client routes to
  `createAppointmentCheckout`); when it's free it creates the session and its
  `confirmed` booking in one transaction (an `included` benefit via a
  credit-pack type spends a credit).
- **`createAppointmentCheckout`** — the **paid path**
  (`appointments/checkout.ts`); see "Paid appointments" below.

The materialised session **inherits from the activity**: `activityId`,
`activityName`, `autoConfirm` (plus a fixed `max_participants: 1`) — but **no
`accessRule`**, which appointment session docs and mirrors stopped carrying;
`location`/`onlineUrl` come from the matched availability; `templateId` points
back at it; `origin: 'window'`.

**Overlap safety (first-come-first-served)** — two layers in one transaction:
1. a **deterministic id** `apt_{providerId}_{startMs}` so two bookings for the same
   provider+start collide on one doc (a `cancelled` doc at that id is reusable);
2. an **in-transaction range query** over the provider's sessions to catch
   *overlapping different* starts, buffer-expanded.

**No access gate.** Appointments have no access rule — THE PRICE IS THE GATE
(see "Paid appointments"). The class access gate (`booking/access.ts`) is
untouched for `bookSession`; what the two paths share is the **held-types
computation**: the appointment paths build the same contact snapshot
(`loadContactPaymentContext`) the class coverage gate uses, but resolve it
against `memberBenefit.subscriptionTypeIds` — so credit packs keep spending a
credit on an `included` booking. (History: the 2026-07 activity-bound refactor initially
gave appointments the class access gate; a persona test showed it produced the
"who pays base price if only Premium can book?" paradox, and it was dropped the
same month — while the old generator model before the refactor couldn't gate at
all, since its slots carried no `activityId`.)

**`bookSession` is class-only.** It rejects `activityType === 'appointment'` — no
open appointment sessions exist to book. Class-side, `accessRule` still means
"who books FREE", with two independent toggles alongside it: `trialEnabled` (a
gated class still accepts a newcomer's guest trial via the open-tier path) and
`dropIn` (uncovered contacts pay per class). **`cancelBooking` still handles
both kinds**: an appointment cancel flips the session to `status: 'cancelled'`
(unpublishing it via the sync gate) and frees the provider's time, which
reappears in `listAvailability`.

## Paid appointments

A duration can carry a price; a client whose effective price is an amount books it
by paying up front through Stripe Connect — the same rail as the class drop-in
(`docs/payment-contact-studio.md`), but **not** the class `dropIn` config, which
stays class-only. Appointments price the duration itself.

### The pricing model — base price per duration, ONE benefit rule per activity

The coach sells TIME, so the base price is per duration; the member benefit is
ONE rule for the whole activity — never per duration, never per type-×-duration
(`packages/shared/src/types/activity.ts`):

```ts
durations: [
  { minutes: 30, priceAmount: 45 },   // base price, major units
  { minutes: 60, priceAmount: 85 },   // null/absent = unpriced → free for anyone
]
memberBenefit: {                      // the ONE rule — optional
  subscriptionTypeIds: ['sub-elite', 'sub-premium'],
  kind: 'included',                   // or 'discount' + discountPercent: 20
}
```

- **The benefit is data, never implied — but it is now ONE rule.** Holders of
  any listed type: `kind: 'included'` → every priced duration is free (a
  credit-pack type spends a credit); `kind: 'discount'` → `discountPercent` off
  every priced duration. **Absent `memberBenefit` = no benefit** — everyone,
  subscribers included, pays base. (History: until 2026-07 this was a
  per-duration × per-subscription-type `subscriptionPricing` matrix, plus a form
  that pre-filled entries from the access rule; the persona test showed the
  algebra confused real coaches, and it was cut for this one rule.)
- **Effective price for a caller** — the appointment arm of the ONE shared
  coverage/quote resolver (`resolvePaymentOptions(snapshot, { kind:
  'appointment', duration, benefit }, context?)` in
  `packages/shared/src/utils/paymentOptions.ts`, pure + fixture-tested — the arms
  are class bookings, drop-ins, appointments, courses **and products**, and the
  optional third `context` carries a typed promo code: `docs/promo-codes.md`), in
  order: unpriced → `covered` for anyone; priced + no held benefit type →
  `pay(base)` (guests always land here); priced + held + `included` →
  `covered` (or `spend_credits` when held via a pack); priced + held +
  `discount` → `pay(max(0.50, round(base × (100 − pct) / 100)))` — clamped to
  Stripe's **0.50 minimum-charge floor**, never "free via discount" (a
  `discountPercent` ≥ 100 clamps to 0.50; missing/≤ 0 falls back to base).
  A promo code competes with the benefit inside this same call, best-one-wins,
  and can only ever lower the result. Server-side resolution (snapshot via
  `loadContactPaymentSnapshot`) is authoritative — the picker runs the same
  resolver on an optimistic client snapshot for display only.

### The price is the gate — there is no access gate

An appointment has **no** access rule. Unpriced duration → **anyone books
free**, guests included. Priced → **anyone books by paying their effective
price**; holding a benefit type just lowers (or zeroes) that price. Sign-in is
never a requirement — the picker offers it purely as "have a subscription? sign
in to get your member price."

Bypass-proof in both directions: `bookAppointment` refuses a payable caller with
`{ reason: 'payment_required', priceAmount }`; `createAppointmentCheckout`
charges the CALLER's effective amount (base or discounted) and refuses with
`{ reason: 'covered' }` when the caller's effective price is free (the client
falls back to the free path) and `{ reason: 'not_priced' }` when the duration
has no price at all. The refusal shapes are unchanged from the matrix era.

### The hold state machine — the hold IS the session

An appointment session doesn't exist until booked, so a payment must first reserve
the slot: `createAppointmentCheckout` creates the session *as* the hold, through
the same overlap-safe slot transaction the free path uses (a retry by the same
contact rewrites its own still-live hold and gets a fresh Checkout URL).

```
(none)          --createAppointmentCheckout tx--> status:'pending_payment', hold_expires_at:+30min, bookings_count:1
pending_payment --webhook confirm---------------> status:'full', hold_expires_at deleted
pending_payment --hold_expires_at <= now--------> logically FREE (lazy); swept to 'cancelled'
pending_payment --admin cancel------------------> 'cancelled' (a late payment re-acquires or refunds)
```

Booking subdoc: `{ status:'pending', payment_status:'required', expires_at }` — no
`fullname` (that's stamped only on confirm) → webhook → `{ status:'confirmed',
payment_status:'paid', payment_intent_id, fullname }`.

The slot-blocking predicate is centralised in `packages/shared/src/types/session.ts`
— `appointmentSlotBlocked(s, nowMs)` / `isExpiredAppointmentHold` — and consumed by
`listAvailability`'s busy filter, both branches of the slot transaction, and the
admin calendar. A hold whose `hold_expires_at` has passed stops blocking the slot
immediately (**lazy expiry** — release never waits for a cleaner). The cleaners
converge on the same end state:

1. **Lazy** — readers treat expired holds as free; when the slot transaction
   reclaims an expired/foreign hold it deletes stale `payment_status: 'required'`
   booking subdocs in the same transaction (else the next recount counts 2).
2. **`checkout.session.expired`** — Stripe expires the Checkout at ~31 minutes
   (7 days for a staff payment link); the webhook cancels a still-pending hold
   **that this session still owns** (session first, then the booking delete). See
   the census below: it may not cancel on presence.
3. **Daily sweep** — `expirePendingBookings` cancels expired held sessions before
   its existing bookings sweep, session first THEN booking delete, so the
   delete-triggered recount preserves `cancelled` instead of recomputing `open`.
   Composite index: `sessions (status ASC, hold_expires_at ASC)`.

Hold consumers to know about: `trackBookings` **early-returns** on
`pending_payment` sessions (else the hold's own booking write would recompute the
status and clobber the hold), and `syncSessionPublicProfile` excludes them —
**holds are never published publicly**.

### Who may release a hold — the census, and the ONE ownership rule

The session's doc id is deterministic (`apt_{providerId}_{startMs}`) and therefore
**shared by every attempt at that slot** — which is exactly what lets the slot
transaction refuse a second visitor. The cost is that "cancel the session at this
id and delete the booking under it" is an operation any attempt can perform on
**any other attempt's live, payable hold**. *Presence is not ownership.*

This was fixed once per site, from different files, and the last site was missed
twice — so the census now lives in code, beside the rule, in
**`packages/functions/src/appointments/holdRelease.ts`**.

> **THAT HEADER OWNS THE CENSUS. This document does not repeat it**, and the
> omission is the point: this page carried a copy of the table for two rounds,
> and a copy of a list is a second thing to keep true. It lists every site that
> can release, cancel or delete a hold, the proof each one rests on, and the grep
> recipe for re-deriving it. `connect/commitSites.test.ts` asserts that no caller
> of the shared executor exists without an entry there. **Read that header before
> adding a release path**, and add the entry in the same commit.

What you need from it to read the rest of this page: the sites that address a
hold by its shared id while another attempt may own it go through **one call
each** to `releaseAppointmentHold`, which proves ownership with `booking_token`
inside the transaction that deletes. Two secondary proofs carry the callers that
have no token to compare — a **lapsed deadline**, and a document that **still
presents no deadline at all** (the staff payment-link rail, which writes none so
the daily sweep leaves its 7-day link alone). A token never leaves a caller worse
off than no token: where there is nothing to compare it against, a token-holder
falls to exactly those two proofs, which is what stops a deadline-less staff hold
being stranded forever. Fixtures, one block per site:
`packages/functions/src/appointments/holdRelease.test.ts`.

**Why `handleCheckoutExpired` was the urgent one.** Wave 3 Phase 3's promo
lifecycle expires a superseded Checkout Session *at Stripe* before writing
anything, so `checkout.session.expired` for an attempt the buyer has just retried
now arrives **seconds** after the retry instead of ~31 minutes later. A rare race
became a likely one — and it was the release site still cancelling on presence.

### Webhook confirmation (`kind: 'appointment'`)

`handleAppointmentCheckout` (`connect/webhook.ts`), cases in order:

1. Booking already `confirmed` under a **different** `payment_intent_id` → the
   second charge is a duplicate → `refundDirectCharge` (idempotency key
   `apt-dup:{pi}`) + `member_payments/{pi}` marked refunded. (Also the idempotent
   short-circuit for redeliveries of the same charge.)
2. Live hold → **confirm in place**: session `{ status:'full', hold_expires_at:
   delete }`, booking `{ confirmed, paid, payment_intent_id, fullname }`.
3. Hold expired or session cancelled (swept, admin-cancelled, Stripe-expired) →
   **re-acquire** through the same slot transaction, rebuilding from the swept
   doc's own fields (never from metadata); conflict — slot retaken — → refund.
4. Session missing entirely → refund.

Post-confirm: the contact's `provisional` flag clears, `member_payments/{pi}`
(`kind: 'appointment'`, `sessionId`) is written with the platform fee, the finance
contact is stamped, an `appointment_booked` activity_log entry lands, and the same
booking emails as a free booking go out — from the webhook, since payment is when
the booking becomes real.

### Gotchas

- **Payment auto-confirms even when `autoConfirm: false`.** A paid booking is
  written `confirmed` regardless of the activity's `autoConfirm` — the drop-in
  precedent: payment *is* the confirmation. Documented, deliberate.
- **The OTP verification code burns at checkout creation**, not at payment
  (`resolveAppointmentCaller` marks it used, single-use). An abandoned checkout
  therefore needs a fresh code for the member's next attempt.
- **30 vs 31 minutes.** The Firestore hold lives 30 minutes; the Stripe Checkout
  `expires_at` is set to **31** because Stripe's minimum is 30 minutes from the
  moment the create call *lands*. That extra minute used to be clock-skew slack
  with nothing happening inside it; since Wave 3 Phase 3 it is a **work budget**
  — the reserves and the hold transaction all run inside it — and
  `assertCheckoutWindowPayable` refuses a checkout that overspends it. The
  instant itself comes from `resolveCheckoutHoldWindow`
  (`connect/checkout.ts`), never from a local constant.
- **Stripe-create failure after the hold** is caught, and the release is
  **ownership-checked, not best-effort-on-presence**: it goes through
  `releaseAppointmentHold`, which cancels the session and deletes the booking
  only when this attempt still owns the hold. A hold that has been rewritten by
  a newer attempt is left alone; a leaked one self-heals via lazy expiry.
- **Mobile stays free-path.** The app books via `bookAppointment` only; a caller
  whose effective price is an amount gets the `payment_required` refusal (no
  mobile checkout surface yet).

## Mirrors

| Doc | Discriminator | Publish gate |
|---|---|---|
| `sessions/{id}/public_profile/{id}` | `type: 'appointment_session'` (classes: `'session'`) | appointment: `status !== 'cancelled' && status !== 'pending_payment'` (payment holds are never published) · class: `allowBooking === true` |
| `activities/{id}/public_profile/{id}` | `activityType: 'appointment'` | `isActive !== false` |

Since only **booked** appointments have a session, the only `appointment_session`
mirrors that exist are already full — which is why the public site's schedule
section lists **classes only**. Appointments reach the public as *activity* cards
that route to the picker. Appointment `appointment_session` mirrors carry **no
`accessRule`** (dropped with the access gate, `syncSessionPublicProfile`).

The activity mirror (`syncActivityPublicProfile`) carries the duration menu
`durations: [{ minutes, priceAmount }]` **and `memberBenefit`, both verbatim** —
there is no per-contact data to strip any more (the old `subscriptionPricing`
matrix is gone), and the benefit is public-safe since the referenced
subscription-type ids are already public in the shop. Public cards can show
"from CHF 45"; the picker itself never reads the mirror — it gets the same
shape from `listAvailability`.

## Where appointments appear

| Surface | Behaviour |
|---|---|
| Admin **Schedule** | Booked appointments render like any session; the **Classes / Appointments / Events** filter shows/hides them. Clicking one opens `AppointmentDetail` (bookings roster + cancel), not the session edit form. A `pending_payment` hold renders **ghosted** (dimmed, dashed border) with an amber **"Awaiting payment"** badge; an expired-but-unswept hold renders as cancelled. Cancelling a hold is safe — a late payment re-acquires the slot or refunds. |
| Admin **availability** | Schedule → "+ New entry" → *Appointment availability* (`AppointmentAvailabilityDialog`): list/create/edit/pause schedules, pick their activities. No dedicated admin route. |
| Public picker | `/public/{slug}/appointments` — coach → activity → duration (if >1) → day → time. 100% `listAvailability`; reads no Firestore directly. Priced durations show on the chips ("45 min · CHF 65") and route to `createAppointmentCheckout`. No gate: guests always book (pay if priced); when the activity has a `memberBenefit`, sign-in is offered — "have a subscription? sign in to check your price" — and after OTP the member sees their effective price (display-only, the server re-resolves). |
| Public site / booking flow | Appointment **activity** cards route to the picker. The schedule section is classes-only. |
| Kiosk schedule / Now-Next | Booked appointments shown — the front desk sees the day's 1:1s. |
| Kiosk walk-in | **Not offered.** Walk-in needs a discrete open slot, which no longer exists. Removed 2026-07; re-addable on `listAvailability` if wanted. |
| Drop-in | Rejected for appointments (`booking/dropIn.ts`) — `dropIn` is class-only config. Paid appointments have their own path: per-duration prices + `createAppointmentCheckout` (see "Paid appointments"). |

## Seeds

All four seeds (`seed-emulator`, `seed-sandbox`, `seed-staging`, `seed-lead`) create
an appointment activity (with a priced `durations` menu), one or more
`availability` docs, and a few **booked** appointments — never open slots, since
nothing is pre-generated. Shared builders live in `scripts/lib/appointments.ts` so
every seed emits the shape `bookAppointment` would (no `accessRule`/`isFreeTrial`
on appointment session docs or mirrors). Both `memberBenefit` kinds have demo
data: **emulator + staging** seed `kind: 'included'` (the top tier books free —
Monthly on coach, Elite on studio/org), **sandbox** seeds `kind: 'discount'`
(monthly holders get 20% off every priced duration). Each generic seed also
gates ONE class with the full ordinary offer — subscription access +
`trialEnabled` + `dropIn` (MMA in emulator/staging, Advanced BJJ in the sandbox
grappling team) — and none seeds a "Drop-in" subscription PLAN any more (the
per-activity `dropIn` price is the one drop-in concept). Seeded **booked**
appointments are always free-path-shaped (`confirmed`, no payment fields): paid
bookings are not seeded, as that would require fabricating `member_payments`
ledger rows. Swimli (`scripts/leads/swimli/profile.ts`) is the richest: 3
providers, both `times` and `range` schedules, and a credit-pack `included`
benefit on the private lesson; nicole's paid 1:1 deliberately has NO benefit
(everyone pays base) while her free intro call stays unpriced.

## History / gotchas

- **2026-07 — the big one.** Appointments were "coaching": a parallel model with its
  own `coachId`, its own counters, and a daily cron that pre-generated 28 days of
  fixed slots. That generator had **no teardown** (pausing a template orphaned its
  slots) and set **no `activityId`**, so appointments were invisible to the website
  and impossible to subscription-gate. All of it was deleted in favour of the lazy,
  activity-bound model above. If you're tempted to re-add pre-generation, re-read
  "Why nothing can be pre-generated".
- **2026-07, later the same month — "the price is the gate".** The initial paid
  model gave appointments the class access gate plus a per-duration ×
  per-subscription-type `subscriptionPricing` matrix. A coach persona test
  showed both confused real users, so appointments dropped `accessRule` entirely
  and the matrix collapsed into the ONE `memberBenefit` rule (see "Paid
  appointments"). Session docs and appointment mirrors stopped carrying
  `accessRule` in the same pass; classes gained the independent `trialEnabled`
  toggle, and the seeded "Drop-in" subscription plan was removed in favour of
  the per-activity `dropIn` price.
- `instructorId`/`coachId` were unified into **`providerId`** across sessions,
  activities and availability. `Event.coachId` is a different entity and unchanged.
- The kiosk `walkInActivityIds` allowlist matches on `activityId`. Appointments now
  carry one, but walk-in still excludes them by kind — it's about the absence of open
  slots, not the allowlist.
