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

Everything else — provider, capacity, access rule, price — is an ordinary field
both kinds carry, **not** something implied by the type.

## The two halves: the *what* and the *when*

This split is the core of the model. Get it wrong and nothing else makes sense.

- **`Activity` (type `'appointment'`) owns the *what***: name, `durations`
  (the lengths a client may book — a "Technique Assessment" is 60 minutes wherever
  it's offered — each carrying an optional **per-duration price** and explicit
  **per-subscription-type member pricing**; see "Paid appointments" below),
  `accessRule`, `confirmationInstructions`. There is deliberately NO
  capacity field: an appointment is a provider's *exclusive* time, so one booking
  per slot is the definition, not a setting (the materialised session carries
  `max_participants: 1` for the recount trigger). Because appointments are
  activities, they are listed on the website, gateable by subscription, and
  countable in analytics **exactly like classes** — no special-casing.
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
  `coaches[] → { providerId, providerName, activities: [{ activityId, activityName, durations, accessRule, location, onlineUrl, days: [{ dayMs, slotsByDuration }] }] }`
  where `durations` is the **full priced menu** `[{ minutes, priceAmount,
  subscriptionPricing }]` — the picker needs `subscriptionPricing` to show a
  verified member their effective price (the server re-resolves at booking).
  Days are merged across a provider's several schedules; when schedules disagree on
  location, the first contributor's is shown (booking resolves the real one).
- **`bookAppointment`** `{ teamId, providerId, activityId, startMs, durationMinutes, …contact }` —
  the **free-path** booking callable. The client sends **no** `templateId`: the
  server resolves which active availability covers that start (day-of-week, date
  range, window/grid or explicit time), which is both simpler and unspoofable.
  It validates `durationMinutes` against the activity's `durations`, applies
  **two gates in order** — the activity's ACCESS rule (shared gate, see below),
  then the PRICE gate: when the caller's effective price is an amount it refuses
  with `failed-precondition { reason: 'payment_required', priceAmount }` (the
  client routes to `createAppointmentCheckout`) — then creates the session and
  its `confirmed` booking in one transaction.
- **`createAppointmentCheckout`** — the **paid path**
  (`appointments/checkout.ts`); see "Paid appointments" below.

The materialised session **inherits from the activity**: `activityId`,
`activityName`, `accessRule` (plus a fixed `max_participants: 1`);
`location`/`onlineUrl` come from the matched availability; `templateId` points
back at it; `origin: 'window'`.

**Overlap safety (first-come-first-served)** — two layers in one transaction:
1. a **deterministic id** `apt_{providerId}_{startMs}` so two bookings for the same
   provider+start collide on one doc (a `cancelled` doc at that id is reusable);
2. an **in-transaction range query** over the provider's sessions to catch
   *overlapping different* starts, buffer-expanded.

**Access gate.** The gate is shared with `bookSession` (see
`packages/functions/src/booking/`) and reads the **activity's** `accessRule` —
so `subscription`-gated appointments and lesson credits work. This is only possible
because sessions carry an `activityId`; the pre-2026-07 generator didn't set one,
which is why appointments could not be gated at all back then.

**`bookSession` is class-only.** It rejects `activityType === 'appointment'` — no
open appointment sessions exist to book. **`cancelBooking` still handles both**: an
appointment cancel flips the session to `status: 'cancelled'` (unpublishing it via
the sync gate) and frees the provider's time, which reappears in `listAvailability`.

## Paid appointments

A duration can carry a price; a client whose effective price is an amount books it
by paying up front through Stripe Connect — the same rail as the class drop-in
(`docs/payment-contact-studio.md`), but **not** the class `dropIn` config, which
stays class-only. Appointments price the duration itself.

### The pricing model — the price lives on the duration

The coach sells TIME, so the price is per duration, on the activity
(`Activity.durations`, `packages/shared/src/types/activity.ts`):

```ts
durations: [
  { minutes: 30, priceAmount: 45 },          // base/walk-in price, major units
  {
    minutes: 60,
    priceAmount: 85,
    subscriptionPricing: [                    // the EXPLICIT member benefit
      { subscriptionTypeId: 'sub-elite',   priceAmount: null }, // INCLUDED → holders book free
      { subscriptionTypeId: 'sub-premium', priceAmount: 60 },   // member price
    ],
  },
]
```

- **Unpriced** (`priceAmount` null/absent, no entries): the free path — exactly the
  pre-payment behaviour, the access rule alone decides.
- **The member benefit is data, never implied.** `priceAmount: null` in
  `subscriptionPricing` = INCLUDED (holders book free; a credit-pack type spends a
  credit), a number = the member price, and an **absent entry = holders of that
  type pay base**. A priced duration with no entries costs base for everyone,
  subscribers included. The activities form pre-fills INCLUDED entries for the
  accessRule's covering subscription types when a price is first set — so "my
  subscribers book free" is the default the admin *sees*, while remaining explicit
  data they can change.
- **Effective price for a contact** = the LOWEST of the base price and every entry
  whose type the contact holds; INCLUDED beats any amount
  (`resolveEffectiveAppointmentPrice`, shared + unit-tested). Guests always pay
  base. Server-side resolution is authoritative — the picker mirrors the math for
  display only.

### Access vs price — two separate gates, in order

1. **ACCESS** (unchanged): `open` → anyone; `members` → joined contacts;
   `subscription` → holder of a covering type. **Guests may pay their way into
   gated tiers** — the drop-in precedent: payment is proof — so the checkout
   callable applies coverage only to compute the price, never as a refusal.
2. **PRICE**: unpriced duration → free path. Priced → the caller's effective
   price decides: free/INCLUDED → free path (credit packs spend a credit exactly
   as before); an amount → checkout at THAT amount.

Bypass-proof in both directions: `bookAppointment` refuses a payable caller with
`{ reason: 'payment_required', priceAmount }`; `createAppointmentCheckout` refuses
with `{ reason: 'covered' }` when the caller's effective price is free (the client
falls back to the free path) and `{ reason: 'not_priced' }` when the duration has
no price at all.

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
immediately (**lazy expiry** — release never waits for a cleaner). Three cleaners
converge on the same end state:

1. **Lazy** — readers treat expired holds as free; when the slot transaction
   reclaims an expired/foreign hold it deletes stale `payment_status: 'required'`
   booking subdocs in the same transaction (else the next recount counts 2).
2. **`checkout.session.expired`** — Stripe expires the Checkout at ~31 minutes;
   the webhook promptly cancels a still-pending hold (session first, then the
   booking delete).
3. **Daily sweep** — `expirePendingBookings` cancels expired held sessions before
   its existing bookings sweep, session first THEN booking delete, so the
   delete-triggered recount preserves `cancelled` instead of recomputing `open`.
   Composite index: `sessions (status ASC, hold_expires_at ASC)`.

Hold consumers to know about: `trackBookings` **early-returns** on
`pending_payment` sessions (else the hold's own booking write would recompute the
status and clobber the hold), and `syncSessionPublicProfile` excludes them —
**holds are never published publicly**.

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
  `expires_at` is set to **31** because Stripe's minimum is 30 minutes from
  creation and an exact 30 risks rejection on clock skew.
- **Stripe-create failure after the hold** is caught: best-effort release
  (session → `cancelled`, booking deleted); a leaked hold self-heals via lazy
  expiry anyway.
- **Mobile stays free-path.** The app books via `bookAppointment` only; a priced,
  uncovered caller gets the `payment_required` refusal (no mobile checkout surface
  yet).

## Mirrors

| Doc | Discriminator | Publish gate |
|---|---|---|
| `sessions/{id}/public_profile/{id}` | `type: 'appointment_session'` (classes: `'session'`) | appointment: `status !== 'cancelled' && status !== 'pending_payment'` (payment holds are never published) · class: `allowBooking === true` |
| `activities/{id}/public_profile/{id}` | `activityType: 'appointment'` | `isActive !== false` |

Since only **booked** appointments have a session, the only `appointment_session`
mirrors that exist are already full — which is why the public site's schedule
section lists **classes only**. Appointments reach the public as *activity* cards
that route to the picker.

The activity mirror carries a **stripped** duration menu — `durations:
[{ minutes, priceAmount }]`, `subscriptionPricing` removed
(`syncActivityPublicProfile`) — so public cards can show "from CHF 45" without
exposing member pricing, which is per-contact data. The picker itself never reads
the mirror for prices; it gets the full shape from `listAvailability`.

## Where appointments appear

| Surface | Behaviour |
|---|---|
| Admin **Schedule** | Booked appointments render like any session; the **Classes / Appointments / Events** filter shows/hides them. Clicking one opens `AppointmentDetail` (bookings roster + cancel), not the session edit form. A `pending_payment` hold renders **ghosted** (dimmed, dashed border) with an amber **"Awaiting payment"** badge; an expired-but-unswept hold renders as cancelled. Cancelling a hold is safe — a late payment re-acquires the slot or refunds. |
| Admin **availability** | Schedule → "+ New entry" → *Appointment availability* (`AppointmentAvailabilityDialog`): list/create/edit/pause schedules, pick their activities. No dedicated admin route. |
| Public picker | `/public/{slug}/appointments` — coach → activity → duration (if >1) → day → time. 100% `listAvailability`; reads no Firestore directly. Priced durations show on the chips ("45 min · CHF 65") and route to `createAppointmentCheckout`; a verified member sees their effective price ("Your price: CHF 40" — display-only, the server re-resolves). |
| Public site / booking flow | Appointment **activity** cards route to the picker. The schedule section is classes-only. |
| Kiosk schedule / Now-Next | Booked appointments shown — the front desk sees the day's 1:1s. |
| Kiosk walk-in | **Not offered.** Walk-in needs a discrete open slot, which no longer exists. Removed 2026-07; re-addable on `listAvailability` if wanted. |
| Drop-in | Rejected for appointments (`booking/dropIn.ts`) — `dropIn` is class-only config. Paid appointments have their own path: per-duration prices + `createAppointmentCheckout` (see "Paid appointments"). |

## Seeds

All four seeds (`seed-emulator`, `seed-sandbox`, `seed-staging`, `seed-lead`) create
an appointment activity (with a priced `durations` menu), one or more
`availability` docs, and a few **booked** appointments — never open slots, since
nothing is pre-generated. Shared builders live in `scripts/lib/appointments.ts` so
every seed emits the shape `bookAppointment` would. The generic seeds carry the
MIXED pricing case — a base-price-only 30-min duration plus a 60-min duration whose
`subscriptionPricing` has one INCLUDED type and one member-priced type — so every
effective-price path has demo data. Seeded **booked** appointments are always
free-path-shaped (`confirmed`, no payment fields): paid bookings are not seeded, as
that would require fabricating `member_payments` ledger rows. Swimli
(`scripts/leads/swimli/profile.ts`) is the richest: 3 providers, both `times` and
`range` schedules, and a credit-pack INCLUDED entry on the standard 45-min lesson.

## History / gotchas

- **2026-07 — the big one.** Appointments were "coaching": a parallel model with its
  own `coachId`, its own counters, and a daily cron that pre-generated 28 days of
  fixed slots. That generator had **no teardown** (pausing a template orphaned its
  slots) and set **no `activityId`**, so appointments were invisible to the website
  and impossible to subscription-gate. All of it was deleted in favour of the lazy,
  activity-bound model above. If you're tempted to re-add pre-generation, re-read
  "Why nothing can be pre-generated".
- `instructorId`/`coachId` were unified into **`providerId`** across sessions,
  activities and availability. `Event.coachId` is a different entity and unchanged.
- The kiosk `walkInActivityIds` allowlist matches on `activityId`. Appointments now
  carry one, but walk-in still excludes them by kind — it's about the absence of open
  slots, not the allowlist.
