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

- **`Activity` (type `'appointment'`) owns the *what***: name, `durationsMinutes`
  (the lengths a client may book — a "Technique Assessment" is 60 minutes wherever
  it's offered), `accessRule`, `confirmationInstructions`. There is deliberately NO
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
  (its `durationsMinutes` drive the grid), minus the provider's booked sessions
  expanded by `bufferMinutes`. Returns coach-first:
  `coaches[] → { providerId, providerName, activities: [{ activityId, activityName, durationsMinutes, accessRule, location, onlineUrl, days: [{ dayMs, slotsByDuration }] }] }`.
  Days are merged across a provider's several schedules; when schedules disagree on
  location, the first contributor's is shown (booking resolves the real one).
- **`bookAppointment`** `{ teamId, providerId, activityId, startMs, durationMinutes, …contact }` —
  the **only** appointment booking path. The client sends **no** `templateId`: the
  server resolves which active availability covers that start (day-of-week, date
  range, window/grid or explicit time), which is both simpler and unspoofable.
  It validates `durationMinutes ∈ activity.durationsMinutes`, applies the
  **activity's** access rule (shared gate, see below), then creates the session and
  its `confirmed` booking in one transaction.

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

## Mirrors

| Doc | Discriminator | Publish gate |
|---|---|---|
| `sessions/{id}/public_profile/{id}` | `type: 'appointment_session'` (classes: `'session'`) | appointment: `status !== 'cancelled'` · class: `allowBooking === true` |
| `activities/{id}/public_profile/{id}` | `activityType: 'appointment'` | `isActive !== false` |

Since only **booked** appointments have a session, the only `appointment_session`
mirrors that exist are already full — which is why the public site's schedule
section lists **classes only**. Appointments reach the public as *activity* cards
that route to the picker.

## Where appointments appear

| Surface | Behaviour |
|---|---|
| Admin **Schedule** | Booked appointments render like any session; the **Classes / Appointments / Events** filter shows/hides them. Clicking one opens `AppointmentDetail` (bookings roster + cancel), not the session edit form. |
| Admin **availability** | Schedule → "+ New entry" → *Appointment availability* (`AppointmentAvailabilityDialog`): list/create/edit/pause schedules, pick their activities. No dedicated admin route. |
| Public picker | `/public/{slug}/appointments` — coach → activity → duration (if >1) → day → time. 100% `listAvailability`; reads no Firestore directly. |
| Public site / booking flow | Appointment **activity** cards route to the picker. The schedule section is classes-only. |
| Kiosk schedule / Now-Next | Booked appointments shown — the front desk sees the day's 1:1s. |
| Kiosk walk-in | **Not offered.** Walk-in needs a discrete open slot, which no longer exists. Removed 2026-07; re-addable on `listAvailability` if wanted. |
| Drop-in | Rejected for appointments (`booking/dropIn.ts`). |

## Seeds

All four seeds (`seed-emulator`, `seed-sandbox`, `seed-staging`, `seed-lead`) create
an appointment activity (with `durationsMinutes`), one or more
`availability` docs, and a few **booked** appointments — never open slots, since
nothing is pre-generated. Shared builders live in `scripts/lib/appointments.ts` so
every seed emits the shape `bookAppointment` would. Swimli
(`scripts/leads/swimli/profile.ts`) is the richest: 3 providers, both `times` and
`range` schedules.

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
