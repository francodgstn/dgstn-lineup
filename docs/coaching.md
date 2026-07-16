# Coaching (1:1 sessions) — architecture

Coaching is **integrated with sessions but books through its own flow**. A
coaching slot is not a separate entity: it IS a `Session`, distinguished by the
activity category, so it shows up everywhere sessions do (admin schedule,
public site calendar, kiosk wall). What differs is how slots are *created*
(availability templates, not manual scheduling) and how they're *booked*
(per-coach slot picker with auto-confirm, not the class calendar).

## Data model

| Piece | Where | Notes |
|---|---|---|
| Category discriminator | `Activity.type: 'group_class' \| 'coaching'` | `packages/shared/src/types/activity.ts`. Coaching activities also carry `coachId`/`coachName` (head coach for display). |
| Slot | `sessions/{id}` with `activityType: 'coaching'` | `CoachSlot` was merged into `Session`. Coaching-only fields: `templateId`, `coachId`, `coachName`, `max_participants` (usually 1), `bookings_count`, `isFreeTrial`, `status: 'open' \| 'full' \| 'cancelled'`. |
| Availability template | `coach_availability/{id}` (`CoachAvailability`) | Weekly recurrence (`daysOfWeek` + `HH:MM`, Europe/Zurich), duration, capacity, place. Managed from the **Schedule** page — the **Coaching availability** modal under "+ New entry" (`components/coaching/CoachingAvailability.tsx`); there is no dedicated admin coaching page. |
| Booking | `sessions/{id}/bookings/{contactId}` | Written by the shared `bookSession`. Coaching bookings carry `status: 'confirmed'` + `fullname` (the `CoachBooking` shape) — group-class bookings have NO status until the studio confirms them. |
| Public slot mirror | `sessions/{id}/public_profile/{id}` with **`type: 'coaching_session'`** | Group classes mirror as `type: 'session'`. Written by `syncSessionPublicProfile`; published while `status !== 'cancelled'` (group: while `allowBooking`). Carries coach + capacity fields; no `activityId`. |
| Public activity mirror | `activities/{id}/public_profile/{id}` (`type: 'activity'`) | Carries **`activityType`** (`'group_class' \| 'coaching'`) so public UIs can route coaching cards to the coaching flow. Written by `syncActivityPublicProfile`. |

## Slot generation

`packages/functions/src/coaching/index.ts`:

- `onCoachAvailabilityWritten` — regenerates a template's future slots when it's
  saved (the availability modal writes `coach_availability` directly; no callable needed).
- `generateCoachSlotsScheduled` — daily cron keeps the rolling window filled.
- `generateCoachSlots` — manual callable (team-member gated).

Generated slots start as `{ activityType: 'coaching', status: 'open',
bookings_count: 0, allowBooking: true }`.

## Booking flow (public)

There is **no `bookCoachSlot`** — booking and cancellation reuse the shared
callables, which branch on `activityType === 'coaching'`:

- **Surface**: `/public/{slug}/coaching` (`CoachingBioLink`) lists upcoming open
  slots from the `coaching_session` mirrors (`status == 'open'`), one card per
  coach × time; guests book inline (`isFreeTrial`), members via the OTP email
  code. The class-booking flow (`/public/{slug}/booking`) shows coaching
  activities as an enabled card with a "1:1 coaching" badge that **hands over**
  to `/coaching`; deep links (`/booking/{coaching-slug}`) redirect there. The
  website activities section routes its Book link the same way.
- **`bookSession`** (`packages/functions/src/booking/index.ts`), coaching branch:
  - access gate read from the session doc itself (`accessRule`/`isFreeTrial`),
    not the activity;
  - capacity gate on `status`/`bookings_count >= max_participants`;
  - booking doc written **auto-confirmed** (`status: 'confirmed'`, `fullname`) —
    a 1:1 slot has no roster-review step;
  - session counters updated inline: `bookings_count` +1 and `status: 'full'`
    when the slot fills (group classes use `bio_link_bookings_count` instead);
  - confirmation email with `.ics` invite + manage-booking link, and a
    notification to the coach.
- **`cancelBooking`** (token-based, from the emailed manage-booking link or
  `/public/{slug}/coaching/cancel?token=`): coaching's `'confirmed'` status is
  cancellable (group-class `'confirmed'` = checked-in stays locked); releases
  the slot (`bookings_count` −1, `status` back to `'open'` when it was full)
  and points the rebook CTA at `/coaching`.
- **`trackBookings`** (analytics trigger) recounts `status == 'confirmed'`
  bookings per coaching session and overwrites `bookings_count`/`status` — the
  inline counter writes above are the fast path; the trigger self-heals races.
- **Drop-in** is rejected for coaching (`booking/dropIn.ts`).

## Where coaching sessions appear (and don't)

| Surface | Behaviour |
|---|---|
| Admin **Schedule** (calendar + list) | Coaching slots render like any session, on both the calendar and list. A **Classes / Coaching / Events** type filter shows/hides them on both views (alongside the coach filter). Clicking a coaching slot opens `CoachingSlotDetail` (bookings roster + cancel), not the session edit form. |
| Admin coaching availability | Managed from the Schedule via the **Coaching availability** modal ("+ New entry" → *Coaching availability* → `CoachingAvailabilityDialog`): list templates, create/edit (fixed slots or open windows), pause/resume. There is **no dedicated `/coaching` admin route** — it was folded into the Schedule. |
| Public site schedule section | Included (`type in ['session','coaching_session']`); coaching blocks link to the public picker `/public/{slug}/coaching`. |
| Kiosk schedule / Now-Next | Included — the front desk sees private lessons. |
| Kiosk walk-in | **Excluded by default** — 1:1 slots are booked ahead. Per-studio opt-in via the kiosk setting `walkInCoaching` (Kiosk settings → Walk-in → "Include 1:1 coaching slots") offers OPEN slots for last-second booking; full/cancelled slots stay hidden. |
| Class booking flow | Coaching activity card routes to the public picker `/public/{slug}/coaching` (never lists slots itself). |

## Seeds

All four seeds (`seed-emulator`, `seed-sandbox`, `seed-staging`, `seed-lead`)
create a coaching activity (+`activityType: 'coaching'` on its mirror), one or
more availability templates, materialized slots with `coaching_session`
mirrors written directly (cloud sandbox has no triggers), and a sprinkle of
pre-booked (`full`) slots whose booking docs are `confirmed` with `fullname`.
Swimli is the richest example: 3 coaches × 4 weekly parallel slots
(`scripts/leads/swimli/profile.ts`, `buildPrivateLessonTemplates`).

## History / gotchas

- 2026-07: the class-booking flow used to dead-end on coaching activities
  ("No sessions available") because it only queried `type == 'session'` mirrors
  and activity mirrors didn't carry the category; `bookSession` incremented only
  `bio_link_bookings_count`, so coaching capacity was never enforced and slots
  never showed full; `cancelBooking` rejected coaching's `'confirmed'` bookings
  and never released the slot; the public cancel page called a nonexistent
  `cancelCoachBooking`. All fixed together — if you touch these paths, keep the
  two mirror discriminators and the counter semantics above in mind.
- The kiosk `walkInActivityIds` allowlist matches on `activityId`, which
  coaching mirrors don't carry — so the allowlist only ever governs group
  classes. Coaching's walk-in gate is the separate `walkInCoaching` toggle
  (`KioskConfig`, default `false`), checked explicitly in `WalkIn.tsx`.
