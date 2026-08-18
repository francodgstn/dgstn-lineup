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

## 4. Automation delays: build them, or admit they don't exist (UX-85)
**PARKED — the only genuinely blocking one so far.** Ten triggers store a
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
