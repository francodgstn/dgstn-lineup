# Open defects

Confirmed bugs that are **not** fixed, each reproduced against real data rather
than inferred. This file exists because the in-app follow-up chips are
session-scoped — they do not survive an app restart, and the evidence behind them
is expensive to re-derive.

Every entry states what was **verified**, so whoever picks it up starts from
evidence rather than from a symptom. Delete an entry when it ships; do not let it
rot into a claim nobody has re-checked.

Found during manual testing of the local stack on **2026-08-15**, against
commit `129a8c9` (Wave 3 Phase 3). All were **pre-existing** — none was
introduced by Wave 3 — and all survived a full static pass (typecheck, 784
tests, lint, four adversarial review lenses). They are integration-boundary
defects: the code is correct about itself and wrong about the outside world,
which is the category automated verification is structurally blind to.

Entry 3 (Space "My courses" 403) shipped on **2026-08-16** and was deleted from
this file per the rule above. The fix lives in the `{path=**}/purchases` block in
`firestore.rules` and is held in place by
`packages/functions/src/connect/coursePurchaseAccess.test.ts`.

---

## 1. Stripe Connect reads a pre-Basil object model

**Severity: high.** Three symptoms, one root cause.

`stripe-node` is `^22.1.1` and `apiVersion` is deliberately unpinned
(`packages/functions/src/utils/connect/client.ts`, with a stated reason), so the
bundled default is Stripe's **Basil** API version (2025-03-31) or later. Three
fields the Connect webhook reads were moved or removed in Basil. Each read yields
`undefined`/`false` silently — no exception, no failing test, just wrong data
written confidently.

| Symptom | Field read | Where it lives now |
|---|---|---|
| Subscription's first payment shows "unassigned" in the admin Payments Contact column | `invoice.payment_intent` | `invoice.payments.data[].payment.payment_intent` |
| Membership expiry stored `null` | `subscription.current_period_end` | `subscription.items.data[].current_period_end` |
| A billing-portal cancellation surfaces nowhere | `subscription.cancel_at_period_end` | `subscription.cancel_at` (a timestamp; the boolean stays `false`) |

**Verified live**, not inferred:

- invoice `in_1U4jtbGz6xp8VQ38TFp0ScIe` — `payment_intent` key **absent**;
  `payments.data[0].payment.payment_intent = pi_3U4jtbGz6xp8VQ38150eBCOy`
- subscription `sub_1U4jtdGz6xp8VQ38RRkK37D0` — top-level `current_period_end:
  None`; `items.data[0].current_period_end: 1789487599`
- same subscription after cancelling in the portal — `status: active`,
  `cancel_at_period_end: False`, `cancel_at: 1789487599 (2026-09-15)`,
  `cancellation_details: {reason: cancellation_requested}`

**Webhook delivery is NOT the problem**: two `customer.subscription.updated`
events were forwarded and both returned 200; `last_event_id` on the stored doc
matches the second. The handler ran and stored the wrong thing.

Consequences beyond the visible ones: `stampFinanceContact` never runs, so the
**finance row** for every subscription's first charge is also missing its
contact; and `membershipExpiration` is written `null` — check whether anything
treats a null expiry as "never expires" for access gating.

**The work is a migration, not three patches**: audit every Stripe field read
across `connect/`, `appointments/`, `booking/`, `finance/` and `scripts/`
(including `handleInvoice`, the renewal path, and the SaaS-side
`handleStripeWebhook`), fix modern-first with a legacy fallback, and **decide
explicitly on pinning `apiVersion`** — an unpinned version is exactly what let
three fields move underneath working code. If it stays unpinned, add a guard
that fails loudly on an absent expected field.

Also needed: the UI cannot currently express "cancels at period end", which is a
third state distinct from active and cancelled. Storing `cancel_at` is not enough
— the admin subscription views and the contact Space need to show it.

---

## 2. The appointment picker ignores the signed-in contact session

**Severity: medium-high** (pending the pricing question below).

`PublicContactAuthProvider` wraps **every** `/public/{slug}/*` route from
`layout.tsx`, so a signed-in contact's session is in context on the appointments
page. `AppointmentPicker.tsx` references `usePublicContactAuth` **zero times** —
it is the only public surface that does not. Booking, shop, signup, site, kiosk,
forms and Space all consume it (`BookingForm.tsx` does so at its component top).

Symptom: an already-signed-in contact opening the appointments flow is asked for
contact details or to sign in again.

**Unanswered questions that decide the severity** — answer them, do not assume:

1. Does a member with an appointments `memberBenefit` get quoted the **guest
   price**? The rail builds a client snapshot and calls `resolvePaymentOptions`;
   an unrecognised caller may not resolve their coverage. Determine whether the
   guest path re-matches by email later (self-correcting) or whether they are
   genuinely charged wrongly.
2. Can an existing member take a `new_contacts`-scoped promo code here? That is
   the laundering hole already closed on the drop-in rail via
   `resolvePromoCaller`. Check whether the server-side resolver saves us.
3. Does the per-contact promo cap reset for an unrecognised caller?

Coordination: Wave 3 Phase 4 adds a waiver gate to this same rail and also needs
contact identity — see `docs/wave3-phase4-spec.md` §7.3, which documents the
picker's three terminal submits including an `autobooking` path that books
automatically on verification.

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

## Feature requests, queued (not defects)

Recorded here for the same reason as the defects above — the follow-up chips are
session-scoped and do not survive a restart.

### Link one document from another in the editor

Requested 2026-08-16. From the "/" slash menu and the toolbar, link another
document inside a document's body.

**Smaller than it sounds:** `apps/web/src/components/RichTextEditor.tsx` is TipTap
3.26 with a working slash menu (`components/editor/SlashCommand.tsx`), a toolbar,
and `@tiptap/suggestion` already a dependency; the server sanitizer already permits
`a` with `href`/`target`/`rel`. A new slash item is one array entry.

**Store a reference, never the rendered URL.** Both the team slug and the document
slug are editable, so a stored URL breaks silently — inside a legal document.
Validate at publish that every linked document is actually published and public,
or a visitor follows a link mid-consent into a 404.

**The decision that matters — a live link breaks a waiver version's immutability.**
A published waiver freezes `bodyHtml` and stores a `bodyHash`, which is what makes
an acceptance mean *this person agreed to THIS EXACT TEXT*. A link to "our
cancellation policy" ends that: the studio edits the policy in June, the March
signature still verifies, and what was agreed has silently changed.

**Franco's decision: pin the link to the target's version as of publish**, so the
pinned reference travels inside the frozen snapshot and a reader sees the document
as it was. Render the target's title with an "as published" affordance, and a route
to the current version. Open question recorded for whoever builds it: what
non-waiver documents do, where there is no snapshot and a live link is the natural
behaviour — one mechanism differing by kind is fine if the difference is visible to
the author; two mechanisms are not.
