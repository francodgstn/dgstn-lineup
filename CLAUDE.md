# CLAUDE.md — dgstn-lineup (Linyup SaaS)

## What this project is

Linyup is a generalised SaaS version of **hmd-lineup** — a martial-arts school
management platform. The goal is to strip out sport-specific logic and offer the
same feature set (sessions, contacts, bookings, trial forms, team management,
student mobile app) to any type of coach, club, or multi-club organisation.

**Reference implementation**: the original project lives at
`C:\git\hmd\hmd-lineup` (or `~/git/hmd/hmd-lineup` on Mac/Linux). When porting
or extending any feature, always read the source there first.

---

## Monorepo layout

```
apps/web/           Next.js 15 App Router — admin dashboard (replaces CRA/Redux)
apps/mobile/        Expo 54 + React Native — student app (ported from hmd-lineup/student-app/)
packages/functions/ Firebase Cloud Functions v2 — TypeScript (replaces Babel JS)
packages/shared/    TypeScript types + Firestore path constants
```

Root tooling: **pnpm workspaces** + **Turborepo**. Node 22 required.

---

## Reference project structure (hmd-lineup)

| Concern | hmd-lineup path | Notes |
|---|---|---|
| Cloud Functions | `functions/src/{name}/index.js` | Babel ES6, `regionalFunctions` from `utils/functions.js` |
| Firestore rules | `firestore.rules` | 650 lines — ported verbatim into root `firestore.rules` here |
| Firestore indexes | `firestore.index.json` | Ported verbatim |
| Web app | `src/` | React 19, MUI 7, Redux — do NOT copy this; rewrite in Next.js |
| Student app | `student-app/` | Copied into `apps/mobile/` with branding updates |
| Data constants | `src/constants/firebasePaths.js` | Ported to `packages/shared/src/paths.ts` |
| Mail utils | `functions/src/utils/email.js` | Reworked: SMTP removed, now a thin façade over the Brevo mail service in `packages/functions/src/mail/` (see "Email sending" pattern) |
| Secrets | `functions/src/utils/secrets.js` | Ported to `packages/functions/src/utils/secrets.ts` |
| Teams utils | `functions/src/utils/teams.js` | Ported to `packages/functions/src/utils/teams.ts` |
| Recurrence | `functions/src/utils/recurrence.js` | Ported — DST-safe Europe/Zurich logic, keep as-is |
| Users utils | `functions/src/utils/users.js` | Ported to `packages/functions/src/utils/users.ts` (stub) |

---

## What's done (Phase 1 + Phase 2 start)

- Root workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- `packages/shared`: all types + Firestore path constants
- `packages/functions`: utils ported, ~12 functions fully implemented, rest stubbed
- Firebase config: `firestore.rules`, `firestore.index.json`, `storage.rules`, `database.rules.json`, `firebase.json`, `.firebaserc`
- `apps/web`: Next.js 15 scaffold with `(auth)` route group, `(public)` route group, login page, AuthContext, TanStack Query
- `apps/mobile`: full port of `hmd-lineup/student-app/` with Linyup branding
- CI/CD: `.github/workflows/verify.yml` + `deploy.yml`
- shadcn/ui component library installed in `apps/web/src/components/ui/`
- Build + typecheck clean across all packages; dev server runs at port 3000
- `firebase-auth.ts` split from `firebase.ts` to prevent SSG crash (auth/invalid-api-key)
- Bio-link routes tagged `force-dynamic`; `apps/web/.env.local` created with placeholders
- Self-service signup wizard (`app/signup/page.tsx`) — 2-step: account → team → dashboard
- Firebase emulator wired up for local dev (`demo-linyup` project, no real Firebase project needed)
- Public **Space** area (`/public/{slug}/space`) — the contacts' personal member portal
  (membership, bookings, profile, and the courses they can open), interim web surface until the
  mobile app ships. Sign-in via the passwordless contact-session login; course discovery + buying
  lives in the Shop, not here. See "Public Space" under Key patterns.

---

## What's NOT done yet (Phase 2+)

### UI / UX gaps (priority)
- **Auth layout + nav** — no icons, no mobile drawer, no collapse mode (see UI/UX porting principles above)
- **Contact detail page** — `/contacts/[id]` route with tabbed view (profile, notes, activity, subscriptions)
- **Session calendar view** — calendar tab alongside list (react-big-calendar)
- **Mobile-first list layouts** — current list pages use desktop tables; need card/list patterns that work on mobile
- **Gamification** — stubbed page, no implementation

### Features not yet started
- **Stripe billing** — `SaasSubscription` type is stubbed, `saas_subscriptions` rules deny all
- **Organisation tier** — multi-team hierarchy, `organizations/` collection stub only
- **SaaS operator console** — no admin panel for managing tenants
- **Full function port** — only ~15 of ~81 functions are implemented; the rest are stubbed with a `TODO: port from hmd-lineup/functions/src/{name}/index.js` comment
- **Outreach/automation engine** — not started
- **Appointments (1:1)** — DONE: activity-bound, availability-only booking (`listAvailability` + `bookAppointment`, overlap-safe lazy session creation, priced durations + one `memberBenefit` rule (no access gate — the price is the gate), .ics emails, public picker at `/public/{slug}/appointments` — see `docs/appointments.md`). Still open: mobile app integration (browse/book is gated pending a rebuild on `listAvailability`), push reminders, session notes, waiting list (`docs/product-strategy.md`).

---

## Architecture decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| UI library | shadcn/ui + Tailwind CSS | White-label flexibility; no vendor lock-in |
| State: server | TanStack Query v5 | Replaces react-redux-firebase |
| State: auth | AuthContext (React context) | Simpler than Redux for auth-only state |
| Firebase SDK | Modular v12 (no compat) | Tree-shakeable, future-proof |
| Functions | TypeScript, CommonJS target, **firebase-functions v6 (gen2)** | No Babel, type-safe, already on latest |
| Branding | "Linyup" (coined word, linyup.com) | Energetic, invented, domain available |
| Multi-tenancy | `teamId` as tenant boundary | Matches existing Firestore rules pattern |
| Functions region | `europe-west6` | Same as hmd-lineup; change only if customer base shifts |

---

## Key patterns

### Cloud Functions — use v2 imports (NOT `regionalFunctions`)

The old project used `regionalFunctions` (firebase-functions v1 gen1). This project is on **v6 gen2**. When porting any function, update the import at the same time:

```typescript
// v2 gen2 — use this
import { onCall, onRequest } from 'firebase-functions/v2/https'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'

setGlobalOptions({ region: 'europe-west6' })

export const myFn = onCall(async (request) => { … })

// OLD v1 pattern from hmd-lineup — do NOT copy as-is
import { regionalFunctions } from '../utils/functions'
export const myFn = regionalFunctions.firestore.document('…').onCreate(…)
```

### Public tenant routes — ONLY read `public_profile` subcollections

Public tenant routes (`/public/{slug}/*`) must never query main collections. Always use:

```typescript
// resolve team by slug
const q = query(
  collectionGroup(db, 'public_profile'),
  where('slug', '==', slug),
  where('type', '==', 'team'),
  limit(1)
)
```

See `hmd-lineup/docs/portal-security.md` for full rules and patterns.

### Public tenant route structure

Routes are **tenant-first**: `/public/{slug}` is the team root and renders the team's chosen
default surface (`Team.default_public_surface`, defaults to `'bio-link'`). The root reads
`TeamPublicProfile.active_public_surfaces` (computed by `syncTeamPublicProfile` on team write)
to avoid redirecting to a dead surface. Sub-routes are siblings: `/public/{slug}/site`,
`/public/{slug}/space`, `/public/{slug}/booking`, `/public/{slug}/signup`,
`/public/{slug}/manage-booking`, `/public/{slug}/contact-update`, `/public/{slug}/coaching`.
Token-only routes stay standalone: `/public/event-invitation` and `/public/team-invitation/{token}`.

### Public Space — the contacts' personal portal

`/public/{slug}/space` is a minimal, team-branded public area (sibling to `/public/{slug}`
bio-link root and `/public/{slug}/site`) — the signed-in **contact's** personal portal:
membership (subscriptions + affiliation), bookings, editable profile, and **My courses** (the
courses they can open). It's a **base surface** (always live, not gated on the online-courses
plugin) and sign-in-gated — anonymous visitors get a sign-in wall. The course **catalogue**
(browse + buy, incl. locked/priced cards) lives in the **Shop**, NOT here; Space only ever shows
a contact's own entitlements, filtered from the world-readable
`courses/{courseId}/public_profile/{courseId}` summaries (written by `syncCoursePublicProfile`,
`packages/functions/src/sync/`). It resolves the team by slug with the same `public_profile`
collection-group query as the other public routes. Never list the root `courses` collection publicly.

**Course access tiers** (`Course.accessRule.type` in `packages/shared/src/types/course.ts`):

| Tier | Stored value | Display | Who can read |
|---|---|---|---|
| Free | `free` | "Free" | Anyone, no login — incl. media |
| Sign-in required | `registered` | "Sign-in required" | Any signed-in contact of the team |
| Subscription | `subscription` | "Subscription" | Contact whose `subscription_type_id` ∈ `accessRule.subscriptionTypeIds` |
| Sold (one-off) | `purchase` | "Sold · {price}" | Contact who bought it (lifetime), OR whose `subscription_type_id` ∈ `accessRule.subscriptionTypeIds` (optional "included free") |

History: the middle tier was `members` until 2026-06; renamed (value + display) to
`registered` while pre-launch with seed data only. The stored enum value is the stable
machine identifier — post-launch, renames must be display-only.

**Selling courses (the `purchase` tier).** A purchase-tier course carries
`accessRule.priceAmount` (major units) and is sold one-off in `/public/{slug}/shop`
**next to products and subscriptions** (a "Courses" tab), while still consumed in
`/public/{slug}/space`. It reuses the products Stripe-Connect plumbing: the public
`createCourseCheckout` callable (`packages/functions/src/connect/payments.ts`) →
`createOneOffCheckoutSession` → the Connect webhook's `handleCourseCheckout`
(`webhook.ts`, `kind: 'course'`) links/creates the buyer's contact and writes a
**lifetime entitlement** at `courses/{courseId}/purchases/{contactId}`
(`COURSE_PURCHASES_SUBCOLLECTION`). Firestore rules unlock the course via
`hasPurchasedCourse(courseId)` inside `canReadPublishedCourse(courseId, c)`. The shop
+ Space read the per-course `public_profile` summary (now carries `priceAmount`) via
the same collection-group query; the Space also queries `purchases` (collection-group,
indexed on `contactId, teamId`) to show unlock state. The success page lands the buyer
in their Space (`seg=space`) to watch.

**Contact auth on the web** reuses the mobile contact-session mechanism: passwordless email
code (`sendContactVerificationCode`) → `loginContactWithCode` (matches the existing
contact, handles same-email selection, mints a session via `buildContactSession`) →
`signInWithCustomToken`. The custom-token claims `{ contactId, teamId, sessionExpires }`
are what Firestore + Storage rules check (`isContactOfTeam` / `canReadPublishedCourse` in
`firestore.rules`; `isContactSessionForTeam` / `isPublishedFreeCourse` in `storage.rules`).
Enforcement lives in the rules; the UI lock states are UX only.

### Firebase client SDK — server/client split

Next.js SSG/SSR crashes if `getAuth()` is called at module level on the server.

| File | Exports | Import from |
|---|---|---|
| `src/lib/firebase.ts` | `app`, `db`, `storage` | Anywhere (server + client safe) |
| `src/lib/firebase-auth.ts` | `auth` | Client components and `src/lib/auth.ts` only |

Never add `getAuth()` back to `firebase.ts`.

### Email sending — Brevo ESP (no SMTP)

All outbound mail goes through **Brevo's transactional HTTP API** via a
provider-agnostic service in `packages/functions/src/mail/`. There is **no SMTP /
nodemailer** and **no stored mail credentials** for anyone. Full docs:
`packages/functions/src/mail/README.md`.

- Call sites send via `sendEmail(...)` from `utils/email.ts` (a thin façade).
  **Pass `teamId` to send AS the studio**; omit it for Linyup **system mail**
  (from `hello@linyup.com`).
- **Sender resolution** (`mail/senderResolution.ts`, pure + unit-tested): a studio
  sends **Managed** (studio name over a `linyup.com` address, Reply-To = the
  studio's contact email) by default, or from a **BYO domain** once verified in
  Brevo (paid plans only — `coach`/`studio`/`organization`). BYO falls back to
  Managed automatically until verified.
- Per-studio config lives at `teams|organizations/{id}/integrations/email_sender`
  (`EmailSenderConfig`, no credentials). BYO domain-auth callables:
  `registerSenderDomain` / `checkSenderDomain` / `useManagedSender`.
- Brevo event webhook `handleBrevoWebhook` writes `mail_suppressions/*` on
  bounce/block/spam so dead addresses are skipped; `mail_sends/*` is the
  idempotency + delivery ledger. Secrets: `brevo-api-key`, `brevo-webhook-secret`
  (Secret Manager; emulator env `BREVO_API_KEY` / `BREVO_WEBHOOK_SECRET`).

### Appointments (1:1) vs classes

Two primitives, not two entities — both are `sessions/{id}` docs:

- **Class** = a seat in a scheduled event. The studio schedules it; it exists on
  the calendar before anyone books.
- **Appointment** = a provider's exclusive time. **Nothing exists until booked** —
  the provider publishes *availability*, and the session is created lazily,
  overlap-safe, at booking.

`Activity.type` (`'class' | 'appointment'`) picks the scheduling mechanism;
`Session.activityType` carries it. Mirrors: `type: 'session'` vs
`'appointment_session'`; activity mirrors carry `activityType` so public UIs route
appointment cards to the picker.

**The what vs the when.** The `Activity` owns the *what* — `durations` (each
length with an optional base price) and the ONE `memberBenefit` rule (no
capacity: an appointment is exclusive time, one booking per slot by definition).
The `availability/{id}` doc owns only the *when* — provider, recurrence,
`mode: 'range'|'times'`, buffer, and **`activityIds`** (which appointment
activities are bookable in that window). Durations are never stored on
availability; they derive from the linked activities. Because a window may offer
activities of different lengths, a start time is indeterminate until the client
picks one — **which is why availability can never be pre-generated** (the old
slot-generation cron was deleted for exactly this reason).

Booking: **`bookAppointment`** is the free-path appointment callable
(`bookSession` is class-only and rejects them); the client sends no templateId —
the server resolves the covering availability. `listAvailability` computes free
times, coach-first (returning `durations` + `memberBenefit` per activity).
Appointments have **NO access gate** — THE PRICE IS THE GATE: unpriced → anyone
books free (guests included), priced → anyone pays their effective price.
`Activity.accessRule` is CLASS-ONLY (appointment forms don't show it, appointment
paths don't read it, appointment session docs/mirrors don't carry it).
`cancelBooking` handles both kinds.

**Paid appointments** put a base price per duration (`Activity.durations:
[{minutes, priceAmount?}]`) and the member benefit in ONE rule per activity:
`Activity.memberBenefit: {subscriptionTypeIds, kind: 'included'|'discount',
discountPercent?}` — holders of a listed type book free (`included`; credit
packs spend a credit) or pay `discountPercent` off every priced duration
(`discount`, clamped to Stripe's 0.50 floor, never free-via-discount). Absent =
no benefit, everyone pays base — the benefit is data, never implied, but it is
one rule (the per-duration × per-type `subscriptionPricing` matrix is gone).
Resolver: **`resolvePaymentOptions(snapshot, target, context?)`** — the ONE
shared coverage/quote resolver (`packages/shared/src/utils/paymentOptions.ts`,
pure, client-safe) that answers `covered | spend_credits | pay(amount,
appliedBenefit)` for class bookings, drop-ins, appointments, courses AND
products; the optional third `context` carries a typed promo code (see "Promo
codes" below) and nothing else, so every pre-existing call site compiles and
behaves unchanged. The server builds its authoritative snapshot via `loadContactPaymentSnapshot`
(`packages/functions/src/booking/access.ts`), the web an optimistic one via
`apps/web/src/lib/paymentSnapshot.ts`. Never add a parallel coverage/price
check — extend the resolver (fixtures:
`functions/src/booking/paymentOptions.test.ts`). Money mechanics (0.50 floor,
Rappen conversion, fees, idempotency) live once in
`packages/functions/src/connect/checkout.ts` + `shared/src/utils/money.ts`. A
payable caller is refused by `bookAppointment`
(`payment_required`) and instead reserves→pays→confirms via
**`createAppointmentCheckout`** at the caller's effective amount: the hold IS
the session (`status: 'pending_payment'` + `hold_expires_at`, +30 min, lazily
expiring) and the Connect webhook (`kind: 'appointment'`) confirms it to `full`
on payment. `dropIn` stays class-only — appointments never use it; class-side,
the independent `trialEnabled` toggle lets a gated class accept a newcomer's
guest trial, so members-included + trial + drop-in coexist. That trial may
itself be **priced** — `Activity.trialPriceAmount` (class-only, gated-only;
absent ⇒ free, today's behaviour) charges a newcomer's first class over the
drop-in checkout (`createDropInCheckout({ trial: true })`), enforced once per
person via `Contact.trial_used_at`. A trial is never a subscription. Kiosk
walk-in is class-only too. Full docs: `docs/appointments.md` → "Paid
appointments"; `docs/payment-contact-studio.md` → "Paid trial".

### Waitlist — class-only, one deadline, one seat writer

A queue for a seat in a full **class**; entries live at
`sessions/{sessionId}/waitlist/{contactId}` (doc id = contactId, mirroring
`bookings`), written only by callables — every client write is denied by the
rules. **Class-only**: an appointment session doesn't exist until it's booked, so
"full" has no meaning there. The flag is `Activity.waitlistEnabled` + its public
mirror only — there is deliberately **no** `session.waitlist_enabled` (it would
need an activity→sessions fan-out plus a backfill). When a seat frees, the
`seatFreedEdge` trigger on the session doc offers it to the oldest waiter and
holds it as an **ordinary booking** carrying `waitlist_claim` +
`claim_expires_at`, so `bookingHoldsSeat` and every capacity gate already stop
selling it. **THE SINGLE-DEADLINE RULE:** the hold's `claim_expires_at`, the
entry's `offer_expires_at` and (for a paid claim) the booking hold's `expires_at`
and the Stripe session's `expires_at` are ONE instant, computed once by
`resolveClaimWindow` and copied — diverge and a seat gets sold twice. (A
free-path hold carries no `expires_at`; only the checkout adds it, which is why
`expirePendingBookings` reaches the paid claim hold alone.) A free claim settles
in `claimWaitlistSeat`; a **payable one leaves it and returns through
`createDropInCheckout({ waitlistToken })`** (no second pricing path). **ONE SEAT
WRITER:** on a **class** session `bookings_count` is only ever an ABSOLUTE value,
from `trackBookings`' recount or a transaction that read the `bookings`
subcollection — **no `FieldValue.increment` on it anywhere** (an appointment
session is created together with its one booking, so its `bookings_count: 1` is
absolute and uncontended by construction). Releases go through
`releaseWaitlistOffer` and always **release before re-offering** — where there is
anything to re-offer: the Connect webhook's oversell branch and the session
teardown deliberately do not. Full docs: `docs/waitlist.md`.

### Promo codes — a Stage A MODIFIER, never a tender

**A promo code changes what a purchase costs; a gift card pays for one.** That is
the whole design, and getting it backwards is the single biggest way this area
goes wrong:

> A price **MODIFIER** belongs in Stage A (inside `resolvePaymentOptions`). A
> **TENDER** belongs in Stage B (at the checkout callable). **Nothing is both.**

So the promo is applied inside the resolver and **no callable ever computes a
discounted amount itself** — every one reads `payOption.amount`. The dividend:
every gift-card reservation already receives a post-promo total, so no gift-card
call site needed a promo edit. `teams/{teamId}/promo_codes/{CODE}` (the doc
id IS the code, `PromoCode` in `packages/shared/src/types/promoCode.ts`), written
only by manager callables in `packages/functions/src/connect/promoCodes.ts`;
`firestore.rules` denies every client write. Rails: drop-in, appointment, course,
product — **not** memberships, not gift-card purchases, not the priced-trial door,
and **not the waitlist claim** (its deadline cannot be shortened without giving
one seat two timers, so a code there would lock a use for the whole claim window;
the claim path is refused server-side, not merely unmounted). A code may also be
narrowed by **audience** (`audience: 'all' | 'new_contacts'`, where "new" is
`!joined` — the same fact the `members` access rule runs on, never a second
definition), by entity allow-lists, or bound to one contact.

**Best-one-wins, and the comparator is deliberately ASYMMETRIC.** A *benefit*
applies whenever it does not RAISE the price (`<= base`), because `appliedBenefit`
answers *which membership priced this booking* — provenance read downstream. A
*promo* applies only when **strictly lower**, because `appliedPromo` answers *did
a code change the price* — an event. When a promo beats a benefit, the beaten one
rides on `appliedPromo.supersededBenefit` so a campaign never blanks a studio's
subscription attribution. `appliedBenefit` and `appliedPromo` are never both
present on one option.

**ONE writer of `usage_count`** — `commitPromoRedemption`'s transaction, writing
an **absolute** value from its own read set. No `FieldValue.increment` on
`usage_count` or `PromoRedemption.count` anywhere, and **no restore-on-refund
path**, which is the second writer that would otherwise appear. The manager levers
(`clearPromoRedemption`, `releasePromoReservations`) *delete lifecycle state* and
never adjust a counter.

**A use is consumed by a completed SALE, never by an attempt.** The commit sits at
each handler's per-kind confirm point — never before the dispatch — so every
branch that refunds the whole charge commits nothing and the reservation simply
lapses. A **live reservation consumes a use** (never
over-issue), which is bounded by a deterministic reservation key (a retry is a
refresh, not a second use), `PROMO_MAX_LIVE_RESERVATIONS` + a distinct
`promo_busy` refusal, short checkout windows, reserved-shown-separately-from-used
in the admin list, and the manager release lever. The per-person cap binds to a
**hashed normalised email**, not a contact document — so it is a nudge with teeth,
not a promise, and the admin copy says "counted per email address".

**The deterministic key is paid for by a set of ownership rules**, each of which
was a live bug before it was written down. They are enumerated ONCE, in
`docs/promo-codes.md` → "Redemption integrity" — read them there rather than from
a summary, because the summaries of that list have now disagreed with it (and
with each other) in every review round of this phase. The shape they all share:
the key says *which slot*, `instanceId` says *whose attempt holds it right now*,
and `sessionId` says *which Checkout Session may take money for it*; every
removal or spend compares its marker **inside** the transaction that writes.
Never make the key unique to fix a release bug — that destroys
retry-is-a-refresh.

**A promo writes NO finance journal row, ever** — a discount is not a money event
on a cash basis; the money event is the smaller charge. No `FinanceCategory`
member, no reclass pair, no CSV column. The record is
`PaymentLineItem.promoCode` on the payment row (a system stamp: never read off a
client payload, carried forward across a manager's edit) plus the
`redemptions/{identityKey}` ledger. Full docs: `docs/promo-codes.md`.

### Comments must not assert a COUNT of code sites

A comment saying "the two X", "all three Y", "six copies" or "the only Z" is a
claim that rots the moment somebody adds a case — silently, and against the
reader who trusts it. Wave 3 Phase 3 shipped a false one in **every** review
round and corrected the arithmetic every time; the numbers kept coming back.
So, in order of preference:

1. **Point at the owner.** A list of call sites (a "census") is written down
   ONCE and referred to everywhere else. Existing owners:
   `packages/functions/src/appointments/holdRelease.ts`'s module header (every
   site that can release an appointment hold) and `docs/promo-codes.md`
   ("The census — every site that removes a reservation", "The ownership rules",
   "The mounts"). Add to the owner; never copy it.
2. **Name the members and drop the number** — a claim checkable by reading the
   names beside it fails visibly rather than silently.
3. **Assert it in a test.** `packages/functions/src/connect/commitSites.test.ts`
   reads the SOURCE and pins call-site tallies (it spans the functions/web
   boundary on purpose — that boundary is where corrections stop travelling).
   That file is where a bare number is allowed, because there it is executable.

### SaaS plan tiers (Phase 2)

```typescript
type SaasPlan = 'free' | 'coach' | 'studio' | 'organization'
// stored in teams/{teamId}.plan + saas_subscriptions/{teamId}
```

**Plan IDs vs display names:** plan IDs are stable machine identifiers
(Firestore data, security rules, Stripe lookup keys) and must not change once
real customer data exists. Marketing names live in the `Plans` namespace of
`apps/web/messages/*.json`, resolved via `usePlanName()`
(`apps/web/src/hooks/usePlanName.ts`) — never hardcode plan display names in
components or copy. History: the tier was `club` until 2026-06; it was fully
renamed (ID + display) to `studio` while the product was pre-launch with seed
data only. Post-launch, renames must be display-only.

---

## Firebase projects

| Alias | Project ID |
|---|---|
| default (local) | `demo-linyup` (emulator only — `demo-` prefix bypasses project validation) |
| staging | `linyup-staging` |
| production | `linyup-prod` |

Staging and production need to be created in Firebase Console (not done yet).
For local development use the Firebase emulators — no real project needed.

---

## Firebase emulators

Auth: `localhost:9099` | Firestore: `localhost:8080` | Storage: `localhost:9199` | UI: `localhost:4000`

`.env.local` sets `NEXT_PUBLIC_USE_EMULATORS=true`. Emulator connections are guarded by this flag + a `globalThis` flag to prevent HMR double-connect. Storage is wired up in `firebase.ts` (`connectStorageEmulator`, port 9199) — needed for file/image uploads (e.g. Online Courses media + attachments).

Start from repo root (Java required — use external terminal if VS Code's integrated terminal can't find Java). Include `storage` whenever you need uploads:

```
firebase emulators:start --only auth,firestore,storage
```

### Emulator data modes

Isolated datasets, never mixed:

| Command | Dataset | Notes |
|---|---|---|
| `pnpm emulators:seed` | Fresh seed (wipes + re-seeds) | Three plan-tier demo accounts |
| `pnpm emulators:demo` | `snapshots/demo/` | Persistent demo data for live demo; auto-saved on exit |
| `pnpm emulators:swimli` | `snapshots/swimli/` | Swimli lead-demo rehearsal snapshot (see "Lead demo tenants") |
| `pnpm emulators:hmd` | `snapshots/hmd-migration/` | Real HMD data after migration; auth+firestore only |

`snapshots/` is gitignored. Bootstrap each snapshot once — see `scripts/MIGRATE-HMD.md` for the HMD snapshot and the inline docs in `scripts/emulators-demo.mjs` for the demo snapshot.

### Lead demo tenants

Prospective-customer sandboxes (real public business data + synthetic contacts),
seeded by the generic `pnpm lead:seed --lead <id>` (`scripts/seed-lead.ts`) from
per-lead profiles in `scripts/leads/{id}/profile.ts` — dual-target: local emulator
or the cloud `linyup-sandbox` project. Seeding is **local-only**: lead profiles are
gitignored, so CI has no profiles to read (the old Seed Lead Sandbox Action was
removed for that reason). Lead tenants are NOT on the public `/try` picker.
Full docs: `scripts/leads/README.md`.

### Sandbox safety model

The sandbox hosts **live prospect demos**, so nothing lands in it unattended:

- **Code deploys are manual.** `deploy-sandbox.yml` (functions + rules) is
  `workflow_dispatch` only — no push trigger. Sandbox can therefore drift behind
  `main`; deploy by hand before a demo if backend code changed. The **web app**
  is separate: it rolls out via App Hosting's own GitHub integration, configured
  in the Firebase Console (Console → App Hosting → backend → Deployment
  settings), not in this repo.
- **Data is never reset automatically.** Nothing scheduled or push-triggered
  wipes data. The one exception is `purgeProvisionalContacts` (in `dailyTasks`),
  which hard-deletes *expired provisional* contacts across all tenants nightly.
- **`pnpm sandbox:reset` PRESERVES lead tenants.** It wipes only the `/try`
  playground; `lead-*` teams, their data and their logins survive. It asks for a
  typed confirmation (`--yes` to skip in CI, `--dry-run` to preview counts first,
  `--include-leads` to override the preservation).
- **To tear down ONE lead**, use `pnpm lead:seed --lead <id> --reset` — scoped to
  that tenant, and it now also asks for typed confirmation against the cloud.
- Both teardown paths derive their collection list from the **shared**
  `TENANT_DATA_COLLECTIONS` (`packages/shared/src/tenantData.ts`), which has a
  completeness test. Never hand-copy that list into a script — the copies went
  stale and started missing `availability_exceptions` and `feedback`.

---

## Firestore security rules

- **Team creation:** any authenticated user can create a team where `createdBy == request.auth.uid` — enables self-service signup.
- **Team member self-provision:** a user can write their own `team_members` doc as `owner` on signup (before membership exists).
- Everything else requires strict team-membership checks (`isTeamMember`, `hasTeamRole`).

---

## Internationalisation (i18n)

**Library:** `next-intl` — installed in `@linyup/web`.

**Locales:** `en` (default), `de`, `fr`, `it` — all four national languages of Switzerland.

**Locale in URL:** `localePrefix: 'as-needed'` — English keeps clean URLs (`/dashboard`); other locales get a prefix (`/de/dashboard`, `/fr/contacts`). Middleware rewrites English paths internally.

**File structure:**
```
apps/web/
├── messages/               ← one JSON per locale
│   ├── en.json             ← source of truth (always complete)
│   ├── de.json
│   ├── fr.json
│   └── it.json
└── src/
    ├── i18n/
    │   ├── routing.ts      ← defineRouting (locales, defaultLocale, localePrefix)
    │   ├── request.ts      ← getRequestConfig (loads messages per locale)
    │   └── navigation.ts   ← createNavigation (locale-aware Link, useRouter, usePathname)
    ├── middleware.ts        ← createMiddleware(routing)
    └── app/
        ├── layout.tsx      ← minimal root: just `return children`
        └── [locale]/
            ├── layout.tsx  ← html+body, NextIntlClientProvider, QueryProvider, AuthProvider
            └── (auth)/     ← all authenticated routes live here
```

**Rules:**
- All routes live under `app/[locale]/`. Never add routes directly to `app/` (except `layout.tsx`).
- Import `Link`, `useRouter`, `usePathname` from `@/i18n/navigation` — NOT from `next/link` or `next/navigation`. The i18n wrappers add locale context automatically.
- Use `useTranslations('Namespace')` for all visible strings. Never hardcode UI text.
- Message keys live in `en.json` first. Add the same key to `de.json`, `fr.json`, `it.json` immediately.
- Sport type names in the signup form are kept in English for now (they're international proper nouns); translate when the need arises.
- Date formatting uses the browser locale via `toLocaleDateString()`. "Today"/"Tomorrow" labels come from `Common.today` / `Common.tomorrow` in messages.
- `typedRoutes: true` is still enabled. With `[locale]` in the path, many route literals need `as Route` cast. This is expected — use casts rather than disabling typedRoutes.

## Next.js specifics

- `typedRoutes: true` at root level in `next.config.ts`. Use `Route` from `next` for typed hrefs.
- Bio-link routes must export `export const dynamic = 'force-dynamic'` to prevent SSG Firebase calls.
- `Input` component in `src/components/ui/input.tsx` uses a plain `<input>` (not `@base-ui/react`) — do not revert this; the base-ui wrapper causes SSR hydration mismatches.

---

## Development commands

**Local dev = one process per terminal.**

In VS Code (the usual way): **Ctrl+Shift+P → "Tasks: Run Task"** → pick a service or a
`Stack:` preset (`.vscode/tasks.json`). Each runs in its own dedicated integrated
terminal; the `Stack:` presets launch several at once (e.g. "Stack: Web" = emulators +
web). Add/extend presets there.

Or run the scripts directly (start the backend in one terminal, then each app in its own):

```bash
pnpm install            # root — installs all workspaces (once)

# ── Terminal 1: backend (pick ONE dataset — see "Emulator data modes") ──
pnpm emulators:seed     # fresh seed: emulators (auth+firestore+functions+storage) + 3 demo accounts
pnpm emulators:demo     # persistent demo snapshot
pnpm emulators:hmd      # HMD migration snapshot (auth+firestore+storage)

# ── Terminal 2+: apps (one per terminal, as needed) ──
pnpm dev:web            # Next.js admin dashboard (port 3000)
pnpm dev:admin          # operator console (port 3002)
pnpm dev:landing        # Astro marketing site (port 4321)
pnpm dev:mobile         # Expo student app

# ── Optional extra terminals ──
pnpm stripe:listen      # forward Stripe test webhooks (platform + Connect) to the local
                        # Functions emulator. Forwards to BOTH handleStripeWebhook (SaaS
                        # billing) and --forward-connect-to handleConnectWebhook (member→
                        # studio payments). Copy the printed whsec_… into
                        # packages/functions/.env.local as STRIPE_CONNECT_WEBHOOK_SECRET
                        # (and STRIPE_WEBHOOK_SECRET), then restart the emulator.
pnpm functions:watch    # rebuild Cloud Functions on save (when editing functions)
```

Quality / CI checks (run anytime): `pnpm build` · `pnpm lint` · `pnpm typecheck` ·
`pnpm test` · `pnpm format`. Cloud/data ops live under `seed:*` / `reset:*` /
`migrate:hmd` / `stripe:sync` / `emulators:export:*` — not part of day-to-day startup.

---

## UI/UX porting principles

**Goal: functional parity, not pixel-perfect copy.**

hmd-lineup's UI patterns were designed carefully — especially for mobile. When building or refactoring any page, read the reference first and replicate the *functionality and layout intent*, even though the visual style will differ (shadcn/Tailwind vs MUI).

### What must be ported faithfully

- **Navigation**: icons on every nav item, collapsible sidebar on desktop (full ↔ icon-only), mobile hamburger + swipeable sheet drawer, user/team info at bottom
- **List pages**: mobile-first card/list layouts (avatar + name + status chips), NOT desktop-only tables. Tables are only acceptable for data-heavy views where mobile is less important.
- **Detail pages**: contacts, sessions, events, and bookings all have full detail pages (own route), not just edit modals. A modal is only acceptable for quick create/edit of simple entities.
- **Multi-tab detail views**: contact detail has tabs (profile, notes, activity, subscriptions, gamification). Port the tab structure even if some tabs start empty.
- **Calendar view for sessions**: sessions page has a list tab AND a calendar tab (month/week/day). Use `react-big-calendar` or equivalent.
- **Search + filters**: every list page with >1 filter has a search field + collapsible filter panel.
- **Confirmation dialogs**: all destructive actions (delete, archive) require a confirmation dialog.
- **FAB / primary action**: "New …" button is fixed bottom-right on mobile (FAB pattern), inline toolbar button on desktop.

### What to intentionally diverge from

- Visual style: MUI components → shadcn/ui + Tailwind equivalents
- Redux state → TanStack Query + React context
- Sport-specific fields: belt ranks, Swiss QR Bill, federation logic → remove or generalise
- HMD-specific copy and branding

### Rule

Before writing a new page or refactoring an existing one, check:
```
C:\git\hmd\hmd-lineup\src\routes\{Feature}\   ← reference UX and data flow
```
If a pattern exists in hmd-lineup and is not sport-specific, port it.

---

## Using the reference project in this session

When asked to implement a feature, check the reference first:

```
@C:\git\hmd\hmd-lineup\functions\src\{feature}\index.js   # source function to port
@C:\git\hmd\hmd-lineup\src\routes\{Feature}\              # web UI to re-implement
@C:\git\hmd\hmd-lineup\docs\{topic}.md                    # architecture docs
```

The hmd-lineup codebase is the source of truth for business logic. Port logic faithfully;
only diverge where the old code is HMD-specific (belt ranks, Swiss QR Bill, etc.).
