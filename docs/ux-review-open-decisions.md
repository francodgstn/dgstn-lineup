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
