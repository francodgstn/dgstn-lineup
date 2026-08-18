# Open decisions — parked for Franco

Questions raised while working the UX review that need a product call rather than a
code judgement. Recorded here as they arise so the autonomous run does not stall
and does not guess. Each entry states what was done in the meantime, so nothing is
blocked waiting for an answer.

Status legend: **PARKED** (needs a decision) · **ASSUMED** (proceeded on a stated
assumption, reversible) · **ANSWERED** (decided; kept for the record).

---

## 1. Promo codes on memberships — deferred, not refused
**ANSWERED 2026-08-17.** UX-25 shipped an intro offer owned by the PLAN (first N
periods). Promo codes on memberships stay deferred: a promo is a Stage A modifier
inside `resolvePaymentOptions`, which returns ONE amount, while a recurring discount
is a schedule. Revisit only if studios ask for a *code* rather than a standing offer.

## 2. Weekly-report distortion if a stage backfill is ever run
**PARKED.** UX-83 makes `trial_* → joined` write a conversion row. A backfill of
already-stranded contacts would dump months of historical conversions into ONE
week's `trial_conversions_count` (`trackContacts` stamps the current week).
*Meanwhile:* nothing was backfilled — pre-launch, no production tenants, and no
seeder writes `signup_completed_at`. **Decide before the first real migration**, not
before launch.

## 3. `hmd-fighting-cup` and other tenant-specific plugins
**PARKED, low priority.** Noticed while auditing plugin teardown (UX-16). A
customer-specific plugin sits in the generic catalogue. Not a defect; a product
question about what belongs in a white-label catalogue.

## 4. Automation delays (UX-85)
**ANSWERED 2026-08-18 — Franco: build them for real.** Pre-launch, no productive
data, so the migration concern below is moot. Original note kept for the record: Ten triggers store a
`delayMinutes` that nothing reads; only `session_ended` is really deferred. Two
non-equivalent fixes: route event rules through the Cloud Tasks path (a real
feature — needs a queue handler and a decision about what a delayed rule does if
the contact changed meanwhile), or set `supportsDelay: false` and hide the field
(honest and immediate).
**The blocker is data, not code:** existing rules already carry a delay a studio
believes in. Hiding the field silently converts "3 days later" into "immediately";
building the feature makes those rules start behaving as written, possibly years
after they were composed. *Meanwhile:* nothing changed, and the new
`acquisition_stage_changed` trigger declines the delay so it adds no new instances.

## 5. Should the starter bundle install "Welcome a new member"? (UX-84)
**ASSUMED: no.** `STARTER_BUNDLE_KEYS` drives the one-click quick-start, and
changing what a new studio gets on day one is a first-run product decision, not a
copy fix. The library item ships and is installable; it is simply not bundled.
One-line change if you want it in.

## 6. Cloud Tasks region fix wants eyes on the first deploy (UX-85)
**ASSUMED, needs confirmation once — not blocking.** `getFunctions().taskQueue()`
with a bare name resolves to `us-central1` (firebase-admin `DEFAULT_LOCATION`)
while our functions live in `europe-west6`, so every delayed-rule enqueue has
been posting to a queue that does not exist. The error is swallowed by `to()`,
which is why nobody noticed. Now fully qualified.
**This was verified statically and against a local probe, NOT against a deployed
404.** The Tasks emulator is a plain FIFO that ignores `scheduleTime`, so the
one thing local testing cannot prove is that the wait actually happens.
*Action on first sandbox deploy:* create a rule with a short delay, fire it, and
confirm the task is scheduled rather than dispatched immediately.

## 7. Three affiliation triggers still use a random occurrence id (UX-85)
**DONE 2026-08-18** — patched once the file was free; all 11 event triggers now
derive the key from the CloudEvent id. Original note: `onAffiliationWrite.ts` was in a reserved lane, so
`affiliation_added/removed/changed` fall back to `randomUUID()` for the dedup
occurrence instead of the CloudEvent id. It still collapses a Cloud Tasks
redelivery, and a duplicate Firestore delivery falls to the per-rule/per-contact
window — the same protection the inline path has today, so there is no
regression. *Follow-up:* add `{ eventId: event.id }` at
`packages/functions/src/sync/onAffiliationWrite.ts:124/129/135`.

## 8. ⚠ Seeded tenants now show NO priced doors (UX-33) — affects the next demo
**PARKED, and the most time-sensitive item here.** `payments_enabled` fails closed,
and **no seed writes `teams/{id}.payments`** — so every emulator, sandbox and lead
tenant now reads `payments_enabled: false`: no shop surface, no drop-in price, no
priced trial, no priced appointment duration.

The lane deliberately did **not** fake `connectStatus: 'enabled'` in the seeds,
which is right — that reproduces the exact lie UX-33 exists to remove. The honest
fix is linking a real **test-mode** Connect account; the tooling already exists
(`scripts/lib/connect.ts`, `scripts/connect-test-account.ts`).

*Action:* do this before the next live demo **if priced surfaces are part of it.**
Until then the demo tenants show a free-only product, which is coherent but not
what you would want to present.

## 9. Org trials never expire
**PARKED.** `handleTrialLifecycle` sweeps `TEAMS_COLLECTION` only, while
`createOrganization` grants a 14-day trial that nothing ends. An unpaid org — and
every studio it bills — sits on the top tier indefinitely. UX-35 removed the
*accidental* sweep that used to catch member teams, so this is now the only thing
between an unpaid org and unlimited access.
**The decision:** what should a lapsed org trial do to its member teams? Free (like
a team trial), a fresh Studio trial (like `removeTeamFromOrg` does), or read-only?
Not guessed. *Meanwhile:* nothing expires, which is the pre-existing behaviour.

## 10. An org lapse mounts features it no longer pays for
**PARKED.** On `past_due`/`cancelled` the webhook propagates `plan_status` to member
teams but leaves `plan: 'organization'` and deactivates no installs — where the team
rail calls `downgradeTeamToFree`, which does. Client `pluginAccessForPlan` reads the
plan only, so navigation stays mounted while every gated callable 403s.
**The decision:** should a lapsed org deactivate its org-level installs?

## 11. Should a studio that takes payment offline get a read-only price list?
**PARKED, product call.** Hiding the shop (UX-33) removes the only surface where a
visitor can see membership prices. A cash-only studio may still want prices
published with no buy button.

## 12. Org-admin invitations by email
**ASSUMED: out of scope.** UX-34's add-member is a **grant** against an existing
Linyup account; an address with no account gets a named refusal rather than a
placeholder user. A pending-invitation lifecycle would need its own accept surface
and expiry sweep, and `org_invitations` already means something else (inviting a
whole team). Say if you want it.

## 13. `public_profile` is client-writable by any team member
**NOTED, not acted on.** `payments_enabled` — like `showBranding` and
`public_pages_indexable` before it — can be flipped client-side. Display only:
every checkout still refuses server-side, so this changes what a page *shows*, not
what it can *take*. Tightening the rule would break the bio-link settings editor.

## 14. Should automation run history name recipients? (UX-48)
**PARKED — schema decision.** `AutomationLogData` records COUNTS only
(`contacts_matched`, `actions_executed`, `actions_failed`), so "to whom" is not
recordable today. The dialog says so plainly rather than implying a roster it does
not have. Adding it means a capped recipient array on the log, which is three
questions at once: how many ids, what retention, and whether PII belongs in a log
any manager can read. *Meanwhile:* the dialog points at Preview, which answers
"who matches right now".

## 15. Two indexes must deploy BEFORE the code that queries them
**ACTION, not a decision — carried into the sandbox tag annotation.**
- `automation_logs (rule_id ASC, triggered_at DESC)` — new today (UX-48); the
  per-rule "Run history" item is its only caller.
- `bookings` collection-group `(teamId, contact, joinedAt DESC)` — from UX-10.
The emulator hides a missing index; a real project returns 400. Order:
rules+indexes, then functions, then web.

## 16. Cancelling a link-mode appointment does not close its Stripe link (UX-59)
**PARKED, and it is the same family as the bug just fixed.** A manager cancelling
a link-mode appointment from the sessions UI leaves the Checkout Session live —
the client can still pay, and the webhook's case 3 then **re-acquires and
confirms the cancelled slot**. Now cheap to fix (UX-59 stores
`payment_checkout_session_id`), but it touches `sessions/index.ts` plus the
client-side cancel path, so it was left rather than widened into a live lane.

## 17. A gift-card-covered trial carries no "Paid trial" chip (UX-66)
**NOTED, no action.** Full-cover gift-card redemption writes a finance reclass and
no payment row at all, so there is nowhere to put the stamp. A property of
full-cover redemption generally, not of trials. Recorded in
`docs/payment-contact-studio.md`.

## 18. UX-60 remains STRUCTURALLY open — the chip is a warning, not a fix
**PARKED.** BYO double-recording is caused by the Stripe API no longer letting an
`invoice.*` payload name its PaymentIntent (or vice versa), with no credentials on
that rail to bridge them. Today's work makes the suspect rows *visible* and tells
the studio which events to subscribe to; it does not stop the duplication. The
three real closes each have a cost and none was mine to pick: swap to
`invoice_payment.paid`, give the rail read-only credentials, or dedupe across
keys. `docs/open-defects.md` entry 1 says explicitly that this is still not a fix.

## 19. Should search find archived and deleted contacts? (UX-21)
**PARKED — scope, not mechanism.** `useActiveContacts` filters them out, so looking
up a former member returns nothing. Fixing it costs a second query per panel
session. *Meanwhile:* active contacts only, matching every list page's default tab.

## 20. "Recent contacts" in the empty search panel — deliberately not built
**ASSUMED: no.** It was on the brief as a candidate, and it would be a FOURTH
remembered-destination store on the day UX-23 reduced three overlapping ones to
clearly-named distinct concepts. Say if you want it; it should reuse the Open-tabs
store rather than adding another.

## 21. The public-pages hub is missing the appointment picker (UX-28)
**PARKED, small.** `/public/{slug}/appointments` is a genuine public surface — the
How-to list treats it as one — and the hub's census omits it. Not added because
`usePublicSurfaces` has no `appointmentsLive` flag and the live signal comes from
`active_public_surfaces` in `packages/functions` (reserved that round). **A row
with a guessed live state would be worse than an absent one.**

## 22. "Scheduling" in the settings rail is now two rows (UX-67)
**NOTED.** Event types and Booking page remain there. Only Places was used
mid-task while scheduling, so only Places moved — but a two-row group is worth a
second look.
