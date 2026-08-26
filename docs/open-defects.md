# Open defects

Confirmed bugs that are **not** fixed, each reproduced against real data rather
than inferred. This file exists because the in-app follow-up chips are
session-scoped — they do not survive an app restart, and the evidence behind them
is expensive to re-derive.

Every entry states what was **verified**, so whoever picks it up starts from
evidence rather than from a symptom. Delete an entry when it ships; do not let it
rot into a claim nobody has re-checked.

**Refer to an entry by its TITLE, never by its number.** The numbers renumber
every time something ships: on 2026-08-16 two entries shipped and were deleted
(below), so every number after them moved in a single day. The one code comment
that points at this file names its entry by title
(`apps/web/src/lib/publicQueryError.ts`); keep it that way.

The Stripe entries were found while migrating the Stripe reads on
**2026-08-16**; the appointment-picker one during manual testing of the local
stack on **2026-08-15**, against commit `129a8c9` (Wave 3 Phase 3). All were
**pre-existing**, and all survived a full static pass (typecheck, tests, lint,
adversarial review). They are integration-boundary defects: the code is correct
about itself and wrong about the outside world, which is the category automated
verification is structurally blind to.

The Space "My courses" 403 shipped on **2026-08-16** and was deleted from this
file per the rule above. The fix lives in the `{path=**}/purchases` block in
`firestore.rules` and is held in place by
`packages/functions/src/connect/coursePurchaseAccess.test.ts`.

"The appointment picker ignores the signed-in contact session" shipped on
**2026-08-16** and was deleted too. The picker now derives ONE `Caller`
(`sessionCaller ?? verified ?? GUEST` — the same precedence
`resolveAppointmentCaller` uses), and every screen, price and payload comes off
it; see `docs/appointments.md` → "Who the picker is booking for". Its three
severity questions were answered against the running emulator before the fix and
**none was a money bug**: the contact session is a Firebase custom-token sign-in,
so its ID token rides on every callable the page makes regardless of what the
component knows, and the server was already resolving the member. The pricing
divergence was DISPLAY only (the member saw the guest figure and was charged the
member one); the `new_contacts` promo was refused at Apply time by
`previewPromoCode` and again inside the reserve; the per-contact cap keys on the
session contact's own normalised email and never reset. What the investigation
DID turn up, and what made the fix worth its size, was not in the entry: a
**covered** member was routed into `createAppointmentCheckout`, refused
`{ reason: 'covered' }` by design, and told *"This slot is no longer available."*
— a hard stop for the studio's own subscribers — and a signed-in contact filling
the guest form for someone else had the appointment booked under themselves.
Held in place by `packages/functions/src/appointments/callerIdentity.test.ts` and
the surface census in
`packages/functions/src/auth/publicSurfaceIdentity.test.ts`.

**What that census turned up and did NOT fix**, recorded here rather than left
inside a deleted entry:

- **`/public/{slug}/contact-update` still runs its own OTP.** It proves the
  visitor with `sendContactVerificationCode` + `verifyContactCode` against the
  `?contactId=` in the mailed link, and does not accept a contact session — so a
  contact who is already signed in is made to fetch a code to correct their own
  phone number. Closing it is a change to `verifyContactCode`'s caller
  resolution, not to the surface, which is why it was left alone.
- **`trial-booking/TrialBookingForm.tsx` is reachable from no route.**
  `trial-booking/page.tsx` is a redirect shim to `/booking`, and nothing else
  imports the component — 336 lines of dead surface, including the failed-read
  defect recorded at the bottom of this file, which therefore cannot be reached
  by a visitor today. Deleting it would settle that entry; nobody has.

"Stripe Connect reads a pre-Basil object model" shipped on **2026-08-16** and was
likewise deleted. Every migrated field now reads through
`packages/functions/src/utils/stripe/objectShape.ts` — modern location first,
narrow legacy fallback, and a report of which one answered. That module also
carries the guard that replaced the rejected `apiVersion` pin: compile-time
assertions, checked against the SDK's own declarations, stating where each field
is and is not, plus one comparing the bundled wire version to the version the
readers were verified against. A `pnpm update stripe` that moves any of them
fails `turbo run typecheck` before it can reach production. The fixtures holding
the modern shape are real captured Dahlia payloads
(`packages/functions/src/utils/stripe/dahlia-payloads.json`, exercised by
`objectShape.test.ts`); the reasoning for leaving `apiVersion` unpinned is
recorded in the header of `packages/functions/src/utils/connect/client.ts`.

What that migration left behind is NOT fixed, and is recorded below as its own
entries rather than left inside a deleted one. The one worry in the shipped
entry's own "verified live" list — that a null membership expiry might be treated
as "never expires" for access gating — was checked and is NOT a risk:
`writeContactMembership` discards the expiry outright (`void
opts.membershipExpiration`), gating runs off `Contact.active_subscriptions`, and
the rollup keys on `status` + `pause_collection` only. That symptom was a
data-quality defect, not an entitlement leak.

---

## 1. A BYO studio can double-count its own recurring revenue

**Severity: medium.** Structural, and only partly ours to fix.

`handleTeamStripeWebhook` keys every payment row on the underlying PaymentIntent
so that all events about one payment converge on one `payment_events` doc. Under
the current Stripe API version an `invoice.*` payload can no longer name its
PaymentIntent (`invoice.payment_intent` was removed; the replacement `payments`
list is **expand-only** and confirmed absent from the delivered payload), and a
`payment_intent.*` / `charge.*` payload can no longer name its invoice
(`payment_intent.invoice` was removed in the same change). The BYO rail holds NO
Stripe credentials by design, so it cannot expand or retrieve to bridge them.

Consequence: a studio subscribed to BOTH `invoice.payment_succeeded` and
`payment_intent.succeeded` gets two rows — and two finance-journal rows — for one
recurring payment.

**What shipped instead of a fix:** the divergence is now visible rather than
silent. A row keyed on anything other than the payment carries
`gateway_ref_kind: 'fallback'`, and the reader logs `[stripe-shape] MISSING …`.
The module header states which events a studio should subscribe to.

**Update 2026-08-18 (UX-60).** The marker was previously read by no screen, so a
doubled row was indistinguishable from a real one to the only person who could
act on it. `byoToUnified` now carries it as `UnifiedPaymentRow.refKindFallback`
and `PaymentsTable` renders a "may be a duplicate" chip with the reason on hover.
ABSENT still means `'payment'` — only an explicit `'fallback'` warns, so rows
written before the field existed are not accused of a duplication they are not
exposed to. **This is still not a fix**: the two rows remain, and everything under
"What would actually close it" is unchanged.

**Update 2026-08-18 (decision 18, Franco).** The close is **guidance + detection,
and the structural fix is deliberately NOT being built.** Both alternatives were
rejected by name: dedupe-by-heuristic, because a wrong match silently deletes a
real second payment; and giving the rail credentials, because avoiding them is
what BYO is FOR. So the rail now does two things and neither of them touches a
row:

- **Guidance is the primary defence, and it was WRONG in one place.** The setup
  table in `docs/payment-contact-studio.md` told studios to subscribe to
  `invoice.payment_succeeded` — i.e. the documented setup produced the defect.
  Corrected, with the reason. The dialog note (UX-17) is accurate and is now a
  callout rather than an 11px footnote.
- **Detection turned out to be exact, not heuristic.** A recorded row stores
  `raw_status` = the literal Stripe event type that wrote it, so "this endpoint
  delivered both families" is a STORED FACT about deliveries, not an inference
  from amounts or timing. `detectByoStripeDoubleRecording`
  (`packages/shared/src/utils/byoStripeEvents.ts`, pure + unit-tested in
  `packages/functions/src/billing/byoDoubleRecording.test.ts`) counts families
  over a 90-day window and Settings → Payments renders a warning naming the fix.
  It is bounded so it SELF-CLEARS once the endpoint is corrected, and it
  deliberately never pairs two rows — the one thing it cannot say without
  guessing is *which* two rows are the same money, which is exactly what the
  "may be a duplicate" chip leaves to the studio's own eyes.

The entry stays open because the duplication itself is unchanged.

**What would actually close it** (each has a real cost — pick deliberately):
subscribe BYO studios to `invoice_payment.paid` instead of
`invoice.payment_succeeded` (it carries both ids, so it converges — but adding it
*alongside* the invoice event makes the double-count worse, so it is a swap, not
an addition); or give the rail read-only credentials, which contradicts its
stated design; or dedupe across keys, which needs a second doc per payment.

"Nothing tells a BYO studio which webhook events to subscribe to" shipped on
**2026-08-18** (UX-60) and was deleted per the rule above. The event set that
lived only in the header of
`packages/functions/src/billing/handleTeamStripeWebhook.ts` is now stated on the
BYO integration dialog itself (`TeamSettings.paymentsWebhookEventsHelp`, Stripe
only — Payrexx has no equivalent hazard), naming the three to subscribe to and
naming `invoice.payment_succeeded` as the one to leave off, with the reason.

---

## 2. Stripe endpoint drift on staging (ops, not code)

Found while auditing the delivery side on 2026-08-16, against live Stripe:

- `linyup-staging/handleConnectWebhook` is **missing `payment_intent.succeeded`,
  `payment_intent.payment_failed` and `payout.paid`**, and carries an extra
  `payout.created`. On staging, **no member payment is recorded at all.**
- The three registered endpoints disagreed on `api_version`: staging's Connect
  endpoint pinned to `2026-04-22.dahlia`, the other two following the account
  default.

`pnpm stripe:sync --project <p>` now reports both (it pins `api_version` at
creation from the installed SDK, and reports drift on existing endpoints —
Stripe does not allow the version to be changed after creation, so a wrong one
must be recreated). Running it, and recreating the staging Connect endpoint, is
ops work that has not been done.

---

## 3. The subscription lifecycle backfill has not been run anywhere

Ops, not code — the companion to "Stripe endpoint drift on staging", and the same
shape: the tool exists and nobody has run it.

Every `member_subscriptions` and `saas_subscriptions` doc written before the
Dahlia readers shipped carries `current_period_end: null`, and none carries
`cancel_at` / `canceled_at` / `cancellation_details` at all — those fields were
not being read. `cancel_at_period_end` is the one that is only half wrong: the
old code read Stripe's boolean directly, so an API-initiated cancellation stored
`true`, while a BILLING-PORTAL one (which leaves that boolean false and states a
`cancel_at` instead) stored `false` and nothing else. **The webhook self-heals**
— on both rails the `created`/`updated` branches rewrite every lifecycle field
unconditionally, nulls included (the `cancelled` branches deliberately do not;
see CLAUDE.md, "A cancellation is a RECORD, not a boolean") — but the timing is
the problem, and it differs per symptom:

- a null period end heals at the next RENEWAL: up to a month, or a YEAR on an
  annual plan;
- a portal cancellation does **not** heal in any useful window. The `updated`
  event carrying `cancel_at` was already delivered, answered 200 and recorded in
  `last_event_id`; Stripe will not redeliver. The next event is the `deleted`
  one, which fires when the member is already gone — so the entire period a
  studio needs the warning for is the period nothing gives it.

The two interact: a STORED doc from that window that carries the boolean and no
`cancel_at` (nothing was reading one) leaves `subscriptionEndsAt()` falling back
to `current_period_end` for the date — which is null on the same doc. So its
third state stays dateless even after the code fix, until this runs.

`pnpm backfill:subscription-lifecycle --project <p>` re-fetches each subscription
from Stripe and repairs it through the same readers the webhook uses (dry-run by
default, `--apply` to write, re-runnable, exits non-zero on anything it cannot
repair). It was exercised end-to-end against live Stripe test data on 2026-08-16
— but its `payload()` has since been made PER-RAIL (it was writing a
`current_period_start` the Connect rail does not have, and a billing period on
the SaaS ended path that the `subscription.cancelled` branch never writes), and
that change has NOT been re-exercised end-to-end. What holds it today is
`connect/dahliaReads.test.ts`, which pins each branch against the handler it
mirrors. Re-run the dry run before trusting an `--apply`. **Not yet run against
sandbox, staging or production.**

---

## Smaller, unfiled

- **`stripe:listen` is unusable in a worktree.** The npm script hardcodes
  `localhost:5001`; a worktree's functions emulator is on its own port (15001
  here, per `firebase.worktree.json`). Same class of gap as `apps/admin/.env.local`,
  which pointed at the default emulator ports until it was corrected on
  2026-08-15 — server *and* client halves, since the client reads
  `NEXT_PUBLIC_AUTH_EMULATOR_PORT`. The worktree port scheme was designed
  properly and adopted inconsistently; one source of truth would end it.
- **Three Wave 3 Phase 3 minors** from the close-out round: a narrow
  self-correcting race on the appointment rail when a promo retry's
  session-close event beats the retry's own hold write; the members-only door
  card dropping its struck-through price once a promo beats the member benefit
  (display only); one under-qualified `only` comment in `staffBooking.ts`.

---

### Trial booking hides a failed read as "no trial sessions"

`apps/web/src/app/[locale]/(public)/public/[slug]/trial-booking/TrialBookingForm.tsx`
logs its failed session read (2026-08-16), but still renders the failure as an
empty list — a visitor who came to book a trial is told the studio offers none.

Left open deliberately: closing it means threading an error state through the
whole trial flow, which is more than the surrounding sweep was scoped for. It is
the one acknowledged exception to rule 1 in `apps/web/src/lib/publicQueryError.ts`,
and that header points here rather than quietly weakening the rule.

**Update, 2026-08-16 (from the public-surface identity census):** no visitor can
reach this component. `trial-booking/page.tsx` redirects to `/booking` with the
query intact, and nothing imports `TrialBookingForm`. So the exception above is
currently an exception to nothing — which makes deleting the file the cheapest
close, not threading the error state. Verify the redirect before acting on that.

### A priced appointment at a studio without Stripe Connect says the slot is gone

`AppointmentPicker.tsx` — a paying visitor at a studio whose Connect account is
not onboarded is told **"This slot is no longer available."** The slot is fine;
the studio simply cannot take money yet. Same false-sentence dead end that was
fixed for covered members in the same file (2026-08-16), one refusal reason over.

Pre-existing, and deliberately out of scope for that change: the honest fix needs
a decision about what a visitor should be offered when a studio cannot charge —
book anyway and settle at the door, or say plainly that online payment is not set
up. That is Franco's call, not a mechanical repair.

## Feature requests, queued (not defects)

Recorded here for the same reason as the defects above — the follow-up chips are
session-scoped and do not survive a restart.

### Link one document from another in the editor — SHIPPED 2026-08-17

Deleted per the rule at the top of this file. It shipped as
`feat(documents): link one document from another, latest by default`.

**The design recorded here was superseded before it was built.** This entry said
"pin the link to the target's version as of publish", to stop a live link
changing what a signed waiver meant. Franco cut that: *"at this stage we do not
care, studio own responsibility, and we did not even go live yet."* What shipped
is simpler — **latest by default, pinned only when the author says so** — with no
publish-time freezing and no publish-time validation. See
`packages/shared/src/utils/documentLink.ts` for the model and
`packages/functions/src/documents/documentLink.test.ts` for its fixtures.

## Newly recorded, 2026-08-17

### `pnpm backfill:gateway-data` has not been run anywhere

Ops, not code — the same shape as "The subscription lifecycle backfill has not
been run anywhere", and it needs the same treatment.

`saas_subscriptions` docs written before the dotted-key fix keep `subscription_id`,
`customer_id`, `last_event_id` and friends as **literal top-level fields named**
`"gateway_data.subscription_id"`, because `set()` takes a dotted key literally
where `update()` reads it as a path. Every reader now goes through
`readGatewayData`, which understands both shapes, so **nothing is broken while
this is outstanding** — this is cleanup, not a live defect. The webhook also
heals a doc on its next event.

The gap is the same as the lifecycle backfill's: a `cancelled` or `past_due`
subscription may never receive another event, so those docs stay in the old
shape indefinitely.

Run: `pnpm backfill:gateway-data --project <id>` (dry-run), then `--apply`.
Verified end-to-end against the emulator; never run against staging or prod.

### The pinned document-version read path is only half-verified

`getPublicDocumentVersion` is wired: the public document page reads `?v=`, calls
it with the right arguments, reports a failure rather than swallowing it, and
falls back to the latest text — all observed in a browser.

**What was NOT exercised is the callable itself.** The running functions emulator
predates the callable and discovers its trigger list at startup, so every call
returned a CORS/registration failure; registering it needs an emulator restart,
which would have wiped the seeded stack. So the *serving* half — that it returns
v1's frozen text, refuses a waiver, and applies the published+isPublic gate — has
only been read, not run.

Verify by restarting the emulator with a fresh functions build (export the data
first if you want to keep it) and following a pinned link to an older version.

### Stripe webhook handler params are typed `any`

Carried over rather than newly found — recorded here because it is the root cause
of a class, not one bug. Three shipped defects came from Stripe moving fields
between API versions; each read returned `undefined` silently. The SDK ships full
declarations, so **typecheck would have caught all three**. `utils/stripe/objectShape.ts`
now contains the reads that are known to have moved, with compile-time assertions,
but the handler signatures themselves are still `any`, so the next moved field
fails the same silent way. Retyping them is the durable fix; the blast radius is
why it has not been done.

### A new owner cannot upload an activity cover image, and the activity is created anyway

Found by manual exploration on **2026-08-17**, on a freshly created account.
Creating an activity **with a cover image** fails the Storage upload with
`FirebaseError: Firebase Storage: User does not have permission to access …`,
while the activity document **is created regardless**. The dialog then stays open
with the data still in it and reports nothing — so the obvious next move is to
press Save again, which creates a duplicate activity.

Two separate faults, and they need separate fixes:

**1. The Storage rule (this entry).** Activity images fall through to the broad
`match /teams/{teamId}/{allPaths=**}` block in `storage.rules`, whose
`isTeamMemberStorage(teamId)` does a `firestore.exists` on
`teams/{teamId}/team_members/{uid}`. On a brand-new account that document is
written by the client during signup self-provisioning (see CLAUDE.md, "Team member
self-provision"), so the upload is denied whenever it runs before that write has
landed or if the write did not happen at all. **Not yet reproduced against a
second account, and the exact ordering has not been traced** — do that before
changing a rule, because the wrong fix here loosens tenant isolation on the
broadest storage match in the file. Note that the narrower `products/` and
`documents/` blocks use the same helper, so if this is a provisioning race it is
not confined to activities.

**2. The silent partial failure** is a UX finding, not a rule bug — it is UX-24 in
`docs/archive/ux-review-2026-08.md`, and this reproduction is what upgraded it from
`traced` to `observed`. It is being fixed there, including the branch that
distinguishes "activity saved, image failed" from "nothing saved", so a retry
cannot mint a duplicate. Fixing the rule does **not** close UX-24: any other
upload failure (offline, size, content-type) reaches the same silent path.

---

## Newly recorded, 2026-08-25 — events + ranking

Found while reading the events and ranking code end to end before building the
rank-progression engine. All were read in the source at `b559addc`; none is
inferred from a symptom. The ranking-system org-awareness bugs, the duplicate
`RankLevel.value` bug and the mobile scalar-rank bug found in the same pass are
**not** here — they shipped in PR#105.

### `attendees` is an RSVP list wearing the word "attendance"

`events/{id}/attendees/{contactId}` is written by `handleEventInvitationResponse`
on `action: 'attend'` and deleted on `'decline'`. Nothing ever reconciles it
against who turned up, so a contact who accepts and never appears stays an
"attendee" permanently, and `attendees_count` counts acceptances.

Actual presence is the separate top-level `checkins` collection, counted by
`participants_count` / `completed_checkins_count`.

The two vocabularies have crossed: **`trackEventAttendees` is a trigger on
`checkins`** that maintains those two counters and never touches
`attendees_count` at all. Its own header says "Ported from
hmd-lineup/functions/src/trackEventAttendees", so the name arrived with the code
and the meaning drifted underneath it.

Renaming the function is free. Renaming the subcollection is a data migration, so
the cheap honest fix is the UI label plus the function name.

### A manager can send event invitations but cannot see who accepted

`events/[id]/page.tsx` gates the Attendees tab on
`isOrgAdmin || can('reports.view')`, while the Invitations tab beside it is
ungated. So a team manager invites people and then cannot see the responses —
`reports.view` is an odd capability to govern "who is coming to my event".

### One plugin's check-in payload lives in core

`isCheckinCompleted` (`packages/shared/src/utils/checkins.ts`) is a switch on
event type with no plugin hook, and its `default` branch reads
`Array.isArray(checkinData.categories)` — the fighting-cup shape. Core therefore
knows one tenant-specific plugin's payload, and a second plugin needing custom
completion logic has nowhere to put it but that same branch.

### `EventTypeConfig.contact_requirements` is declared and read by nothing

`packages/shared/src/types/event.ts` documents it as "contact fields that must be
set" (e.g. `['weight','birthdate']`). Repo-wide there are no readers outside the
type declaration and its build output. Either wire it into the check-in flow as a
prompt, or delete it — a declared-but-unenforced gate reads as a guarantee.

### A team's custom check-in fields are authored and never rendered

`EventTypeConfig.checkin_fields` has a full field builder in
`settings/event-types`, which saves and counts them. But `resolveFormType` in
`CheckinPanel` never consults `EventTypeConfig` — it dispatches on built-in slug
or plugin manifest only. A studio can build a custom check-in form and never see
it at check-in.

### Level `value: 0` cannot complete an exam

`isCheckinCompleted`'s exam branch is
`Object.values(disciplines).some((v) => (v ?? 0) > 0)`, and `ExamCheckinForm`
repeats the `> 0` guard and renders a stored 0 as "Not examined". Every preset's
FIRST level uses `value: 0` — BJJ White, Swiss "Krebs", HMD "No belt" — so
awarding the entry grade is unrecordable. The sentinel for "not examined" should
be absence of the key, not the value zero.

### Deleting a ranking level or system silently orphans every contact holding it

Neither ranking editor queries, counts or warns. `handleDelete` is a plain
`filter` + `updateDoc`, and the confirm copy is a static string with no contact
count. After a delete, `getPrimaryRank`'s `levels.find(l => l.value === value)`
misses and falls back to a floor-match, so a contact silently displays a
*different* belt.

### `getPrimaryRank` compares rank numbers across different systems

When no system is `is_primary`, it picks one with
`Object.entries(ranks).sort(([, a], [, b]) => b - a)[0]` — a raw numeric compare
between unrelated scales, so a Korean Dragon 7 outranks a Hwal Moo Do 3 and
decides which belt the contact appears to hold.

### The org-managed ranking banner links to a page with no ranking UI

`settings/team/page.tsx` renders "Ranking systems are managed by your
organization — Edit in organization settings" linking to `/org/{orgId}/settings`.
The editor is at `/org/{orgId}/ranking`; the settings page contains no ranking
UI. The banner text and link label are also hardcoded English while the rest of
the tab is translated.

### `ExamCheckinForm` is untranslated and points org tenants at the wrong place

Seven hardcoded English strings, and its empty state says "Add ranking systems in
Team Settings" — wrong for an org-managed tenant, whose systems live on the
organisation and whose team tab is locked.

### The rank filter cannot express "this belt and above"

`contactFilter.ts` matches ranks by exact set membership
(`levels.includes(rank)`) with no comparison operator. "Blue and above" — the
normal way a coach thinks about a roster — requires ticking every level
individually, and silently goes wrong the moment a level is inserted.

### HMD migration: exam history arrives in a shape nothing reads

`passes/08-events.ts` copies the source `checkins` verbatim, so a legacy exam
check-in keeps hmd-lineup's payload (`exams.hmd_rank`, `is_hmd_exam`,
`is_graded`). Linyup's shape is `checkin_data.disciplines: { [systemId]: level }`.
The history is therefore present on disk and invisible to every reader — and it
is exactly the input the rank-progression engine's backfill needs. A remap pass
is a prerequisite for the belt work, not a tidy-up.

### HMD migration: fighting-cup categories are dropped

hmd-lineup kept categories in a **global** `categories` collection; Linyup keeps
them per-event at `events/{id}/categories`. No migration pass references the
source collection, so migrated cup check-ins carry `categories: [id]` arrays
pointing at ids that exist nowhere in the target. Historic cup line-ups are not
reconstructable without a new pass.

### HMD migration: rank values are carried over unvalidated

`transforms/contacts.ts` writes `ranks[systemId] = Number(hmdRank)` with no check
that the number exists in `HMD_BELT_LEVELS`. A bad source value becomes a rank
that renders as a floor-matched neighbour (see `getPrimaryRank` above).

### Unverified in PR#105, by admission

Two things shipped typechecked but unseen: the **member app's** rank rendering
was never run on a device (it is the code that decides whether a migrated HMD
member sees their belt or "NO BELT"), and the `image` arm of `RankBadge` was
never exercised with a real upload. The other three arms — split, emoji, solid —
were checked in a browser against computed styles.

---

## Queued, not a defect — the two website builders have diverged

**Requested 2026-08-25 (Franco): align the org website builder with the team
one, reusing components as far as possible.** Recorded here rather than started,
because it is its own workflow.

What is actually there today — two parallel implementations, near-identical in
size and drifting apart:

| | team (`plugins/website/`) | org (`org/[orgId]/website/`) |
|---|---|---|
| Section editor | `SectionEditor.tsx`, 556 lines | `OrgSectionEditor.tsx`, 569 lines |
| Defaults | `defaults.ts`, 84 | `defaults.ts`, 80 |
| Hooks | `hooks.ts`, 125 | `hooks.ts`, 99 |
| Menu tree | `MenuPanel.tsx` | **absent** |
| Embed widgets | `EmbedWidgets.tsx` | **absent** |
| Preview overlay | `PreviewOverlay.tsx` | **absent** |

The types are separate too: `WebsiteSection` / `WebsiteSectionType` in
`types/website.ts`, `OrgSiteSection` / `OrgSiteSectionType` in
`types/orgWebsite.ts`.

**The cost is not duplication, it is drift.** The header-menu tree shipped for
teams (`MenuTarget` — `kind: 'section' | 'surface' | 'url' | 'none'` — in
`types/website.ts`) has no counterpart in `orgWebsite.ts` at all, so an
organisation cannot arrange its header the way a studio can. Every future
website feature is now two builds, and whichever tier is not in front of the
author quietly falls behind.

Worth deciding at the start, because it shapes the whole job: whether the two
converge on ONE section model with a tenant discriminator (the promising
direction — it is how `RankLevelFields` fixed the same shape of divergence
between the two ranking editors), or stay separate models sharing only leaf
components. The first removes the drift; the second only slows it.
