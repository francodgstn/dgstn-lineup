# Wave 3 — Phase 4 implementation spec: WAIVERS

> ## ⚠ AMENDED 2026-08-16 — THE GUARDIAN MACHINERY WAS REMOVED IN FULL
>
> This document specified, and this phase shipped, an emailed one-time guardian
> link: a `guardian_requests` store, three public callables, a public signing
> page, a mail template, four rate-limit counters, a bounce fan-out, a
> date-of-birth question, and two rails that completed with a waiver outstanding.
> **All of it is deleted** (Franco's decision — see **§4**, which is now the
> amendment rather than the design).
>
> An emailed link proves control of a **mailbox**, not parenthood. The studio is
> the party with the legal exposure and the only party who can actually verify a
> participant's age, so the product prompts that check instead of simulating an
> enforcement it cannot deliver: one optional flag on the waiver
> (`mayIncludeMinors`), one required **self-declaration** on the consent step,
> and a chip on the roster and the printed manifest.
>
> **Read `docs/waivers.md` for what is built.** Everything below is the spec as
> written, kept for its reasoning; wherever it describes guardian requests,
> `guardianRequired`, `resolveGuardianNeed`, a declared date of birth, a
> deferring rail, `waiver_state: 'outstanding'`, or invariants **W12 / W14 / W15
> / W26 / W27**, it describes **no code**.

Implementable spec produced by surveying the Documents surface, every booking
entry point, the mail machinery and the roster surfaces in this worktree, then
reconciling them against the resolved design in `docs/fareharbor-analysis.md` §7
(§7.4 Phase 4, §7.6 guardians + Documents de-gating, §7.7 the two known defects).
Predecessors: `docs/wave3-phase01-spec.md` (gift cards),
`docs/wave3-phase2-spec.md` (waitlist), `docs/wave3-phase3-spec.md` (promo
codes). Surrounding patterns: `docs/waitlist.md`, `docs/promo-codes.md`,
`docs/appointments.md`, `docs/payment-contact-studio.md`,
`docs/product-strategy.md`.

> **Citations are pinned to commit `129a8c9` and were re-read on 2026-08-15.**
> Every `file:line` below was opened in this tree after Phase 3 landed. The three
> surveys that fed this document carry line numbers that drifted in a handful of
> places (`firestore.rules` delete grant, the `syncTeamPublicProfile` documents
> block, `RESERVED_SLUGS`) — do not carry those forward; carry these.

**Scope.** A liability release the visitor accepts at booking, with a versioned
acceptance ledger, surfaced on the roster and the manifest. Waivers extend
Documents rather than introducing a new entity, Documents stops being a plugin,
and version publishing gains three named outcomes the studio picks per publish.
This is the last Wave 3 phase and the one with the smallest interaction
footprint: there is **no waiver arm in `resolvePaymentOptions`**, no price, no
finite counter, and therefore no reserve → commit → release lifecycle. Its one
prerequisite — Phase 2's transactional `bookSession` — is met.

**The governing rule, restated because §1, §3 and §8 all depend on it:**

> **A signature is a fact about a person, not a claim on a scarce resource.**
> Nothing about a waiver is reserved, held, released or restored. The promo
> phase's entire reserve/commit/release apparatus has no analogue here, and
> reaching for it is the single biggest way this phase goes wrong.

The second rule, which is the whole of §1's hard problem:

> **The acceptance ledger is append-only EVENTS plus one mutable CURRENT-STATE
> row.** Re-signing, expiry and revocation are states of the second, never edits
> to the first. Errors are fixed by new rows, never edits — the discipline
> `packages/shared/src/types/finance.ts:33-40` already states for the journal.

---

## 0. Ground truth

### 0.1 What exists that this phase builds on

| Piece | Where | What Phase 4 does with it |
|---|---|---|
| The document type | `packages/shared/src/types/document.ts` — `DocumentKind` (`:24`), `StudioDocument` (`:26-44`), `DocumentPublicProfile` (`:52-63`) | `DocumentKind` gains `'waiver'`; `StudioDocument` gains version pointers and an optional `waiver` block; the mirror gains version fields (§1.3) |
| The public mirror sync | `packages/functions/src/sync/syncDocumentPublicProfile.ts` — `isLiveDocument` (`:23-24`), delete gate (`:36-42`), sanitize seam (`:57-60`), `touchTeamForSurfaceRecompute` (`:71-74`) | Learns `kind === 'waiver'` (a required waiver must be presentable to a visitor who never opened the studio's public documents page — §1.3) |
| The sanitizer | `packages/functions/src/utils/sanitizeHtml.ts` — `sanitizeRichHtml` | The seam where a version snapshot's `bodyHtml` is frozen. **The one place text becomes immutable** |
| Documents rules | `firestore.rules:1346-1359` | Narrowed: a document that has ever been published cannot be deleted; a `kind: 'waiver'` document is callable-only (§1.6) |
| `signup_documents` | `TeamPublicProfile.signup_documents` (`packages/shared/src/types/team.ts:458`), computed at `syncTeamPublicProfile.ts:106-131` and written at `:227` | Gains a real `version`; its plugin-config source moves (§6) |
| The signup consent checkbox | `SignupForm.tsx:43` (`z.literal(true)`), `:471-505`, `:233-236` | Becomes a real acceptance. `version: ''` (`:235`) is the anti-precedent this phase retires (§0.3 W-B3) |
| The consent write | `packages/functions/src/auth/completeSignup.ts:165-181` (`consent`), written onto the contact at `:211` | Deprecated in place; the ledger supersedes it (§9 P4-Q) |
| Transactional `bookSession` | `packages/functions/src/booking/index.ts:1109-1251` — read set is `sessions/{id}` (`:1111`), the whole `bookings` subcollection (`:1113`), and conditionally a credit grant / usage window. **No contact read** | The acceptance is written inside it (§3.3) |
| The access gate seam | `booking/index.ts:913-921` (`resolveBookingAccessGate`), read-only, immediately above contact resolution at `:923` | Where the waiver gate sits (§3.2) |
| Token-link pattern | `generateSecureToken` (`packages/functions/src/utils/crypto.ts:19-21`); waitlist's two-token page (`booking/waitlist/manage.ts`, `claim.ts:79-83`); scoped-not-collection-group lookup (`dropIn.ts:272-274`); peek-then-charge rate limiting (`claim.ts:76`, `:91`) | The guardian link is built from all four (§4) |
| `publicUrl` / `publicPath` | `packages/shared/src/publicRoutes.ts` — `PublicRoutable` (`:25-34`), `PublicRouteParams` (`:91-113`), `TokenParams` (`:73-75`) | Gains `'waiver'`. Its header records why the contract lives in `@linyup/shared` |
| Mail send + ledger | `packages/functions/src/mail/mailService.ts` — `dispatch` (`:115-215`), the idempotency skip (`:136-144`), the ledger write **after** the provider call (`:197-212`), `idempotencyKey` (`:260-262`); `MailSendRecord` (`packages/shared/src/types/mail.ts:26-39`) | One send per signer with a per-signer key, and `OutboundMessage` gains an optional `ledgerMeta` so the linkage lands in the SAME `ledgerRef.set` rather than a racing second write (§2.3) |
| Long-running job shape | `processScoresRebuildJob` (`packages/functions/src/gamification/processScoresRebuildJob.ts:37-42`) — an `onDocumentCreated` worker on a job document with `timeoutSeconds: 540` | The notify fan-out's driver. A callable cannot drain 400 serial sends (§2.3) |
| Suppressions | `packages/functions/src/mail/suppression.ts` — `isSuppressed`; `MailSuppression` (`types/mail.ts:15-21`) | Checked **explicitly** before every notice, and recorded (§2.3). Also re-checked at **report read time**, so a missed webhook degrades to `suppressed` rather than to a false "not confirmed" (§2.4) |
| Brevo webhook | `packages/functions/src/mail/handleBrevoWebhook.ts` — `classifyBrevoEvent` (`:41-47`), `updateLedgerStatus` (`:53-67`), `LEDGER_STATUS` (`:24-33`), `SUPPRESSION_EVENTS` (`:13-21`) | Gains a fan-out onto the notice row, carrying **its own** event map — `LEDGER_STATUS` has no `unsubscribed` entry and maps `soft_bounce` to `bounced` (W-B11, W-B13) |
| The delivery predicate | `offerWasDelivered` (`packages/functions/src/booking/waitlist/constants.ts:74-92`) | Reused for "was it even attempted"; **it is not "delivered"**, and §2.4 turns on that distinction. It cannot distinguish a tenant policy drop from the environment kill switch, so §2.3 splits them with a separate `isMailEnabled()` read |
| The mail kill switch | `isMailEnabled()`, short-circuited at `mailService.ts:127-130` **before any Firestore work**, so it writes no ledger row at all | Read **once per notify pass** so a disabled environment records `not_sent_env` — a fact about the environment — rather than `blocked_by_policy`, which is a fact about the recipient (§2.3, correction in §0.4(e)) |
| Attendance writes that are **not** bookings | `selfCheckIn` (`packages/functions/src/sessions/index.ts:800`, writes `sessions/{id}/participants/{contactId}` at `:927` with **no booking required** — the booking read at `:947-949` only confirms an existing one); **`checkInContact` (`contacts/index.ts:107`, its staff-side twin — `batch.set(participantRef, …)` at `:214`, booking read at `:210` also confirm-only)**; `handleEventInvitationResponse` (`events/index.ts:360`, writes `events/{id}/attendees/{contactId}`); `addEventCheckin` (`events/addEventCheckin.ts:22`); staff participant writes (`sessions/[id]/page.tsx:250-261`) | The attendance paths the booking-callable census cannot see. Each is decided explicitly in §3.10 — gated, exempted-with-a-reason, or surfaced — because a set is only enumerated when the exemptions are as explicit as the inclusions (§8.1 shape 5). **`checkInContact` was added when P4-G re-ran the write-site grep; the first draft named `selfCheckIn` and missed its staff-side twin, which is §8.1 shape 5 recurring one level down inside the row that exists to foreclose it.** |
| Plan gate | `packages/functions/src/utils/plan.ts:19-44` (`requirePlan`), whose docblock (`:5-18`) requires public callers to map `plan_required` / `plan_inactive` | Creation only (W17) |
| Locked-but-visible nav | the promo entry, `apps/web/src/app/[locale]/(auth)/layout.tsx:188-194`, with its reasoning comment at `:184-187` (`minPlan`, **not** `requiresPlugin`) | The waiver kind is offered locked, never hidden (§7.1) |
| Current-state row + event history | `PromoRedemption` (`packages/shared/src/types/promoCode.ts:263-277`) — a mutable per-identity row whose immutable facts live elsewhere; the subcollection-not-a-map size argument (`promoCode.ts:101-107`) | The exact shape the acceptance ledger copies (§1.4) |
| Fix-by-a-new-row | `packages/shared/src/types/finance.ts:33-40`; `recordFinanceTransaction`'s `.create()` + swallow gRPC 6 (`packages/functions/src/finance/journal.ts:52-59`) | The event rows' write discipline (§1.4) |
| Roster badge from side-loaded data | `sessions/[id]/page.tsx:500-529` (`rosterContactsQ` `:502` → `rosterCoverage` Map `:520` → `showsNoSubBadge` `:528-529`), rendered `:872-877`. Note the deliberate `=== false` at `:529`: unknown renders nothing | The waiver chip's tri-state shape — and its cost warning (§7.4) |
| The manifest row | `manifest/page.tsx:266-296`; the `unpaid` chip at `:279-281` is the template | The waiver chip's placement (§7.4) |
| The print stylesheet | `apps/web/src/app/globals.css:316-393` — blanket chrome hide (`:327-333`), the simple-selectors-only note (`:340-347`), backgrounds forced transparent (`:374-379`), `@page { margin: 14mm }` (`:390-392`) | Constrains the chip to a glyph, not a fill (§7.4) |
| Contact fields | `packages/shared/src/types/contact.ts` — `birthdate?` (`:107`), `emergency_contacts?` (`:120`, type `:74-78`), `login_emails?` (`:100-105`, cap `MAX_CONTACT_LOGIN_EMAILS` at `:82`) | `birthdate` is written by the waiver step and nowhere else new (§4.5) |
| Rate-limit buckets | `checkoutRateLimit(ip, prefix)` / `assertUnderCheckoutRateLimit` (`connect/checkout.ts`). Taken: default `'checkout'`, `'gift-buy'`, `'gift-check'`, the waitlist claim bucket, `'promo-check'` | One new bucket: `'waiver-check'`. (`'waiver-guardian'` was added and then removed with §4) |

**Baseline gates, to be measured in this tree before the first commit** (Phase 3
reported 551/8/0 at `4b3177f`; re-measure at `129a8c9` rather than carrying that
number forward — the census owner is the command itself):
`pnpm --filter @linyup/functions test` · `pnpm typecheck` · `pnpm lint`.

### 0.2 The hooks earlier phases left, and the one they did not

1. **`checkoutRateLimit(ip, prefix)`** — Phase 0's `prefix` parameter exists so a
   new public probe gets its own bucket. Two are claimed here (§7.3).
2. **`details: { reason }` on every refusal** — Phase 2's vocabulary, extended by
   Phase 3 to one translated string per reason. Waiver refusals join it (§3.5).
3. **Phase 2's transactional `bookSession`** — the stated prerequisite
   (`docs/fareharbor-analysis.md:512-517`). Met: the commit is one transaction
   (`booking/index.ts:1109-1251`) with no contact read, so an acceptance write
   inside it costs no extra read (§3.3).
4. **Nothing was left for the notice layer.** Phase 2 shipped a spec whose
   notification layer no work item owned, and it was never built. §2.3, §2.4 and
   **⚛ ATOMIC GROUP C** exist specifically so that cannot recur here: the send
   and the read-back land in one commit, because a notice nobody can audit is
   exactly the "decorative" outcome Decision 5 rejects by name.

### 0.3 Pre-existing bugs this design pass uncovered

All were live at `129a8c9` and each was confirmed against the code, not inferred.
Where a defect sits on a line Phase 4 rewrites anyway it is fixed here; where it
does not, it is named and deliberately left, so the next reader does not assume
Phase 4 blessed it.

---

**W-B1 — accepted text is deletable by any manager, from a live button.**
`firestore.rules:1354` grants `update, delete` on `documents/{documentId}` to
`hasTeamRole(teamId, 'manager')` with no further condition, and it is wired to a
Delete action on the document detail page
(`apps/web/src/app/[locale]/(auth)/plugins/documents/[documentId]/page.tsx`).
Today that destroys a terms document whose acceptance
`completeSignup` recorded; under Phase 4 it would destroy the text of a signed
waiver.

**Fix (P4-D).** Two narrowings on the same rule block: a document that is
published **or** carries a version cannot be deleted at all, and a
`kind: 'waiver'` document is not client-writable in any way (§1.6). Both are
single conditions, both are falsifiable from the rules emulator.

**The condition is `status != 'published' && current_version == null`, not
`current_version == null` alone**, and that matters: every document published
before this phase has `current_version` unset (`scripts/seed-emulator.ts:2489-2505`
writes `status: 'published', isPublic: true` and no version, and every real
Studio/trial team's documents have the same shape). Keying only on
`current_version` would leave W-B1 unfixed for exactly the documents that already
carry acceptances, until somebody happened to republish. The `status` clause makes
the narrowing independent of whether the version backfill (§2.1) has run.

---

**W-B2 — `signup_documents` fails open to empty, silently.**
`syncTeamPublicProfile.ts:106-131` reads each referenced document's
`public_profile` summary and **skips any id whose summary is missing** (the
comment at `:109-110` says so), then writes the whole array at `:227` with the
comment *"Recomputed every run (may be empty) so stale consent links never
linger."* Fail-open-to-empty is correct for a display list of consent links. It
is catastrophic for an authorization gate: "silently skipped" becomes "the
required waiver vanished and the booking went through".

**Fix (P4-E), by separation rather than by patching.** The gate never reads a
denormalised mirror. Authorization reads a **server-written policy document**
that fails **closed**; the public mirror stays a display list that fails open.
§1.5 states the split and W6 pins it.

---

**W-B3 — the existing consent record is decorative, and the code says so.**
`completeSignup.ts:165-167` labels `acceptedDocuments` *"Legal record only;
strings are clamped and never used for authorization"*, clamps them at `:168-177`
and writes `consent = { privacyAcceptedAt, documents }` onto the contact at
`:211`. Meanwhile the only client that supplies them sends
`version: ''` for every document (`SignupForm.tsx:235`). And `consent` is
declared on **no type** — `packages/shared/src/types/contact.ts` has no such
field — read by no code, and rendered on no screen.

**Fix (P4-Q).** `completeSignup` writes real ledger rows against real versions;
`Contact.consent` keeps being written for one release, is marked deprecated on
the line, and its retirement is a follow-up. Leaving both in place *claiming the
same thing* is the outcome to avoid: two proofs of acceptance with different
evidential weight and no marker saying which is which.

---

**W-B4 — a comment describes a versioning mechanism that does not exist.**
`packages/shared/src/types/document.ts:62` says `updated_at: Timestamp // used as
the consent "version" stamp`. Nothing reads it that way. This is the Phase-2
failure shape (comments asserting preconditions the code did not establish), and
it is load-bearing here because it is the exact spot a reader would look for
"where is the version?".

**Fix (P4-B).** The comment is replaced by a real `version` field on the mirror,
and the line records that the version is minted by `publishDocumentVersion` and
is the id of an immutable snapshot.

---

**W-B5 — Free and Coach teams cannot install Documents today, despite
`minPlan: 'free'`.** `apps/web/src/plugins/documents/manifest.ts` declares
`minPlan: 'free'` with no `addon`, and `pluginAccessForPlan`
(`packages/shared/src/types/plan.ts`) therefore routes those plans to the
client-side install mutation — which `firestore.rules:501` and `:504` **deny**,
because `installed_plugins` create/update/delete require the team's plan to be in
`['studio','organization']`. There is no other install path (`activatePluginAddon`
refuses ids absent from `PLUGIN_ADDONS`). So the button fails with a permission
error.

**Consequence for §6, stated because "existing-data effect: none" was already
found false once** (`docs/fareharbor-analysis.md:585-590`): **de-gating Documents
is a genuine availability widening, not a no-op.** It grants Documents to Free
and Coach teams for the first time, and it is the reason W-B7 below becomes
newly reachable.

---

**W-B6 — document images are world-readable regardless of status.**
`storage.rules:79-81` grants `allow read: if true` on
`teams/{teamId}/documents/{allPaths=**}`, independent of the document's `status`
or `isPublic`. An image embedded in a **draft** waiver is already public.
**Named, not fixed.** Closing it requires either a Firestore lookup from storage
rules or a liveness-encoded path, both of which are larger than this phase and
neither of which is on a line Phase 4 rewrites. Recorded so nobody assumes the
version snapshot's immutability extends to its images: it does not, and §5.2 says
so to the studio.

---

**W-B7 — the 20-document cap is client-only, and de-gating makes it newly
reachable.** `apps/web/src/plugins/documents/limits.ts` holds
`maxDocumentsPerTeam: 20` and the create page checks it client-side; there is no
callable and no rule behind it (`hooks.ts` writes documents directly from the
browser). **Waivers are safe** — waiver creation is a callable and is capped
server-side (§1.7) — but ordinary documents stay client-written and uncapped, on
plans that could not previously reach the feature at all (W-B5). **Named, not
fixed**, with §10 Q7 asking whether ordinary document creation should move behind
a callable too.

---

**W-B8 — `MAX_BODY_CHARS` is duplicated and can drift.**
`syncDocumentPublicProfile.ts:14` and `apps/web/src/plugins/documents/limits.ts`
each hold `50000`. A version snapshot is frozen at the sync's clamp, so a drift
would freeze a truncation the editor never showed.

**Fix (P4-B).** One constant in `@linyup/shared`, both sites delegate.

---

**W-B9 — `RESERVED_SLUGS` is missing four live route segments.**
`packages/shared/src/slugs.ts:9-26` lists the surfaces and the token routes but
not `documents`, `waitlist`, `forms` or `kiosk` — all of which are live literal
segments under `/public/{slug}/` (`publicRoutes.ts:91-113` is the census owner
for the full route list). A team could take one of those slugs today and shadow
the literal route.

**Fix (P4-A)**, together with the new `waiver` segment this phase adds. `waitlist`
is a Phase-2 miss; fixing it on the way through costs one line.

---

**W-B10 — `downgradeTeamToFree`'s synchronous teardown omits `documents` while
the async trigger performs it.** `packages/functions/src/saas-billing/index.ts`
flips every active install to `'inactive'` and synchronously tears down `website`
and `online-courses`; documents rely on `onInstalledPluginStatusChange.ts:63-65` →
`deleteAllDocumentPublicProfiles` (`utils/plugins.ts:85-104`). **Resolved as a
side effect of §6**: the teardown arm is deleted, `deleteAllDocumentPublicProfiles`
becomes dead code and is removed, and the asymmetry disappears rather than being
patched.

---

**W-B11 — the Brevo webhook records delivery on the ledger and fans out to
nothing, and `soft_bounce` reads as a hard failure.**
`handleBrevoWebhook.ts:53-67` finds the `mail_sends` row by querying
`provider_message_id` and writes `{ status }` onto it; it touches no domain
object. `mail_sends` is Admin-SDK-only (`firestore.rules:294-302` denies all
client access, with the PII reason on the line), so a studio's browser cannot
read delivery state at all. Separately, `LEDGER_STATUS` maps `soft_bounce` to
`'bounced'` (`:28`) while `SUPPRESSION_EVENTS` (`:13-21`) correctly does **not**
suppress it — so a full mailbox reads as "no valid notice" while the address is
alive.

**Fix (P4-F).** A narrow fan-out (the matched ledger row already carries the
linkage, so it is one extra write on an event we already handle) plus a distinct
`deferred` notice state for soft bounces. Both are strictly required by
Decision 5 — "recording merely *sent* is not good enough" is unsatisfiable
without them.

---

**W-B12 — `slugify` mints its uniqueness suffix from `Math.random()`**
(`apps/web/src/plugins/documents/hooks.ts:14-24`) and nothing checks the result
for collision. **Named, not fixed** — a colliding slug makes two documents share
a public URL, which matters more once a waiver is linked from a booking form, but
the fix belongs with the document-creation-callable question (§10 Q7).

---

**W-B13 — `unsubscribed` suppresses an address but never reaches the ledger.**
`handleBrevoWebhook.ts:13-21` lists `unsubscribed` in `SUPPRESSION_EVENTS`, so
`addSuppression` runs and the address is dead for all future studio mail. But
`LEDGER_STATUS` (`:24-33`) has no `unsubscribed` entry, so `classifyBrevoEvent`
returns no `ledgerStatus` and `updateLedgerStatus` never fires. The `mail_sends`
row for that message sits at `sent` forever while the recipient is provably
unreachable. Also absent: `deferred`/`soft_bounce` has an entry but it is
`'bounced'` (W-B11's second half).

**Fix (P4-H).** §2.3's fan-out carries **its own** event map, independent of
`LEDGER_STATUS`, covering `unsubscribed` and `soft_bounce` → `deferred`. Changing
`LEDGER_STATUS` itself would move a value other readers depend on, so it is left
alone (the same reasoning W-B11 already applies to `soft_bounce`).

---

**W-B14 — `teams/{teamId}/settings/*` has no security rule at all.**
`grep -n "match /settings" firestore.rules` returns nothing, and the
`match /teams/{teamId}` block (`:357`) enumerates its subcollections one by one
(`public_profile`, `team_members`, `role_config`, `activity_log`,
`team_weekly_reports`, `team_places`, `sessions_tags`, `team_invitations`,
`contact_requests`, `team_alerts`, `alert_presets`, `integrations`,
`installed_plugins`, `subscription_types`, `affiliation_types`) with **no
catch-all**. Firestore denies any path no rule matches. This is dormant today
because nothing writes there.

**Fix (P4-C), and it is a hard prerequisite for §6.3's config move**, which puts
the signup-consent selection at `teams/{teamId}/settings/documents`. Without the
rule the studio's save fails outright with a permission error — a **louder**
version of the exact silent-no-op-save window P4-C's atomicity exists to prevent.

---

**W-B15 — `TEST_MODE` redirects every recipient to one inbox and bypasses the
policy layer.** `mailService.ts:147-155`: when `isTestMode()`, `recipients` is
replaced wholesale by `testEmail.value()` and the synthetic / policy /
suppression layers below are skipped entirely. Harmless for a booking
confirmation. **Not harmless for a guardian link**, whose entire evidential claim
is that the message reached *that* mailbox: in a `TEST_MODE` environment the link
lands in a shared test inbox and anyone with access can tick it, producing a
record asserting mailbox control that never happened. The seeded lead tenants
(`scripts/leads/`) are exactly where a prospect would be shown this feature.

**Fix (P4-J), by honesty rather than by refusal.** Minting still works — refusing
would break local development of the one flow that most needs it — but when
`isTestMode()` is true the request and its acceptance are stamped
`test_mode: true` and `signer_email_verified_by: 'none'`, never `'emailed_link'`.
The record then says what actually happened. §5.2 states it.

### 0.4 Where a survey or a settled source is mistaken

**(a) `contact-update` is not a token link, so the guardian link has two in-house
precedents, not three.** The task brief and `docs/fareharbor-analysis.md` §7.6
both group `manage-booking`, waitlist-claim and `contact-update` together.
`requestContactUpdate` (`packages/functions/src/contacts/requestContactUpdate.ts`)
authenticates by a **contact session** or a **short-lived hashed OTP**; the
`contactId` in the URL is not a credential and is cross-checked. The two real
precedents differ in shape and the guardian link wants the first:

| | bearer token on a domain doc | hashed OTP |
|---|---|---|
| Where | `booking_token`, `entry_token`, `offer_token` | `booking_verification_codes` |
| Lifetime | none of its own; the domain state expires | 10 minutes |
| Revoked by | deleting the field (`claim.ts:392`) | marking used |
| Asks the holder to | click | type a code |

A guardian has no account and must not be asked to type anything. §4 takes the
bearer-token shape with the **claim's deadline discipline** — one instant,
computed once, stored on the record it guards.

**(b) §7.6's `Guardian[]` type on the contact is NARROWED, not built.** The
settled design specified a distinct `Guardian` type (required email, cap 2)
embedded on the contact, so every consent path could answer *"may this person
sign?"* from the type. Franco's Decision 3 replaces the mechanism: the signature
is bound to the address the link was **sent to**, and §7.6's own follow-on
sentence already says *"the acceptance ledger snapshots the signer rather than
referencing the guardian array"*. With the snapshot doing the work, a
freely-editable array on the contact would be a second source of truth for a
question the ledger already answers, and would invite exactly the read
Decision 3 forbids. **Phase 4 therefore builds no `Guardian` type**; the
pre-fill for a repeat guardian comes from that contact's most recent guardian
acceptance, which is already in the ledger. §10 Q1 puts the narrowing to Franco,
because it edits a settled decision.

**(c) Survey 2's "write the acceptance after the commit" reading of the
prerequisite is followed in intent and reversed in mechanism.** The stated rule
is *refuse before contact creation, write after the booking commits*
(`docs/fareharbor-analysis.md:516-517`). Post-commit on `bookSession` means the
best-effort zone where the partner ledger (`booking/index.ts:1256-1295`) and the
contact alert (`:1308-1333`) swallow their own failures. An acceptance that can
fail while the seat commits is an evidence hole in a compliance feature. The
commit transaction has **no contact read** and takes two extra writes for free,
so the acceptance goes **inside** it — which satisfies the rule's intent
(nothing recorded for a booking that never happened) more strictly than a
post-commit write does. §3.3 states it; §10 Q2 asks Franco to confirm the
deviation.

**(d) Decision 6's "and nowhere else in the product" is NOT already true — the
signup rail collects a birthdate today.** An earlier draft asserted that no path
in the product asks for a date of birth, and named `AccountHome` as the one file
that must not grow a second prompt. That is right for the **booking** rails and
wrong for **signup**: `SignupForm.tsx` declares `birthdate: z.string().optional()`
(`:41`), registers the input (`:452`), sends it (`:229`), and
`completeSignup.ts` writes it to the contact (`:161`, `:207`). So a parent
signing a 14-year-old up through `/public/{slug}/signup` would fill the optional
birthdate on the details step and then be asked again by the waiver step on the
very next screen — two DOB questions in one flow, which is the exact friction
Decision 6 exists to prevent. §4.5 states the reconciliation and P4-Q owns it.
The other three pre-existing birthdate controls (`contacts/[id]/page.tsx`,
`ContactUpdateForm.tsx`, `AccountHome.tsx`) are **optional profile fields, not
compliance asks**, and are deliberately untouched — recorded here so a reader who
greps `birthdate` does not think Decision 6 was violated four times.

**(e) `offerWasDelivered` cannot make the split §2.3 asks of it, and one of the
things it hides is not evidence about the recipient at all.** It is
`!outcome.skipped || !!outcome.providerMessageId`
(`booking/waitlist/constants.ts:74-92`) and returns false identically for a
messaging-policy drop, a synthetic recipient, a suppressed address **and
`MAIL_ENABLED=false`**. The last of those is an environment kill switch: it
short-circuits at `mailService.ts:127-130` before any Firestore work, writes no
ledger row, and says nothing whatsoever about whether the member's address is
good. Reporting it under "these people were not told" would attribute an
operator's config to a member. So the notify worker reads `isMailEnabled()`
itself, once per pass, and records **`not_sent_env`** — a fourth non-delivery
state that §2.4 keeps out of the accusatory bucket.

### 0.5 Review findings this pass did NOT adopt, and why

Recorded rather than silently dropped, because each was argued well and the next
reader will reach the same conclusion unless the counter-evidence is written
down.

**(a) "The gate cannot read a signer row at its stated placement, because the
guest contact is not resolved until `~:940-980`." — REJECTED on the code.**
`bookSession` resolves the guest's exact email+name match at
`booking/index.ts:815-831` and assigns `callerContactId` at `:832` — **above** the
capacity check, the cutoff, the trial door and the access gate. Its own comment
(`:806-814`) states why, and ends *"the guest branch would run this same exact
email+name match anyway"*; `:958` is literally `const exactMatch = guestMatch`.
So at the gate's placement a returning guest **is** identified, `1 + N` gets is
the true cost, and W9 holds. **Re-verified line by line at implementation time
rather than carried forward**: the guest email+name match really is at
`booking/index.ts:815-831`, `callerContactId` really is assigned at `:832`,
`resolveBookingAccessGate` really is at `:913-921` and contact resolution really
does begin at `:923`. The gate went in between the last two, and
`waivers/gate.test.ts` now pins the ORDERING against the source so the next
edit to this callable cannot quietly move the gate below a contact write. The finding was nevertheless useful: the spec never
said the gate reads `callerContactId`, and that silence is what made the reading
possible. §3.2 now says it, and §1.5's cost line names the read the rail already
performs. **The companion finding about `resolveWaiverRequirement` resolving by
email while the gate resolves by email+name is a real divergence and IS adopted**
(§3.1).

**(b) "Key the signer row on `identity_key`, as `PromoRedemption` does." —
REJECTED, with the promo type's own docblock as the evidence.**
`redemptions/{identityKey}` really is the promo precedent
(`packages/shared/src/types/promoCode.ts:257-259`), and it really would make a
purged-and-recreated contact keep its signature. It is the wrong key here for a
reason the promo docblock states in its own words: `promoIdentityKey` is
`sha256(normalised email)` and *"it is not unforgeable"*
(`promoCode.ts:670-674`). A shared family mailbox therefore gives a mother and
her child the **same** identity key. Over-inclusion is harmless for a redemption
cap and is catastrophic for a waiver: it would merge a minor's signer row with
their parent's, in the exact configuration the guardian half of this phase exists
to serve. **`signers/{contactId}` stands.** The accepted consequence — a contact
recreated under a new id re-signs, while the ledger keeps both histories — is
stated in §3.3 and printed by the export (§5.3).

> **Rejecting `identity_key` as the KEY is not rejecting it as a QUERY**, and a
> second review read it that way. The gate is `contactId`-only **by design**: a
> recreated contact re-signs, and that is the safe direction. The export is the
> opposite operation — a deliberate, rare, human-read artefact where missing a
> real signature is the failure — so it queries `identity_key` **as well**, and
> §5.3 now makes that query **mandatory** and renders it as a separate,
> explicitly-labelled section rather than merging it into the member's own
> history. An email address is not a person; the export says so in its header.

**(c) "`rebookSession` must be gated." — REJECTED, gate REMOVED.** §3.2 marked it
"only if the floor moved". Its two callers are the studio's own bookings list
(`apps/web/src/app/[locale]/(auth)/bookings/page.tsx:386`) and the public token
link (`…/manage-booking/page.tsx:148`); neither has a waiver step, so the refusal
would be a dead end on one and would break a coach's daily workflow on the other
— while that same coach can add the same member to the same session directly
(§3.8), which this design deliberately does not block. A rebook **moves an
existing seat**; it creates no new attendance relationship, and §3.6 already
rules that a publish never retroactively invalidates a committed booking. The
gate was stricter on the reversible operation than on the irreversible one.
`rebookSession` now takes no waiver.

**(d) "Refuse to mint a guardian request while `TEST_MODE` is on." — REJECTED in
favour of honesty.** The hazard is real and W-B15 pins it: `mailService.ts:147-155`
replaces every recipient with `testEmail.value()` and bypasses the policy layer,
so in such an environment the guardian link lands in a shared inbox and the
`emailed_link` claim would be false. But refusing to mint would break local
development of the single flow that most needs to be developed locally, and the
seeded lead tenants would lose the demo. **The record is stamped instead**:
`test_mode: true` on both the request and the acceptance, and
`signer_email_verified_by: 'none'` rather than `'emailed_link'`. A record that
says what actually happened is worth more than an environment that cannot
exercise the path. P4-J owns it; §5.2 states it.

**(e) Two critiques proposed opposite fixes for a guardian request on the
waitlist-claim rail; NEITHER is adopted verbatim.** The clash is worth stating
because the reasoning decides §3.4.

- *"Clamp `expires_at` to `min(now + 72h, claim_expires_at)` and tell the
  claimant the parent has until HH:MM."* Rejected: it is a correct application of
  the single-deadline discipline to the wrong problem. `WAITLIST_DEFAULT_CLAIM_MINUTES`
  is 120 and the floor `WAITLIST_MIN_WINDOW_MINUTES` is 35
  (`booking/waitlist/constants.ts:31-52`). Clamping a guardian link to 35 minutes
  does not make the parent answer in 35 minutes; it converts a silent failure into
  a **prompt** silent failure. The entry still gets one offer ever, and it is
  still spent on a document nobody could complete.
- *"Refuse to apply guardian-required waivers to the claim rail at all."*
  Rejected: it makes the gate's coverage depend on which rail a member happened to
  arrive on, which is exactly the incompleteness §8.1 shape 5 is about.

**Adopted instead: the claim completes, and the guardian link is emailed
afterwards.** §3.4 states it. A guardian-required waiver on the claim rail is
**presented, not gated**: the claimant ticks nothing they cannot tick, the seat
commits, the booking carries `waiver_state: 'outstanding'`, the roster chip shows
it, and the guardian link is minted after the commit with its ordinary 72 hours
and no seat behind it. That is §3.8's posture (surface, do not block) applied to
the one rail where blocking destroys something scarce, and it follows directly
from §0's governing rule: **a signature is not a scarce resource, so it must
never consume one.** The cost — one booking that exists with an outstanding
waiver — is visible on every roster and is named in §11.

**(f) The `guardian_email_is_subject` HARD REFUSAL is withdrawn, and replaced by a
recorded weakness.** The first draft called it *"the one refusal that makes the
record mean something"*. It over-blocks the commonest legitimate booking and
under-blocks the abuse it targets, and both halves are checkable:

- **Over-blocks.** `bookSession` requires `contactDetails.email` and creates the
  guest contact with exactly that address (`booking/index.ts:487`, `:1007-1024`);
  `createDropInCheckout` is identical (`dropIn.ts:258-266`, `:410-425`). **A
  9-year-old has no mailbox**, so the address a parent types for the child *is*
  the parent's. On an `always` waiver the mother is refused the only address that
  exists, on every retry, and §4.3 offered no escape branch. The booking becomes
  unreachable for exactly the studio type the guardian feature exists for.
- **Under-blocks.** `normalizeEmail` is `trim().toLowerCase()` only
  (`packages/shared/src/utils/normalizeEmail.ts:5-7`), so a 15-year-old at
  `luca@gmail.com` naming `luca+mum@gmail.com` passes untouched and receives a
  record stamped `signer_role: 'guardian'`, `signer_email_verified_by:
  'emailed_link'`.

A string comparison that fails in both directions is not an integrity check. So
the equality is **recorded, not refused**:
`WaiverAcceptanceEvent.guardian_address_same_as_subject` (§1.4), printed by the
export beside `signer_email_verified_by` and shown on the signers tab. §5.2 states
that the flag is a **floor** on the weakness and never a proof of distinctness,
because the comparison cannot see aliases. W12 is restated accordingly and §4.4
now carries the reasoning rather than the refusal.

**(g) The `notify` fan-out gets a real driver; W13 is narrowed to say what it
actually meant.** Two reviews independently found that §2.3's *"bounded chunks
with a scan limit in the shape of `WAITLIST_SWEEP_SCAN_LIMIT`"* had **nothing to
invoke chunk two**: `publishDocumentVersion` is an `onCall` (60s by default — this
repo sets no global `timeoutSeconds`, `packages/functions/src/index.ts:9-10`, and
every long job opts in explicitly), W13 forbade adding a scheduled entry, and no
work item created a worker. A 412-signer publish — the number §7.2's own mock
prints — would send perhaps a third of its notices and die, with no resume and no
re-publish that would not mint a new version.

`WAITLIST_SWEEP_SCAN_LIMIT` was also the wrong template on its own terms: its
docblock (`booking/waitlist/constants.ts:68-72`) describes a ceiling that leaves
the remainder **for the next hourly pass**, and a publish has no next pass.

**Adopted: a job document plus an `onDocumentCreated` worker at
`timeoutSeconds: 540`**, the shape `processScoresRebuildJob`
(`gamification/processScoresRebuildJob.ts:37-42`) already establishes in this
repo. The worker drains `WAIVER_NOTICE_CHUNK` signers and **re-enqueues while work
remains** (a cursor, not a ceiling). **W13 is narrowed from "no job" to "no expiry
or supersession sweep"** — lazy derivation is the invariant that matters, and it is
untouched by a send worker. A partial notify is a compliance answer that is
*wrong*, not merely late.

**(h) The version backfill is mandatory, not optional, and it was missing.** Two
reviews found the same hole from opposite ends. Every document that is already
`status: 'published'` has **no version snapshot** — `scripts/seed-emulator.ts`
writes `status: 'published', isPublic: true` and no version for three documents
per team, and every real Studio/trial team's documents have that shape. Three
breakages fall out of the one gap, and none of them was owned:

1. §2.1 moves the sanitize into `publishDocumentVersion` and makes
   `syncDocumentPublicProfile` read the **frozen** `bodyHtml` from
   `versions/{v}` instead of re-sanitizing `body`
   (`syncDocumentPublicProfile.ts:57-60` is the seam today). For an unversioned
   document that read returns nothing — so the first write to a legacy terms
   document blanks its public page and dead-ends the signup consent link.
2. P4-Q writes *"real ledger rows against real versions"* — against `undefined`
   for every unmigrated document, which is W-B3's decorative `version: ''` in a
   new spelling.
3. W-B1's delete narrowing keyed on `current_version == null` alone would protect
   nothing that already carries acceptances. **That half is already fixed** (the
   rule keys on `status != 'published' && current_version == null`, §1.6), and it
   is deliberately independent of the backfill so the two cannot fail together.

**Adopted: `scripts/backfill-document-versions.ts`, inside ⚛ ATOMIC GROUP A and
ordered before the mirror-source flip** (§2.1, P4-D). It is a **deploy
precondition**, not an opt-in — unlike the *mirror* backfill of §6.3, which is
opt-in because it publishes content a studio may believe retired. Minting v1 from
text that is already published changes nothing a visitor sees.


---

## 1. The model

### 1.1 The shape of the problem, and why the previous design deadlocked

`docs/fareharbor-analysis.md:621-622` records the defect: *"re-signing is
structurally impossible as specified (deterministic doc id + `.create()`
deadlocks both expiry and revocation)"*. The mechanics, stated so the fix is
obviously a fix and not a preference:

The previous shape was one document per acceptance at a deterministic id derived
from the **relationship** — `(contact, documentId, version)` — written with
`.create()` so it could never be rewritten. That gives immutability, and it
takes three things away:

1. **Re-signing is unrepresentable.** A person who revoked and later re-accepts
   the same version produces the same id. `.create()` refuses; a `.set()` would
   rewrite the original timestamp, IP and text hash — destroying the evidence the
   `.create()` existed to protect. There is no third option at that id.
2. **Expiry has nowhere to live.** An acceptance that lapses (an annual re-sign
   policy) and is renewed produces the same id again. The renewal is the same
   collision.
3. **Revocation has nowhere to live.** Revoking means the row's *meaning*
   changed while its *facts* did not. A write-once row cannot express a change of
   meaning, and the only escape — a parallel "revocations" collection — makes the
   validity question have two sources, which is the Phase-2 shape-1 defect
   (a predicate reasoned about one shape at a time).

**The resolution is the finance journal's, applied to consent.**
`packages/shared/src/types/finance.ts:33-40` states it for money: financial
fields are never mutated, *"errors are fixed by new rows, never edits"*, and the
only permitted mutation is an enumerated status flip beside a compensating row.
Split the ledger the same way:

- **Append-only EVENT rows** hold the immutable facts (what text, what version,
  what hash, what instant, what IP, who signed and in what role). They are
  `.create()`d and never updated. The id is derived from the **event**, not from
  the relationship — which is what makes a second, genuine signing a second row
  rather than a collision.
- **One mutable CURRENT-STATE row per (document, contact)** holds the answer the
  gate asks. Absolute writes, exactly one writer. Re-signing bumps a round
  counter; revocation flips a status; expiry and supersession are **not stored at
  all** — they are derived by one pure predicate (§1.4).

This is not a new idiom in this tree. `PromoRedemption`
(`packages/shared/src/types/promoCode.ts:263-277`) is precisely a mutable
current-state row whose immutable facts live elsewhere, keyed deterministically
and written absolutely by one writer. The waitlist entry
(`sessions/{id}/waitlist/{contactId}`) is precisely a same-id-new-round record
written with a full `.set()` — `booking/waitlist/join.ts` states in a comment
that re-joining starts a genuinely fresh round with *no trace of the previous
round's offer fields*, "which is the whole reason there is no re-queue
machinery". A waiver re-signing is that same move.

### 1.2 Where everything lives

```
documents/{documentId}                                  ← StudioDocument, kind gains 'waiver'
documents/{documentId}/public_profile/{documentId}      ← existing world-readable mirror, gains version fields
documents/{documentId}/versions/{versionId}             ← IMMUTABLE published snapshot. versionId = 'v0001'…
documents/{documentId}/acceptances/{acceptanceId}       ← APPEND-ONLY event rows
documents/{documentId}/notices/{noticeId}               ← APPEND-ONLY notice rows, one per send attempt (§2.3)
documents/{documentId}/signers/{contactId}              ← the ONE mutable current-state row
documents/{documentId}/notify_jobs/{jobId}              ← the notify fan-out's driver (§2.3)
teams/{teamId}/waiver_policy/current                    ← server-written; THE authorization source (§1.5)
```

**`notices` is a second append-only collection, not a field, and that is the
single largest change this design pass made.** The first draft stored the
delivery record as one optional block on the signer row scoped to *"the LATEST
notify publish"*. Decision 5 makes the deliverability record the whole point of
the `notify` outcome — and a field that the next publish overwrites is not a
record. Worse, `mail_sends` cannot reconstruct it: `MailSendRecord`
(`types/mail.ts:26-39`) **has no recipient field**, so once the block is gone the
answer to *"who was told about version 4"* exists nowhere. A `notify` publish in
March would have erased January's evidence, and `getWaiverNoticeReport({
documentId, version })` — which takes a version parameter — would have had
nothing to read for any version but the current one. Notices now follow exactly
the discipline §1.4 applies to acceptances: `.create()`d, never updated except by
the delivery-event fan-out flipping one enumerated field, and a **resend is a
second row rather than a mutation**.

Everything hangs off the document, and that is deliberate:

- **The evidence must survive the contact.** `purgeProvisionalContacts`
  hard-deletes provisional contacts nightly across all tenants, and a per-team
  teardown uses `db.recursiveDelete`. A contact-scoped acceptance subcollection
  would be destroyed by both. Document-scoped rows are not.

  > **Which contacts the purge actually reaches, because the first draft got this
  > wrong and it is the stated justification for `identity_key`.** The job queries
  > `where('provisional_expires_at','<',now)`
  > (`dailyTasks/purgeProvisionalContacts.ts:20-23`) and re-checks
  > `provisional === true` at delete time. Only **two** sites ever write that
  > deadline: `loginContactWithCode.ts:129` (shop login-first checkout) and
  > `booking/waitlist/join.ts:220` (a queue join). **Booking-born contacts are
  > NOT purgeable**: `dropIn.ts:411-425` sets `provisional: true` and *no*
  > `provisional_expires_at`, and `bookSession`'s create (`booking/index.ts:1007`)
  > sets neither — its own comment reads *"no expiry — the 'lib_trial_cleanup'
  > automation archives stale ones"*, and archiving is not deletion. So the
  > drop-in abandon-then-return story an earlier draft told in §3.3 cannot happen;
  > the real purgeable populations are a queue-joiner and a shop registrant. The
  > conclusion is unchanged — those two can carry acceptances — but the reason
  > must be true, because §0.5(b) rests on it.
- **The studio-facing report is per-document.** Decision 5 makes "which of my
  members have no valid notice" load-bearing; that is a list under one document
  and one version, served without a collection-group query.
- **The per-contact export is the rarer, deliberate operation** and can afford one
  collection-group query (§5.3), indexed once.

`packages/shared/src/paths.ts`, beside `COURSE_PURCHASES_SUBCOLLECTION` (`:140`)
and the promo constants (`:206-212`):

```ts
export const DOCUMENT_VERSIONS_SUBCOLLECTION = 'versions'
export const DOCUMENT_ACCEPTANCES_SUBCOLLECTION = 'acceptances'
export const DOCUMENT_NOTICES_SUBCOLLECTION = 'notices'
export const DOCUMENT_SIGNERS_SUBCOLLECTION = 'signers'
export const WAIVER_NOTIFY_JOBS_SUBCOLLECTION = 'notify_jobs'
export const WAIVER_POLICY_SUBCOLLECTION = 'waiver_policy'
export const WAIVER_POLICY_DOC_ID = 'current'
```

All are nested under `documents/` or `teams/`, so **no `tenantData.ts`
registration is required** — the completeness test classifies top-level
`*_COLLECTION` constants only (`packages/shared/src/tenantData.ts:6-9`), and
`documents` is already registered there with a `teamId` field match. Same finding
as `docs/wave3-phase2-spec.md` §0.2 and `docs/wave3-phase3-spec.md` §1.1; do not
add a constant.

> **One consequence to accept knowingly.** `TENANT_DATA_COLLECTIONS` sweeps
> `documents` by `teamId`, and per-team teardown uses `recursiveDelete`, so
> `pnpm sandbox:reset` and `lead --reset` destroy acceptance evidence along with
> the documents. That is correct for a sandbox and would be wrong in production;
> production teardown is a separate, deliberate operation and this phase does not
> change it. Named so the next reader does not discover it during a demo reset.
>
> **But "production teardown is a separate operation" is not an answer, and this
> pass upgrades it to a question.** A liability waiver is the one artefact a
> studio needs *after* the relationship ends, and the window over which it is
> needed is measured in years, not in account lifetime. Deleting a team today
> deletes every signature it ever collected, with no export step anywhere in the
> teardown path. That is a retention decision, it is much cheaper to make while
> the only data is seed data, and it is **§10 Q13**.

### 1.3 The document, the version, the mirror

`packages/shared/src/types/document.ts` — minimal edits, because waivers extend
Documents rather than forking it:

```ts
export type DocumentKind = 'terms' | 'privacy' | 'regulation' | 'waiver' | 'other'

export interface StudioDocument {
  // … unchanged …
  /** Highest published version, or null when never published. A document with a
   *  published version can never be DELETED (firestore.rules) — the text may be
   *  someone's evidence. Written only by publishDocumentVersion. */
  current_version?: number | null
  /** The floor a signature must meet to still count. Moved ONLY by a
   *  'require_resign' publish; a 'silent' or 'notify' publish leaves it alone.
   *  This one number is what makes supersession a LAZY DERIVATION instead of a
   *  bulk write over every signer (§2.2). */
  min_valid_version?: number | null
  /** kind === 'waiver' only. Absent on every other kind, and the waiver gate
   *  reads it from the policy doc, never from here (§1.5). */
  waiver?: WaiverConfig | null
}
```

`packages/shared/src/types/waiver.ts` — new file holding the waiver vocabulary
**and its pure predicates**, exactly as `promoCode.ts` holds both. No crypto, no
Firestore, browser-safe (it ships through the shared barrel).

```ts
/** Who must tick. Default 'if_minor'. An adults-only studio picks 'never' and
 *  pays ZERO age questions; a kids' club picks 'always' and skips the age
 *  question entirely, because the answer would not change anything. */
// WITHDRAWN 2026-08-16 (§4). Replaced by `mayIncludeMinors?: boolean`.
export type GuardianRequirement = 'never' | 'if_minor' | 'always'

/** Where a waiver is required. One axis, on the WAIVER — not a flag on the
 *  Activity — so "which waivers does this booking need" is one filter over one
 *  list, and a studio manages waivers in one place. */
export type WaiverApplies =
  | { appliesTo: 'all_bookings' }
  | { appliesTo: 'activities'; activityIds: string[] }

export interface WaiverConfig {
  guardianRequired: GuardianRequirement
  /** Absent/null = a signature never lapses. Set, and the acceptance expires
   *  this many months after it was given. Expiry is LAZY — computed by the one
   *  predicate below, never swept (W13). */
  validityMonths?: number | null
  scope: WaiverApplies
  /** Off by default. A waiver can be authored, published and previewed without
   *  blocking a single booking; flipping this on is the moment it becomes a
   *  gate. This is what lets the whole feature ship dark (§9.1). */
  required: boolean
}

/** ONE published snapshot. documents/{d}/versions/{versionId}.
 *  versionId = 'v' + version.toString().padStart(4,'0') so a plain
 *  orderBy(documentId()) lists them in order with no index.
 *  IMMUTABLE: written once by publishDocumentVersion, `allow write: if false`,
 *  and never updated — not even to correct a typo. A typo is a new version. */
export interface DocumentVersion {
  teamId: string
  documentId: string
  version: number
  kind: DocumentKind
  title: string                    // snapshot
  /** The exact SANITIZED HTML that was, and forever will be, version N.
   *  Frozen at the same seam syncDocumentPublicProfile sanitizes at, so the
   *  text a signer read and the text stored here are the same string. */
  bodyHtml: string
  /** sha256 of bodyHtml. THE fingerprint an acceptance pins (§5.1). */
  bodyHash: string
  bodyChars: number
  /** external_link documents snapshot the URL instead; §5.2 states plainly what
   *  that is and is not worth as evidence. */
  externalUrl?: string | null
  /** The guardian rule in force AT PUBLISH. A later config change does not
   *  rewrite what a past signature was taken under. */
  guardianRequired?: GuardianRequirement | null
  publish_outcome: PublishOutcome
  supersedes: number | null
  published_at: Timestamp
  published_by: string             // uid
  published_by_name: string        // snapshot, survives a rename (GiftCard.issued_by_name's rule)
  /** Set by a 'notify' publish once the fan-out has been enqueued; the report
   *  (§2.4) reads its counters from the signer rows, never from here. */
  notice_started_at?: Timestamp | null
}

export type PublishOutcome = 'silent' | 'notify' | 'require_resign'
```

**The mirror.** `DocumentPublicProfile` gains `version: number` and
`bodyHash: string`. `updated_at`'s stale "consent version stamp" comment (W-B4)
is deleted. **Its gate is unchanged for every kind, waivers included.**

**The `isPublic` bypass the first draft proposed is withdrawn, and the `listed`
flag with it.** The draft widened the mirror for `kind === 'waiver'` to exist
whenever `status === 'published' && archived_at == null`, on the reasoning that a
required waiver must be readable by an anonymous visitor mid-booking. The
reasoning is right; the mechanism was wrong, by an order of magnitude:

- `firestore.rules:1191` grants **`allow read;`** — unauthenticated, no condition
  — on the collection group `/{path=**}/public_profile/{id}`. Verified. So the
  bypass would not make the waiver readable *to a visitor mid-booking*; it would
  make the full text of every studio's liability release **world-readable and
  enumerable by anyone**, together with `required` and `guardianRequired`, which
  between them disclose which studios gate their bookings and which run
  children's programmes. A studio that never flipped `isPublic` — deliberately
  keeping the document off `/public/{slug}/documents` — would be published anyway.
- The need is already met. `resolveWaiverRequirement` returns `bodyHtml` (§3.1)
  and `getGuardianSignatureRequest` returns the version text (§4.3 step 4). Both
  are callables the surface already has to call.
- `listed` existed only to keep the widened mirror off the index page. With no
  widening there is nothing to hide, which also disposes of three problems the
  flag created: every mirror written before this phase would have lacked the
  field (a `where('listed','==',true)` never matches a missing field, and a
  client-side `.filter` reads `undefined` as false), a server-side filter would
  have needed a **second** `public_profile` collection-group index against §12's
  "exactly one index added", and the draft's consumer list named a "bio-link
  picker" and "website header links" that do not read document mirrors at all
  (`grep -rn "type.*==.*'document'" apps/web/src packages/functions/src` finds
  `public/[slug]/documents/page.tsx:27-33`,
  `documents/[documentSlug]/page.tsx:29-36` and `syncTeamPublicProfile.ts:106-131`
  — and the third reads by id and would not have filtered at all).

**What replaces it.** `TeamPublicProfile.required_waivers` (§1.5) carries the
**summary only** — id, slug, title, version, `guardianRequired` — never the body.
That is enough for the surface to know a step is coming and render its heading on
first paint; the text arrives with the callable the step calls anyway. §5.2 says
plainly that the summary list is world-readable, because
`TeamPublicProfile` is served by the same unauthenticated collection-group rule.

### 1.4 The acceptance ledger

```ts
/** APPEND-ONLY. documents/{d}/acceptances/{acceptanceId}. Never updated, never
 *  deleted — 'allow write: if false' and no callable writes a second time to
 *  the same id.
 *
 *  IDEMPOTENCY, and the trap: recordFinanceTransaction's idiom
 *  (functions/src/finance/journal.ts:52-59) — `.create()`, catch gRPC 6,
 *  return false — works ONLY because that helper is a standalone write outside
 *  any transaction, so the error is catchable at the call site. Inside
 *  bookSession's commit transaction a `tx.create()` collision does not throw at
 *  the call: it fails the WHOLE commit as a precondition violation, is not
 *  catch-and-continue-able, and takes the seat with it. So every rail instead
 *  `tx.get`s the acceptance ref in the transaction's READ phase and SKIPS the
 *  create when it exists — one single-document read on a doc only this contact
 *  writes, in a transaction that is already reading the signer row. Do not
 *  repeat the journal citation here; an implementer following it will write the
 *  uncatchable version (§3.3). */
export interface WaiverAcceptanceEvent {
  teamId: string
  documentId: string
  /** The version the signer ACTUALLY READ — not necessarily the current one
   *  (§3.6). Validity is decided against the document's floor, later. */
  version: number
  /** sha256 of the exact bodyHtml. Pins the text independently of the version
   *  doc; a mismatch at export time is reported, not hidden (§5.3). */
  body_hash: string
  kind: 'accepted' | 'revoked'

  contactId: string
  /** sha256 of the normalised email at signing time. Survives the contact doc
   *  being purged and recreated, and lets the export find a person's history
   *  when their contact id changed. Derived with the same hasher the promo
   *  identity key uses (functions/utils/crypto.ts sha256Hex) — a SHARED helper,
   *  never a second definition of "the same person". */
  identity_key: string

  /** THE distinction between a guardian and the minor, and the reason §4 exists. */
  signer_role: 'self' | 'guardian'
  signer_name: string
  /** The address that actually identifies the signer on THIS path — not, in
   *  general, the contact's own. On the OTP path it is copied from
   *  booking_verification_codes.email; on the guardian path from the request's
   *  guardian_email. §5.1 tabulates all four. */
  signer_email: string
  /** How that address was established (§5.1). 'emailed_link' and
   *  'verified_code' both mean the signer demonstrably controlled THAT mailbox;
   *  'session' means only that a contact session was open, which identifies the
   *  CONTACT and not the person at the keyboard; 'none' means the address was
   *  merely typed. */
  signer_email_verified_by: 'session' | 'verified_code' | 'emailed_link' | 'none'
  /** True when the guardian's address and the subject's are the same mailbox.
   *  NOT a refusal (§4.4) — a recorded weakness, printed by the export and
   *  shown on the signers tab. Comparison is normalizeEmail() only
   *  (shared/utils/normalizeEmail.ts:5-7 is trim+lowercase), so a plus-alias or
   *  a dot-variant reads as different mailboxes: the flag is a FLOOR on the
   *  weakness, never a proof of distinctness. §5.2 says so. */
  guardian_address_same_as_subject?: boolean
  /** signer_role: 'guardian' only. The request this signature came from, so the
   *  export can print the trail (mailed → opened → ticked) and the redemption
   *  interlock in §4.3 has something to name. */
  guardian_request_id?: string | null
  /** True when this signature was taken in an environment where TEST_MODE
   *  redirected the mail (W-B15). Such a record never claims 'emailed_link'. */
  test_mode?: boolean

  /** WHO the release is about — snapshotted, so removing anything later never
   *  rewrites history. */
  subject_name: string
  subject_email: string | null
  /** The date of birth as DECLARED at signing (§4.5). A later edit to
   *  Contact.birthdate does not touch this. */
  subject_birthdate_declared?: Timestamp | null

  /** The validity rule IN FORCE AT THE TICK, frozen for the same reason
   *  DocumentVersion freezes guardianRequired: a later config edit must not
   *  retroactively re-date what a past signature was worth. null = never
   *  lapses. `waiverAcceptanceState` reads THIS, never the live config. */
  validity_months_at_signing: number | null
  /** Derived once, here, so expiry is a comparison rather than arithmetic over
   *  a number that may since have moved. null when validity_months_at_signing
   *  is null. */
  valid_until: Timestamp | null

  method: 'click_wrap'
  accepted_at: Timestamp           // server time, never client time
  ip: string | null
  user_agent: string | null
  /** Which language the text was read in — a four-locale product cannot claim
   *  informed consent without recording which rendering was shown. */
  locale: string | null
  source: WaiverAcceptanceSource
  booking_ref?: { sessionId: string; bookingId: string } | null
  /** The nonce that makes a double-submit idempotent (§1.4.1). */
  intent_id: string
  /** kind: 'revoked' only. */
  revoked_by?: string | null       // uid, or 'contact'
  revoked_reason?: string | null
  revokes_acceptance_id?: string | null
  created_at: Timestamp
}

export type WaiverAcceptanceSource =
  | 'booking' | 'drop_in' | 'appointment' | 'appointment_checkout'
  | 'waitlist_claim' | 'signup' | 'space' | 'guardian_link' | 'kiosk' | 'admin'
```

```ts
/** THE current-state row. documents/{d}/signers/{contactId}.
 *  Mutable, with exactly ONE writer: `waivers/accept.ts`. The revoke callable
 *  does not write it either — it calls the same helper with a
 *  kind: 'revoked' event, which is what keeps `rounds` single-writer (§8.1
 *  shape 2). ALWAYS inside a transaction, and CONDITIONALLY — see the
 *  precedence rule in §1.4.1. Never by an unconditional .set().
 *  Deliberately does NOT store 'superseded': it is derived by
 *  waiverAcceptanceState() from the document's floor, so a require_resign
 *  publish is O(1) rather than O(signers) (§2.2). */
export interface WaiverSignerState {
  teamId: string
  documentId: string
  contactId: string

  accepted_version: number
  accepted_at: Timestamp
  /** Copied from the winning acceptance event. Expiry is a comparison against
   *  this instant, never arithmetic over the live config (§1.4). */
  valid_until: Timestamp | null
  /** The event row that established the current state. */
  acceptance_id: string
  /** Absolute, computed from this transaction's own read set. Never
   *  FieldValue.increment — the same rule bookings_count and usage_count carry. */
  rounds: number

  signer_role: 'self' | 'guardian'
  signer_name: string
  signer_email: string
  signer_email_verified_by: 'session' | 'verified_code' | 'emailed_link' | 'none'

  /** The ONLY stored lifecycle state. Everything else is derived. */
  status: 'active' | 'revoked'
  revoked_at?: Timestamp | null
  revoked_by?: string | null

  /** Pointer to the newest notices/{noticeId} row, for the roster and the live
   *  view ONLY. It is a cache, it is overwritten freely, and NOTHING evidential
   *  reads it: the report and the export read the notice ROWS for the version
   *  they were asked about (§2.3, §2.4). */
  latest_notice_id?: string | null

  /** Denormalised for the report and the roster; never read for a decision.
   *  The manifest's own comment states this trade-off in reverse and lands on
   *  the same side: mirror what the list needs at write time rather than
   *  joining at read time. */
  contact_name: string
  contact_email: string | null
  updated_at: Timestamp
}
```

```ts
/** APPEND-ONLY. documents/{d}/notices/{noticeId}, where
 *  noticeId === waiverNoticeKey(documentId, version, contactId, attempt) — the
 *  SAME string as the mail_sends doc id, which is what lets the report read
 *  delivery state by direct `get` with no query and no linkage (§2.4).
 *  `.create()`d by the notify worker; the ONLY subsequent write is the webhook
 *  fan-out setting `state`, `last_event` and `resolved_at`. A resend is a new
 *  row at attempt+1, never an edit. */
export interface WaiverNoticeRow {
  teamId: string
  documentId: string
  version: number
  contactId: string
  attempt: number
  /** The address it was addressed to, snapshotted — because mail_sends has no
   *  recipient field (types/mail.ts:26-39) and a contact's email may change. */
  email: string | null
  provider_message_id?: string | null
  state: WaiverNoticeDelivery
  /** The raw Brevo event that last moved `state`. Kept because soft_bounce and
   *  hard_bounce both map to 'bounced' in LEDGER_STATUS (W-B11) and they mean
   *  very different things to a studio. */
  last_event?: string | null
  suppressed_at_send: boolean      // the EXPLICIT isSuppressed() check, recorded
  created_at: Timestamp
  sent_at?: Timestamp | null
  resolved_at?: Timestamp | null
}
```

**The one predicate.** Pure, in `types/waiver.ts`, unit-tested with a matrix, and
called by the gate, the public requirement callable, the roster badge, the
manifest chip, the Space card, the report and the export. There is no second
answer to "does this person's signature count":

```ts
export type WaiverAcceptanceState =
  | 'none'         // never signed
  | 'valid'
  | 'superseded'   // signed below the document's floor (a require_resign publish moved it)
  | 'expired'      // validityMonths elapsed
  | 'revoked'

export function waiverAcceptanceState(
  waiver: { min_valid_version: number },
  signer: Pick<WaiverSignerState,'accepted_version'|'accepted_at'|'valid_until'|'status'> | null,
  nowMs: number
): WaiverAcceptanceState
```

Order of decision, fixed so the four states can never be argued about
independently: `null` → `none`; `status === 'revoked'` → `revoked`; below the
floor → `superseded`; past `valid_until` → `expired`; else `valid`. Only `valid`
satisfies the gate. Revocation outranks supersession because a revoked signature
must never be reported as merely stale.

**Note what the predicate no longer takes: `validityMonths`.** The first draft
passed the **live** `WaiverConfig.validityMonths` and computed
`accepted_at + N months` at read time. That made a single field edit
retroactively re-date the validity of every signature the studio had ever taken,
population-wide, with no version, no publish event, no notice, and nothing in the
export recording when the rule changed or from what date — the same class of
defect as a mutable version snapshot, on the exact axis this phase exists to
protect. A studio setting `validityMonths: 12` on a Monday would refuse every
member who signed 13+ months ago on Tuesday, and their export would show a valid
acceptance, a matching hash, no revocation and no `require_resign` publish with
no explanation of why it stopped counting. Reverting the number would silently
re-validate them all.

So the validity in force at the tick is **frozen onto the acceptance event and
copied to the signer row** (`validity_months_at_signing`, `valid_until`), exactly
as `DocumentVersion` freezes `guardianRequired`, and expiry is a comparison
against a stored instant. Changing `validityMonths` therefore governs **future**
signatures only. If a studio ever needs to re-date existing ones, that is a
publish outcome with its own version and its own line in §7.2's chooser — not a
field edit — and §10 Q12 now carries that constraint.

#### 1.4.1 Why re-signing, expiry and revocation all fit

| Operation | Event row | Signer row | Document |
|---|---|---|---|
| First signature | `.create()` `kind:'accepted'` | write, `rounds: 1`, `status:'active'` | — |
| Re-sign after a `require_resign` publish | `.create()` a NEW row (new `version`, new `intent_id` ⇒ new id) | write, `rounds: n+1`, `accepted_version` = the new one | — |
| Re-sign after revocation | `.create()` a NEW row (same version, **new** `intent_id` ⇒ new id) | write, `rounds: n+1`, `status:'active'`, `revoked_*` cleared | — |
| Re-sign after expiry | as above | as above | — |
| Revoke | `.create()` `kind:'revoked'`, naming the acceptance it revokes | write `status:'revoked'` + `revoked_at/by` | — |
| **A stale acceptance arriving late** | `.create()` the row — **it happened, so it is recorded** | **NOT written** — the precedence rule below refuses it | — |
| Supersede everyone | **nothing** | **nothing** | `min_valid_version = N+1` |
| Expire everyone | **nothing** | **nothing** | `validityMonths` — **future signatures only** |

The whole deadlock dissolves at the third column of row two: **the acceptance id
contains the event's nonce, not just the relationship.**

```ts
acceptanceId = 'a_' + sha256Hex([documentId, version, contactId, intentId].join(':')).slice(0, 32)
```

`intentId` is a 16-byte token minted by `resolveWaiverRequirement` (§3.1) and
echoed back with the tick. It buys exactly one property — **a double-submit of
the same tick writes one row** — and it is not a credential: forging one only
affects whether a duplicate row is created, which is self-harm. It is
deliberately **not persisted**, so there is no intent collection, no TTL and no
sweep (W13). **On the guardian path `intentId := requestId`**, so the id is
defined there too and steps 5 and 7 of §4.3 can derive the same one.

**The precedence rule — the sixth row is a real operation, not an anomaly.**
The first draft wrote the signer row with an unconditional absolute `.set()` and
stated no ordering rule at all, which meant a stale write silently destroyed a
stronger, later signature. Two ordinary sequences produce it:

- A guardian request for v4 is minted at 09:00. At 10:00 the studio publishes v5
  as `require_resign` and the member's own account re-signs v5 (`accepted_version
  5`, `rounds 3`). At 10:05 the parent clicks the 09:00 link; the redemption
  `.set()`s the row from the request's snapshot → `accepted_version 4`. The
  member is now `superseded` and blocked at their next booking by a signature
  that was valid five minutes earlier.
- A manager revokes at 10:00:00 while a drop-in acceptance that read the row at
  09:59:59 lands at 10:00:01 with `status: 'active'`, silently undoing the
  revocation. On the paid rails the first draft wrote outside any transaction, so
  Firestore's optimistic-concurrency detection would not even have flagged it.

So, stated once and implemented once in `accept.ts`:

> **The event row is ALWAYS created — it is a fact and facts are recorded.**
> **The signer row is updated only when the event strictly improves it.**
>
> For `kind: 'accepted'`, apply iff
> `accepted_at > (row.revoked_at ?? 0)` **and**
> (`version > row.accepted_version` **or**
> (`version === row.accepted_version` **and** `accepted_at > row.accepted_at`)).
>
> For `kind: 'revoked'`, always apply — it is a manager's deliberate act at the
> current instant, and a revocation that could be out-ordered is not a
> revocation.
>
> The comparison is made against a row **re-read inside the same transaction**,
> on **every** rail including the paid ones (§3.3). A signer write outside a
> transaction is a bug, not an optimisation.

An acceptance that loses this comparison is not an error and is never reported as
one: the person really did read the text and tick, the event says so, and the
current-state row simply already holds something better.

> **`accepted_at` IS THE INSTANT OF THE TICK, CAPTURED ONCE — not the instant
> the transaction commits.** Found while implementing, because the fixture for
> the second sequence above failed against a first cut that stamped
> `Timestamp.now()` inside the transaction body. Firestore RETRIES a contended
> transaction: the manager's revocation at 10:00:00 aborts the in-flight
> acceptance that read the row at 09:59:59, the acceptance re-runs, re-stamps
> itself 10:00:02, and now beats the revocation — silently undoing it, which is
> the exact defect the rule was written to prevent. The record would also be
> false, asserting that the person ticked two seconds after they were revoked.
> So `planWaiverLedgerWrite` takes `nowMs` as a required argument and every rail
> captures it before entering its transaction. There is no default inside the
> transaction to fall back to.

### 1.5 The authorization source, and the display mirror

The gate must not read anything that fails open (W-B2). So there are two lists
and they have different jobs:

```ts
/** teams/{teamId}/waiver_policy/current — SERVER-WRITTEN, client-unwritable.
 *  THE authoritative answer to "what does a booking here require". Written in
 *  the same transaction as every publish / require / retire, by
 *  publishDocumentVersion and setWaiverRequirement, and by nothing else. */
export interface TeamWaiverPolicy {
  teamId: string
  /** Capped at MAX_REQUIRED_WAIVERS_PER_TEAM so the gate's read cost is bounded
   *  and stated, rather than growing with a studio's document count. */
  required: RequiredWaiverEntry[]
  updated_at: Timestamp
}

export interface RequiredWaiverEntry {
  documentId: string
  slug: string
  title: string
  current_version: number
  min_valid_version: number
  body_hash: string
  guardianRequired: GuardianRequirement
  validityMonths: number | null
  scope: WaiverApplies
}
```

**How the policy document is written, stated because the two plausible answers
have very different costs.** A full rebuild would need a transactional query over
`documents where teamId == … and kind == 'waiver'`, which requires a composite
index that does not exist (the current `documents` index is
teamId+status+isPublic+archived_at, `firestore.index.json:142-162`) and which
§12's index budget forecloses — and, executed outside the transaction, two
managers publishing two different required waivers within the same second would
have the second write drop the first's entry, silently un-gating a required
waiver with the policy left internally consistent so §1.5's "fails closed" banner
never fires. So:

> `publishDocumentVersion` and `setWaiverRequirement` **read
> `teams/{t}/waiver_policy/current` inside the same transaction**, patch or
> remove **exactly the one entry** for the document being written, and write the
> array back. No query, no index, no lost update.

And because W5's "always agree" is an assertion until something checks it, the
Documents page runs the cheap converse on load — every `kind: 'waiver'` document
with `required: true` has a policy entry at the same `current_version` /
`min_valid_version` — and shows the disagreement banner when it does not. That
reconciliation is a read the page already performs, and it is the
`assertFinanceInvariant`-shaped move: make the impossible state loud.

**The gate's read cost is `1 + N`, plus the contact lookup the rail already
performs**: one `get` of the policy document plus one `get` per applicable
waiver's signer row, with `N` capped at `MAX_REQUIRED_WAIVERS_PER_TEAM = 3`. A
team with no waivers pays exactly one `get`, and that is the overwhelming
majority of bookings. There is no query, no index and no phantom in the
transaction that later writes the acceptance. The contactId the signer `get`
needs is **already resolved** on every rail at the gate's placement — on
`bookSession` it is `callerContactId` (`booking/index.ts:832`), computed from the
guest email+name match at `:815-831` that the rail runs regardless (§0.5(a)).

**The public mirror is display only, and the client's rule is explicit.**
`TeamPublicProfile.required_waivers` carries the summaries — id, slug, title,
version, `guardianRequired`, never the body — computed by `syncTeamPublicProfile`
**from the policy document**. It is never read for a decision.

> **The client calls `resolveWaiverRequirement` if and only if the mirror lists
> at least one required waiver.** A tenant with no waiver — which is every tenant
> on the day this ships — pays **zero** extra round-trips on the acquisition
> path. A tenant with one pays exactly one callable, on a step it is about to
> render anyway.

That is only sound if the mirror is never meaningfully stale, and the first draft
left it stale by construction: `syncTeamPublicProfile` is triggered by writes to
the **team** document, while the policy lives at
`teams/{t}/waiver_policy/current`, and nothing in the publish path touched the
team doc. A studio flipping Required on at 09:00 would have had the mirror stay
empty; a member booking at 09:05 would see no step, call `bookSession` — which
burns their verification code at `booking/index.ts:601-610` **before** the gate —
and be refused, with re-verification capped at 3 codes per email+team per hour
(`:116`). So: **every policy write stamps `teams/{t}.surfaces_updated_at` in the
same transaction** (P4-D), and the mirror is never stale by more than one sync.
As built, that is not a call to `touchTeamForSurfaceRecompute` — that helper does
its own standalone `.set()` and cannot join a transaction. The touch is folded
INTO the policy writer (`writePolicyAndTouchTeam`), so the two halves cannot be
separated by a new call site.

The fallback behind that still fails safe, which is what makes W-B2's fail-open
mirror harmless: if the mirror is briefly empty, a visitor sees no step and the
**server refuses with `waiver_required`**, which the surface handles by fetching
the requirement properly. Annoying; never a compliance hole. W6 pins it.

**A required entry that cannot be resolved fails CLOSED.** If the policy lists a
document whose current version cannot be read, `bookSession` refuses with
`reason: 'waiver_unavailable'` rather than booking. A compliance gate that fails
open is not a gate. Three things make this unreachable in practice, and each is
its own invariant: waiver documents are callable-only (W3), a published document
cannot be deleted (W2), and archiving or unpublishing a required waiver removes
it from the policy in the same transaction (W5). The studio also sees a banner on
the Documents page when the policy and the documents disagree, which is the
`assertFinanceInvariant`-shaped move: make the impossible state loud.

### 1.6 Rules

```
match /documents/{documentId} {
  allow get:  if isAuthed() && isTeamMember(resource.data.teamId);
  allow list: if isAuthed() && isMemberOfResourceTeam(resource);

  // Waiver documents are CALLABLE-ONLY, exactly as promo codes are
  // (firestore.rules:643-645). Their content is somebody's evidence and their
  // required-ness is an authorization fact; neither may be a client write.
  // CREATE CONSTRAINS THE PUBLISH STATE TOO. The draft constrained only `kind`,
  // which left `status`, `current_version` and `min_valid_version` client-
  // writable at creation on every kind — so W3's "unwritable by any client on
  // any kind" held for update and not for create, and a single client setDoc
  // could mint a document at status 'published' with no version (breaking W29)
  // or at a `current_version` no snapshot backs, which is the one state the
  // ledger has no defence against. Shipped with the three extra clauses.
  allow create: if hasTeamRole(request.resource.data.teamId, 'manager')
                && request.resource.data.get('kind','other') != 'waiver'
                && request.resource.data.get('status','draft') != 'published'
                && request.resource.data.get('current_version', null) == null
                && request.resource.data.get('min_valid_version', null) == null;
  allow update: if hasTeamRole(resource.data.teamId, 'manager')
                && resource.data.get('kind','other') != 'waiver'
                && request.resource.data.get('kind','other') != 'waiver'
                // publish state is minted by publishDocumentVersion only
                && request.resource.data.get('current_version', null) == resource.data.get('current_version', null)
                && request.resource.data.get('min_valid_version', null) == resource.data.get('min_valid_version', null);
  // A document that is published, or that has ever been published, cannot be
  // deleted — its text may be somebody's evidence (W-B1). An unpublished draft
  // still can. BOTH clauses: every document published before Phase 4 has
  // current_version == null, so the version clause alone protects nothing that
  // already carries acceptances.
  allow delete: if hasTeamRole(resource.data.teamId, 'manager')
                && resource.data.status != 'published'
                && resource.data.get('current_version', null) == null;

  match /versions/{versionId}       { allow read: if isAuthed() && isTeamMember(get(/databases/$(database)/documents/documents/$(documentId)).data.teamId);
                                      allow write: if false; }
  match /acceptances/{acceptanceId} { allow read: if isAuthed() && isTeamMember(resource.data.teamId); allow write: if false; }
  match /notices/{noticeId}         { allow read: if isAuthed() && isTeamMember(resource.data.teamId); allow write: if false; }
  match /signers/{contactId}        { allow read: if isAuthed() && isTeamMember(resource.data.teamId); allow write: if false; }
  match /guardian_requests/{id}     { allow read, write: if false; }   // token is the only credential
  match /notify_jobs/{jobId}        { allow read, write: if false; }   // server-only driver
}
```

**And the rule W-B14 says is missing**, inside the `match /teams/{teamId}` block
(`firestore.rules:357`), which enumerates its subcollections individually and has
no catch-all — so `teams/{teamId}/settings/documents` is denied to every client
until this exists:

```
match /settings/{settingId} {
  allow read:  if isTeamMember(teamId);
  allow write: if hasTeamRole(teamId, 'owner');
}
```

This lands with **P4-C**, in the same commit as the config move, not with the
waiver work — without it the studio's signup-consent save fails outright.

> **Note the `get()` in the subcollection reads.** The parent document lookup
> costs one document read per rule evaluation. The alternative is denormalising
> `teamId` onto every subcollection row and matching on that — cheaper, and it is
> what the acceptance, notice and signer rows already carry (`teamId` is on all
> three types above). **Use the denormalised field**, not the `get()`, on
> `acceptances`, `notices` and `signers`; keep the `get()` only on `versions`,
> which is listed rarely. Written out here because the `get()` form is the one a
> reader reaches for first and it is the expensive one.

**A waiver document is client-unwritable, so it needs callables that can write
it — all of them, not just create.** W3 denies client create, update *and*
delete on `kind: 'waiver'`, while the document editor's save is a direct client
write (`apps/web/src/plugins/documents/hooks.ts` — `setDoc` `:86`, `updateDoc`
`:108`, `deleteDoc` `:115`, called from
`plugins/documents/[documentId]/page.tsx`). The first draft named only
`createWaiver`, `publishDocumentVersion` and `setWaiverRequirement`, which would
have frozen every waiver at its empty creation state: a studio could mint
"Liability release", type the text, hit Save, and be denied — with no callable
behind the button and therefore no way to ever author a v1, let alone a v2 after
a lawyer sends corrected wording. The same gap denied archiving, which §6.4's
table promises a downgraded team can still do.

So P4-D owns **five** callables, not three:

| Callable | Writes | Plan gate |
|---|---|---|
| `createWaiver` | the document, `kind: 'waiver'` | `requirePlan(teamId, WAIVER_MIN_PLAN)` |
| `updateWaiver` | title, body, summary, source, `externalUrl`, and the three settings fields (`guardianRequired`, `validityMonths`, `scope`) — **never `required`, in either direction** | `requirePlan` for content edits only |
| `publishDocumentVersion` | the version snapshot, `current_version`, `min_valid_version`, the policy entry, the team touch | `requirePlan` **only when `kind === 'waiver'`** (W17) |
| `setWaiverRequirement` | the `required` flag and the policy entry | **asymmetric** — see §6.4 |
| `archiveWaiver` | `archived_at`, and removes the policy entry in the same transaction (W5) | none — retiring is not creating |

The document editor routes its save through `updateWaiver` when
`kind === 'waiver'` and keeps its direct client write for every other kind.

> **CORRECTION, made while implementing: `updateWaiver` does NOT write
> `required`, not even to turn it off.** The row above originally gave it the
> off-arm, and that contradicts **W5** two paragraphs up — `required` is the flag
> that decides whether a document appears in `teams/{t}/waiver_policy/current`,
> and W5 says the policy is written only by `publishDocumentVersion` and
> `setWaiverRequirement`. A second path able to flip the flag without patching
> the policy in the same transaction is exactly how the two stop agreeing, which
> is the state §1.5's banner and §5.4's verifier both exist to catch. Nothing is
> lost: `setWaiverRequirement({ required: false })` is ungated (§6.4's asymmetry
> already says so), so every promise made to a downgraded team still holds.
> `updateWaiver` refuses a `required` key outright with
> `reason: 'required_not_writable_here'` rather than ignoring it, because a
> silently-dropped field is how a studio comes to believe it turned a gate off.
>
> A settings edit and its policy patch are ONE transaction for the same reason.
> A content-only edit stays a plain update and pays for no policy read — it
> cannot change anything the policy carries.

`teams/{teamId}/waiver_policy/{docId}`: `allow read: if isTeamMember(teamId)` /
`allow write: if false`.

**Contacts read nothing directly.** A contact session never reads a signer row, a
version or an acceptance. Every public answer comes from a callable (§3.1, §7.5)
— the same discipline as `promo_codes` (W15 in Phase 3) and for the same reason:
the reads are cheap to serve and expensive to get right in rules, and a guest has
no session at all.

### 1.7 Caps and constants

`packages/shared/src/types/waiver.ts`, in the shape of `PROMO_CODE_LIMITS`
(`types/promoCode.ts`) and `PRODUCT_LIMITS` (`types/product.ts:77-86`):

```ts
export const WAIVER_MIN_PLAN: SaasPlan = 'studio'
export const WAIVER_LIMITS: Record<SaasPlan, { maxWaivers: number }> = {
  free:         { maxWaivers: 0 },
  coach:        { maxWaivers: 0 },
  studio:       { maxWaivers: 5 },
  organization: { maxWaivers: 20 },
}
/** Bounds the GATE's read cost, independently of how many waivers exist. */
export const MAX_REQUIRED_WAIVERS_PER_TEAM = 3
/** Bounds a document's version subcollection. A studio that hits this is
 *  republishing in a loop and should hear about it. */
export const MAX_DOCUMENT_VERSIONS = 200
export const AGE_OF_MAJORITY_YEARS = 18            // CH. §10 Q5 on jurisdictions
export const GUARDIAN_LINK_EXPIRY_HOURS = 72
/** Scope and window, stated because the first draft left both undefined and an
 *  undefined cap on a retry loop is a permanent lockout rather than a delay:
 *  FIVE requests per SUBJECT IDENTITY per rolling 24 HOURS, counted over
 *  guardian_requests where subject_identity_key == … and created_at > now-24h.
 *  The refusal copy names when it resets (W25). */
export const MAX_GUARDIAN_REQUESTS_PER_SUBJECT_PER_DAY = 5
export const MAX_WAIVER_BODY_CHARS = 50000          // the ONE definition (W-B8)
/** One notify worker pass. Sized against the 540s ceiling and a serial Brevo
 *  POST per recipient, NOT against WAITLIST_SWEEP_SCAN_LIMIT — that constant is
 *  an hourly sweep's ceiling with a next pass behind it
 *  (booking/waitlist/constants.ts:68-72), and a publish has no next pass. The
 *  worker re-enqueues while work remains (§2.3). */
export const WAIVER_NOTICE_CHUNK = 100
```

Zero on free/coach is the same statement as `requirePlan(teamId, 'studio')`,
expressed as data so the client can render "0 of 5" without a second rule.

### 1.8 What a waiver is NOT

Recorded because each is a thing an adjacent Wave 3 feature does that a waiver
must not inherit:

- **Not a scarce resource.** No reservation, no hold, no expiry-of-a-hold, no
  release, no `usage_count`, no `promo_busy` analogue. Every one of Phase 3's
  concurrency arguments is vacuous here, and reaching for them adds a counter
  nobody needs.
- **Not a price.** No arm in `resolvePaymentOptions`, no `PaymentTarget`, no
  `MIN_CHARGE_MAJOR`, no Stripe metadata. `packages/shared/src/utils/paymentOptions.ts`
  is not touched by this phase at all — falsifiable by `git diff`.
- **Not a journal event.** No `FinanceCategory`, no `finance_transactions` row.
- **Not a deadline.** A waiver adds no timer to any rail. Phase 2's
  single-deadline rule (`docs/waitlist.md` §"The single-deadline rule") is not at
  risk, and §3.4 explains why the claim rail in particular is safe.
- **Not a subscription, a plugin or an entitlement.** It gates a booking; it
  grants nothing.

---

## 2. The three publish outcomes

> **SHIPPED AS TWO. `notify` is deferred to v2 (§10 D1).** The chooser offers
> `silent` and `require_resign`; `PublishOutcome` in
> `packages/shared/src/types/waiver.ts` has two members and
> `publishDocumentVersion` refuses `'notify'` by name rather than silently
> downgrading it to `silent` (which would tell a studio its members were
> notified when nobody was). Everything below that exists only to SERVE notify —
> §2.3's `notify_jobs` queue, its `onDocumentCreated` worker and cursor, the
> `mailService.ts` `ledgerMeta` linkage, §2.4's four-bucket report and
> `getWaiverNoticeReport`, §2.5, and **⚛ ATOMIC GROUP C** (P4-H, P4-I) — is
> **not built**. Q19 is closed.
>
> **What did NOT leave, and must not be "simplified away":** the
> `documents/{d}/notices/{noticeId}` subcollection stays in the model as
> append-only, with `WaiverNoticeRow`, `WaiverNoticeDelivery`, `waiverNoticeKey`
> and `WaiverSignerState.latest_notice_id` declared and **no writer**. Nothing is
> keyed in a way that assumes a signer row can hold notice state, and
> `accept.ts`'s full-object signer write deliberately carries `latest_notice_id`
> forward. Removing any of it would make notify a MIGRATION later rather than an
> addition — the reasoning is repeated on the type itself, on the path constant,
> and in the `notices` rules block, because that is where a future reader will
> stand when they conclude it is dead weight.

### 2.1 Publishing becomes a callable, for every kind

Today "publish" is a client status flip: `setStatus` in
`apps/web/src/app/[locale]/(auth)/plugins/documents/[documentId]/page.tsx` writes
`status: 'published'` straight to Firestore. That cannot mint an immutable
snapshot, cannot enforce a version cap and cannot choose an outcome.

**`publishDocumentVersion({ documentId, outcome })`** replaces it, for **every**
document kind — because `completeSignup` writing a real acceptance against a real
version (P4-Q) requires terms and privacy documents to be versioned too.
Versioning is universal; the gate and the three-outcome chooser are waiver-only
in effect but uniform in mechanism.

In one transaction it: reads the document; refuses if `status !== 'published'`
would be the result of an unpublished draft with no body; computes
`version = (current_version ?? 0) + 1`; refuses past `MAX_DOCUMENT_VERSIONS`;
`.create()`s `versions/v{NNNN}` with the sanitized body and its `bodyHash`;
updates the document's `current_version`, and `min_valid_version` **only** when
`outcome === 'require_resign'`; and rewrites `teams/{t}/waiver_policy/current`
when the document is a required waiver. `requirePlan(teamId, 'studio')` is called
**only** when the document's kind is `'waiver'` — publishing a privacy policy is
free (W17).

The sanitizer runs here, not at the mirror sync, and the mirror sync then reads
the frozen `bodyHtml` from the version rather than re-sanitizing `body`. That is
the single most important ordering decision in this section: **the text a signer
read and the text stored as version N are the same string, because there is one
sanitize call.** Two sanitize calls with a library upgrade between them would
silently break every hash.

#### 2.1.1 The version backfill — a deploy precondition, not an option

Moving the mirror's source from `body` to `versions/{v}` is only safe once **every
already-published document has a version**, and none does. `syncDocumentPublicProfile`
is `onDocumentWritten`, so the breakage is not immediate — it fires the first time
anything touches a legacy document, which is exactly when nobody is looking.

`scripts/backfill-document-versions.ts`, run **before** P4-D's mirror-source flip
is deployed, and re-runnable:

> For every document with `status === 'published'` and no `current_version`:
> `.create()` `versions/v0001` from `sanitizeRichHtml(body.slice(0, MAX_WAIVER_BODY_CHARS))`
> — the same call at the same clamp the mirror uses today, so the mirror's bytes
> do not change — with `bodyHash`, `publish_outcome: 'silent'`,
> `published_at = updated_at`, `published_by = createdBy`,
> `published_by_name` resolved from the team member (or `'—'`), `supersedes: null`,
> and **`backfilled_at`**. Then set the document's `current_version = 1`.
> `min_valid_version` stays null: a backfill must not supersede anybody.

`DocumentVersion` gains `backfilled_at?: Timestamp | null` for exactly one reason:
**the export must be able to say that a v1 snapshot was taken retroactively.** A
member who signed a terms document in 2025 signed text that was captured in 2026,
and printing that as an ordinary publish would be the one thing §5.2 refuses to
do — assert more than happened. §5.3 prints the marker.

Two ordering facts, because getting either wrong is silent:

- The backfill runs **before** the sync change. Reversed, every legacy document's
  public page blanks on its next write.
- The backfill is **not** the mirror backfill of §6.3. That one is opt-in per team
  because it makes dark content public; this one changes nothing a visitor can
  see, so opt-in would be an invitation to skip a precondition.

**Verification, and it is a checklist gate:** after Group A,
`documents where status == 'published' && current_version == null` is **empty**
across every team.

### 2.2 The three outcomes, exactly

| Outcome | Version doc | `min_valid_version` | Signer rows | Mail | What the studio is told, in one line |
|---|---|---|---|---|---|
| **Silent update** | created | unchanged | **untouched** | none | *"Your members' existing signatures stay attached to the old wording. Nobody is told the text changed."* |
| **Notify signers** | created | unchanged | `latest_notice_id` pointer only | one message **per signer**, one append-only `notices/{id}` row each | *"Signatures carry forward, and we record who actually received the notice — you'll see anyone whose email bounced or is blocked."* |
| **Require re-signing** | created | **← N** | **untouched** | none | *"Everyone must tick again before their next booking. Strongest evidence, most friction."* |

Three things are load-bearing about that table:

**(a) `require_resign` writes no signer rows.** The obvious implementation flips
every valid signer to `superseded`, which is O(signers) writes, needs batching,
and — worse — leaves the gate wrong while the batch is in flight. Instead the
document's floor moves and `waiverAcceptanceState` derives supersession from it.
Same idiom as lazy gift-card hold expiry (`giftCards.ts:22-29`) and lazy promo
reservation expiry: **compute, don't sweep** (W13). It is O(1), it is correct at
every instant, and it makes "un-require" (a studio that clicked the wrong button)
a single field write rather than an unwind.

**(b) `notify` also does not move the floor.** A notified signature is still
valid. That is the whole point of the outcome and it is also the whole evidential
weakness — §5.2 says so out loud, in the UI and in the docs.

**(c) The chooser is presented by outcome, never by severity.** "Minor / material"
was explicitly rejected as a judgement studios will get wrong. Each option is
named by **what happens** and carries its evidential cost in the one line above,
in the studio's own language. §7.2 specifies the control.

### 2.3 `notify` — recording deliverability, per recipient

Four properties of the existing mail machinery dictate the whole design, and each
is a constraint rather than a preference:

1. **`mail_sends` has no recipient field.** `MailSendRecord`
   (`packages/shared/src/types/mail.ts:26-39`) records the idempotency key, the
   stream, the team, a provider message id and a status. Who it went to is not on
   the row. ⇒ **one send per signer**, with the recipient identified by the key.
2. **A ledger row exists only when the caller passes an `idempotencyKey`**
   (`mailService.ts:136-144`, `:197-212`). ⇒ every notice passes one.
3. **One message to N recipients is one row and one `provider_message_id`.** ⇒ a
   batch send makes per-recipient deliverability structurally impossible.
4. **Two non-deliveries write no row at all**: an address already suppressed
   (`mailService.ts:181-186`) and the `MAIL_ENABLED=false` kill switch (`:127-130`).
   Only synthetic and policy drops write a `suppressed` row. ⇒ "no row" is
   ambiguous between *never attempted*, *kill switch*, and *address already dead*,
   so the notice job must **check and record suppression explicitly** rather than
   inferring it from an absence.

The key, keyed on the **event** and not on the relationship — the lesson
`booking/waitlist/notify.ts` records at `:59-72`, where a
`{session}-{contact}` key silently deduped a second round's mail and handed
someone a held seat nobody told them about:

```ts
waiverNoticeKey(documentId, version, contactId, attempt) =
  `waiver-notice-${documentId}-v${version}-${contactId}${attempt > 1 ? `-r${attempt}` : ''}`
```

The `attempt` suffix is what makes the studio's **Resend** action actually send.
Without it the resend is swallowed by the first attempt's key — the identical
failure `notify.ts` documents.

The delivery state is an **append-only row**, `documents/{d}/notices/{noticeId}`
(`WaiverNoticeRow`, §1.4), **never a field on the signer row** — §1.2 states why
at length and it is the single largest change this design pass made. `noticeId` is
the key above, which is also the `mail_sends` document id, which is what lets the
report read delivery state by direct `get` with no query and no linkage.

```ts
export type WaiverNoticeDelivery =
  | 'not_attempted'     // the worker has not reached this signer yet (see below)
  | 'no_address'        // the contact has no email at all
  | 'suppressed'        // isSuppressed() true at send time — a prior hard bounce/block/spam/unsub
  | 'blocked_by_policy' // messaging_policies drop, or a synthetic recipient
  | 'not_sent_env'      // MAIL_ENABLED=false — a fact about the environment, not the member (§0.4(e))
  | 'sent'              // handed to Brevo; no delivery event yet
  | 'delivered'
  | 'deferred'          // soft bounce — transient, NOT evidence of non-delivery
  | 'bounced'           // hard bounce
  | 'spam'
  | 'failed'
```

**The driver: a job document and a worker, not the callable (§0.5(g)).**
`publishDocumentVersion` writes `documents/{d}/notify_jobs/{jobId}` in the publish
transaction and returns. An `onDocumentCreated` worker with
`timeoutSeconds: 540` — the `processScoresRebuildJob` shape
(`gamification/processScoresRebuildJob.ts:37-42`) — drains it:

```ts
interface WaiverNotifyJob {
  teamId: string; documentId: string; version: number
  /** Resumable CURSOR, not a ceiling: the last contactId processed. The worker
   *  re-enqueues itself while work remains, so a 2000-signer cohort completes
   *  rather than truncating. A partial notify is a compliance answer that is
   *  WRONG, not merely late. */
  cursor: string | null
  status: 'running' | 'done' | 'failed'
  attempted: number
  started_at: Timestamp
  finished_at?: Timestamp | null
}
```

Per pass the worker reads `isMailEnabled()` **once** (`mailService.ts:127-130`
short-circuits before any Firestore work, so a disabled environment writes no
ledger row at all and "no row" would otherwise be indistinguishable from "never
tried"), then for up to `WAIVER_NOTICE_CHUNK` signers whose state is `valid` at
publish time:

1. `.create()` the notice row at `state: 'not_attempted'`. **The row exists before
   the send**, which is what makes the fourth bucket derivable rather than absent.
2. No address → `no_address`, done. Kill switch off → `not_sent_env`, done.
3. `isSuppressed(email)` — explicitly, recorded on the row as
   `suppressed_at_send`, because `mailService` writes **no ledger row** for an
   already-suppressed recipient (`:181-186` filters, `:192` returns) and an
   absence must never have to be interpreted.
4. `sendEmail` with the key **and the ledger metadata** (below) →
   `offerWasDelivered(outcome)` (`booking/waitlist/constants.ts:74-92`) splits
   `sent` from `blocked_by_policy`.
5. Update the notice row's `state`, `sent_at`, `provider_message_id`; set
   `latest_notice_id` on the signer row (a cache — nothing evidential reads it).

Then re-enqueue with the new cursor, or mark the job `done`.

**The linkage rides the send; it does not race it (W-B11).** The first draft
stamped `waiver_notice: {…}` onto the `mail_sends` row **after** `sendEmail`
returned, and that cannot be made correct in either direction:

- **Stamp before the send** and `dispatch`'s idempotency guard kills the send
  permanently: `mailService.ts:136-144` returns `{ skipped: true }` whenever
  `existing.exists && existing.data()?.status !== 'failed'`, and a pre-created row
  has `status: undefined`, which is not `'failed'`. No mail, ever, and no
  `provider_message_id` to link.
- **Stamp after the send** and the webhook wins the race for exactly the events
  that matter. Brevo fires `blocked` for a dead address within seconds; the
  worker is still iterating other recipients. `updateLedgerStatus` finds no
  `waiver_notice`, does nothing, and is best-effort with no retry
  (`handleBrevoWebhook.ts:64-66`), so the miss is permanent. The notice sits at
  `sent` forever and the studio reads "not confirmed" for someone who was
  provably not told — the precise answer Decision 5 makes load-bearing.

So **`OutboundMessage` gains an optional `ledgerMeta: Record<string, unknown>`**,
spread into the **same** `ledgerRef.set` that already records the send
(`mailService.ts:197-212`). One write, no window. `packages/functions/src/mail/mailService.ts`
is therefore in P4-H's file list — the first draft's omission of it is what made
the impossible version look implementable.

**The fan-out carries its OWN event map (W-B13).** `handleBrevoWebhook` maps
`waiver_notice` rows independently of `LEDGER_STATUS`, because that constant is
wrong for this purpose twice over and other readers depend on it:

| Brevo event | `LEDGER_STATUS` | Notice state | Why it differs |
|---|---|---|---|
| `delivered` | `delivered` | `delivered` | — |
| `hard_bounce` | `bounced` | `bounced` | — |
| `soft_bounce` | `bounced` | **`deferred`** | a full mailbox is not a dead address (W-B11) |
| `blocked` | `blocked` | `bounced` | — |
| `spam` | `spam` | `spam` | — |
| `unsubscribed` | **absent** | **`suppressed`** | `SUPPRESSION_EVENTS` lists it (`:13-21`) and the address is dead for all future studio mail, but `LEDGER_STATUS` (`:24-33`) has no entry, so nothing fires today (W-B13) |
| `invalid_email` | `failed` | `failed` | — |

Wrapped and best-effort exactly as the existing update is (`:64-66`) — the webhook
must keep returning 200 (`:119-123`) or Brevo retry-storms. `LEDGER_STATUS` itself
is **not** edited.

**And the report does not trust the fan-out anyway.** §2.4 re-derives from
`mail_sends/{noticeId}` (whose `status` `updateLedgerStatus` writes regardless of
any linkage) and re-checks `isSuppressed(email)` at read time. A missed webhook
therefore degrades to `suppressed` or to the ledger's own status rather than to a
false "not confirmed". Correctness lives in the read; the fan-out is the live
view's optimisation.

### 2.4 The report: "which of my members have no valid notice"

`getWaiverNoticeReport({ documentId, version })` — a **callable**, because both
mail collections are rules-denied (`firestore.rules:294-302`, with the PII reason
stated on the line) and a studio's browser cannot read them at all.

**It enumerates SIGNERS and joins notices onto them — never the reverse.** The
first draft enumerated notices, and a signer with no notice row therefore fell
into **none** of its buckets: the report rendered a complete-looking answer that
omitted exactly the people who were never mailed. Two ordinary situations produce
that signer — the worker has not reached them yet, and anyone who signs *after*
the publish — and §12's claim that the buckets "partition the signer set exactly"
is unachievable against an absent state.

Four buckets, and the fourth is the one the first draft was missing:

| Bucket | States | What the studio may conclude |
|---|---|---|
| **Notice delivered** | `delivered` | Brevo confirmed delivery to that address. |
| **No valid notice** | `no_address`, `suppressed`, `bounced`, `spam`, `failed` | **These people were not told**, and the reason is about *them*. This is the answer to Decision 5's question. |
| **Not confirmed** | `sent`, `deferred` | Handed over, no confirmation. Neither a success nor a failure. |
| **Not sent by us** | `not_attempted`, `blocked_by_policy`, `not_sent_env`, *and any signer with no notice row for this version* | **We did not send it.** An operator or environment fact, never an accusation against the member. |

Three things are load-bearing:

**(a) `sent` is terminal, not a failure.** Brevo does not guarantee a `delivered`
event, and `updateLedgerStatus` is best-effort and swallows its own errors
(`handleBrevoWebhook.ts:64-66`), so a row can sit at `sent` forever for a
perfectly live address. A report that called that "not told" would libel live
members. The UI prints one line under bucket three saying so.

**(b) Bucket four separates the operator from the member**, which §0.4(e) argues
at length: `MAIL_ENABLED=false` and a `messaging_policies` drop say nothing
whatsoever about whether a member's address is good, and filing them beside a hard
bounce attributes an operator's configuration to a person. A signer the worker has
not reached yet lands here too, and **so does anyone who signed after the
publish** — which is a real and permanent population, not a transient one, and the
bucket's copy says so: *"signed after this version was published; they signed the
current text."*

**(c) The report re-derives rather than trusting the fan-out.** For every signer
it reads `mail_sends/{noticeId}` directly — same id, no query, and its `status` is
written by `updateLedgerStatus` regardless of any `waiver_notice` linkage — and
re-checks `isSuppressed(email)`. A webhook that beat the linkage therefore
degrades to `suppressed`/`bounced` rather than to a false "not confirmed". §2.3
states the race this defends against.

Per row: name, email, notice state, when, and a **Resend** action (which mints
`attempt + 1`). Bucket two is sorted first and is the default view, because it is
the only bucket that requires the studio to do anything about a *person*; bucket
four is second, because it is the only one that requires the studio to do
something about *itself*.

**Every version's report stays reachable, forever.** `version` is a parameter and
the notice rows are append-only, so the answer to *"who was told about version 4"*
survives the publish of version 5 — which was the whole point of making notices
rows (§1.2). §7.1 wires the navigation: the version-history row for any `notify`
publish links straight to that version's report, and the signers tab carries a
version selector defaulting to the current one. Without that wiring the
deliverability data would be written and never read.

**On the sandbox this report will read as broken, and it is not.** The
`messaging_policies` default there is `silent`
(`packages/shared/src/types/mail.ts:41-52` and the `MESSAGING_DEFAULT_MODE`
param), so every notice lands in `blocked_by_policy` and bucket two holds
everybody. Stated here as `docs/waitlist.md` states the same hazard for the
queue, so the first person to run a lead demo does not file a bug.

### 2.5 What `notify` costs, honestly

A studio with 400 signers publishing a `notify` version sends 400 messages and
writes 400 notice rows (plus 400 one-field signer-row cache updates), across
`ceil(400 / WAIVER_NOTICE_CHUNK)` worker invocations. That is the price of
per-recipient deliverability and it is unavoidable given constraint 3 above. It is
also why `notify` is not
the default: the chooser's default selection is **`require_resign` for a waiver**
and **`silent` for every other kind**, with the other options one click away.
§10 Q3 asks Franco to confirm that default, because it is a friction decision
sitting on the booking path.

The serial send is deliberate and constraint 3 forces it — a batch is one
`mail_sends` row and one `provider_message_id`, which makes per-recipient
deliverability structurally impossible. §10 Q19 records the batch alternative and
why v1 does not take it, because "why does publishing take four minutes" will be
asked. The worker's cursor makes the duration a non-issue for correctness.

---

## 3. The gate

### 3.1 One public callable answers the whole question

**`resolveWaiverRequirement`** — the analogue of `previewPromoCode`, on its own
`'waiver-check'` rate-limit bucket. Input: `{ teamId, activityId?, contactId?,
email?, firstname?, lastname?, birthdate? }` plus an optional contact session.
Output, per applicable waiver:

```ts
{
  documentId, slug, title, version, bodyHtml, bodyHash,
  guardianRequired: 'never' | 'if_minor' | 'always',
  /** The resolved answer for THIS caller, from the one predicate. */
  state: WaiverAcceptanceState,
  /** What the surface must do next. */
  action: 'none' | 'sign_self' | 'ask_birthdate' | 'sign_guardian'
        | 'guardian_pending' | 'guardian_undeliverable',
  intentId: string,
  guardianRequestId?: string,
  /** `s…@…ch` — see §3.1's chosen-disclosure paragraph. */
  guardianEmailMasked?: string,
  /** Why the link did not arrive, so the surface asks for a DIFFERENT address
   *  rather than showing a spinner (§4.6). */
  guardianUndeliverableReason?: GuardianUndeliverableReason | null,
  /** A guardian ticked, and the signature is waiting for this booking to carry
   *  it onto the ledger. `action` is 'none' — nothing left for the visitor to DO
   *  — while `state` is still 'none', because no signer row exists yet. A
   *  surface that rendered "signed" off `state` alone would show a completed
   *  signature as missing, which is why this is a field and not an inference. */
  guardianSignatureReady?: boolean,
}
```

Every public surface renders its waiver step from this and nothing else.

> **CORRECTION, made while implementing: the `contactId` in that input list is
> NOT a proof and is not trusted.** Honouring a bare `contactId` from the request
> body would turn a public, unauthenticated callable into an oracle over a
> compliance fact — *"has contact X signed the release?"*, one call per guessed
> id — which is the same shape the July 2026 audit closed on
> `createDropInCheckout` (finding #2, `docs/security-audit-2026-07.md`). So the
> callable accepts exactly the proofs the RAILS accept, in the same order: a
> contact session; or `authenticatedContactId` + `verificationCodeId` validated
> **read-only** against `booking_verification_codes` (never marked `used` — this
> callable must not spend a credential the rail is about to need, against a
> three-per-hour budget); or email **and** name through the shared guest
> predicate; or nothing, which yields the conservative answer. A `contactId` is
> honoured only when it agrees with the session, so an over-eager client still
> works. That also makes W9 exact rather than approximate: the two answers come
> from the same proofs *and* the same resolver.

**Caller resolution is email AND name, from the SAME helper the rails use — not
email alone.** The first draft said "an exact-match lookup on the normalised
email", and that is a real divergence rather than a paraphrase: `bookSession`
matches on email **and** firstname **and** lastname (`booking/index.ts:815-831`)
and `createDropInCheckout` does the same (`dropIn.ts:266-275`). One email can
address several contacts — the ordinary configuration for a family, and
`utils/contactSession.ts:93`'s own comment describes a parent signing in to a
child's profile — so the two resolvers would pick **different** people, and the
divergence is not merely confusing:

> Sabine and her son Nils share `familie-meier@bluewin.ch`. Sabine signed the
> `if_minor` release last year and her `birthdate` is set. Nils books.
> An email-only lookup matches **Sabine**, computes age 41, and returns
> `state: 'valid', action: 'none'` — no step, no date-of-birth question, **no
> guardian link**. The gate then matches email+name, resolves **Nils**, finds no
> signer row and refuses. On the returning-member path that refusal arrives after
> the verification code was already marked used. Worse: on a class Sabine's
> contact could book, a 12-year-old passes the gate on his mother's signature.

So P4-F extracts the guest-matching predicate `bookSession` and
`createDropInCheckout` already share into **one helper** and calls it; the booking
form already holds firstname and lastname. And:

> **When an email resolves to more than one contact and no name narrows it to
> one, the callable returns the CONSERVATIVE answer** — `state: 'none'`,
> `action: 'sign_self'`, age unknown — never any candidate's state. Asking
> someone to tick again costs a tick. Not asking costs the gate.

That is what W9 asserts, and §12 checks it with two contacts on one shared email.

It **writes nothing** except a guardian request when one is explicitly asked for
(§4.2). A visitor who opens the booking form and leaves has left no trace.

**One deliberate disclosure, stated rather than discovered.** When a caller who
supplies only an email has a pending guardian request, the callable returns
`action: 'guardian_pending'` with `guardianEmailMasked`. That tells an
unauthenticated caller who typed a known address that a guardian request exists
and roughly where it went. It is **chosen**: it is what makes §4.3 step 6a's
resume possible without a second bearer token, the address is masked, and it is
the same standard `manage-booking` and the waitlist claim already run on. Recorded
here so it reads as a decision rather than a leak.

### 3.2 Where the gate refuses, on every entry point

**The census owner is a grep for the WRITE SITES, not for the callable names.**
The first draft greped the seven callables it already believed in, which is
circular: a list of names you trust cannot discover the name you forgot. It
missed `selfCheckIn` — a live callable that writes `participants` with **no
booking required** — for exactly that reason, and that is §8.1 shape 5 reproduced
inside the section that claims to foreclose it. So:

```
grep -rn "collection('participants')\|collection('bookings')\|collection('attendees')\|ATTENDEES_SUBCOLLECTION" \
  packages/functions/src apps/web/src apps/mobile/src
```

Every hit is either a **read**, or an attendance write that must appear in this
table or in §3.10. Regenerate it rather than trusting the rows below to still be
exhaustive.

| Rail | Gate? | Refuse at | Contact created at | Acceptance written at |
|---|---|---|---|---|
| `bookSession` (`booking/index.ts:483`) | **yes** | after `:921` (access gate), before `:923` | `:1007` (guest) / `:990-1003` (matched) | **inside the commit transaction, `:1109-1251`** |
| `createDropInCheckout` (`booking/dropIn.ts`) | **yes** | **before `:411`** — earlier than every other gate on this callable | `:411` | immediately after the contact resolves (~`:430`), before any promo or gift-card reserve |
| `bookAppointment` (`appointments/window.ts:325`) | **yes** | in `[351, 386)` | `appointments/booking.ts:316` | inside `runAppointmentSlotTransaction` (`booking.ts:360`) |
| `createAppointmentCheckout` (`appointments/checkout.ts:110`) | **yes** | in `[168, 251)` | `:251` | inside the hold transaction (`:264+`) — the hold **is** the session |
| `claimWaitlistSeat` (`booking/waitlist/claim.ts:59`) | **yes, and presentable** (§3.4) | before the transaction at `:250` | already exists | inside the claim transaction |
| Waitlist claim → paid (`createDropInCheckout({waitlistToken})`) | inherited | as the drop-in row | — | must **not** re-prompt across the hop (§3.4) |
| Kiosk walk-in (`WalkIn.tsx` → `bookSession`) | inherited | — | — | — (§3.7) |
| `rebookSession` (`booking/index.ts:1838`) | **no** — gate removed | — | — | — (§0.5(c)) |
| `joinWaitlist` (`booking/waitlist/join.ts:57`) | **no** | — | — | — (§3.4) |
| `selfCheckIn` (`sessions/index.ts:800`) | **yes** | before the batch at `:952` | never (contact session) | not written — refuse only (§3.10) |
| **`checkInContact` (`contacts/index.ts:107`)** | **no — exempt** | — | — | — (§3.10). The staff-side QR scanner, structurally identical to `selfCheckIn` and decided the other way because the acting party is a coach at the door |
| Staff class booking (client write, `sessions/[id]/page.tsx:250-261`) | **cannot** | — | — | — (§3.8) |
| Confirming an EXISTING booking into `participants` (`bookings/page.tsx:302-315`, `sessions/[id]/page.tsx:559-570`, `checkInContact`'s booking arm) | **never** | — | — | — (§3.10). The attendance relationship was created and gated upstream |
| The waitlist promoter (`booking/waitlist/promote.ts:101`) | **no — system write** | — | — | — (§3.10). It reserves the seat; the person is gated when they claim it |
| `createStaffAppointment` (`appointments/staffBooking.ts:202`) | **no block** | — | — | — (§3.8) |
| `handleEventInvitationResponse` (`events/index.ts:360`) | **no — exempt** | — | — | — (§3.10) |
| `addEventCheckin` (`events/addEventCheckin.ts:22`) | **no — exempt** | — | — | — (§3.10) |
| Connect webhook confirms (`connect/webhook.ts`) | **never** | — | — | — |
| Mobile (`apps/mobile/src/services/firestore.ts`) | inherited | — | — | — (§3.9) |
| `completeSignup` (`auth/completeSignup.ts`) | n/a | — | — | at the existing write point (§9 P4-Q) |

**The refusal-costs-nothing window on `bookSession` is `[638, 926]`** — after
identity is settled, before the first contact write. The natural placement is
immediately after the access gate at `:921` and before contact resolution at
`:923`: by then the session, the activity, the team and the caller-or-null are
all resolved, and nothing has been written.

**One genuine cost, stated precisely, because the first draft got the mechanism
wrong and the wrong version is testable-and-passes.** The draft said the
verification code is "burned" so "every existing refusal after that point already
costs the caller a fresh code". What actually happens:

- `bookSession` marks the code `used: true` at `booking/index.ts:601-610`, before
  every gate. But **`bookSession` never re-checks `used`**: its entry checks are
  `exists`, `verified`, `team_id` and `matched_contact_ids` (`:588-600`) and
  nothing else. So a client that simply **re-calls `bookSession` with the same
  `codeId` still succeeds today.**
- `verifyBookingCode` *does* refuse a used code (`:222-223`). So the cost only
  materialises when the surface unwinds to the email step: **one lost
  re-verification**, and re-requesting is capped at 3 codes per email+team per
  hour (`:116-120`).

Getting this right matters because an implementer checking §12's *"a decline burns
no verification code"* by re-calling `bookSession` with the same `codeId` would
find it works, conclude the hazard is imaginary, and skip the returning-member
interposition — which is this phase's self-declared most likely silent miss. It
matters twice over because someone may later "harden" the missing `used` check as
a tidy-up and convert a survivable refusal into the dead end the draft described.

The conclusion is unchanged and is the reason the **client must present the waiver
step before calling `bookSession`** on the returning-member path (§7.3): that path
books directly from `onVerified` (`BookingForm.tsx:1067-1112`), and a member sent
back to the email step to re-verify has a three-per-hour budget between them and
the class. The appointments rail is worse and §7.3 owns it: `resolveAppointmentCaller`
marks the code `used: true` at `appointments/booking.ts:258-262` and
`AppointmentPicker.tsx:477` funnels an unrecognised refusal into a generic
"something went wrong".

### 3.3 Where it is written

**Inside the commit, not after it.** `bookSession`'s transaction
(`booking/index.ts:1109-1251`) reads the session doc, the whole `bookings`
subcollection, and conditionally a credit grant and a usage window. It does
**not** read the contact. Adding the acceptance costs, in the transaction's
**read phase**:

- one `tx.get` of `documents/{d}/signers/{contactId}` — a single-document read on
  a document only this contact ever writes, so it adds no contention;
- one `tx.get` of the **acceptance ref itself**.

and then at most two writes: `tx.create` of the acceptance event and a
**conditional** `tx.set` of the signer row.

**Why the acceptance ref is read, and it is not optional.** §1.4's docblock states
it and it is the trap this design most wants to disarm: `recordFinanceTransaction`'s
`.create()` + catch-gRPC-6 idiom (`finance/journal.ts:52-59`) works **only**
because that helper is a standalone write outside any transaction. Inside
`bookSession`'s transaction a `tx.create()` collision does not throw at the call —
it fails the **whole commit** as a precondition violation, is not
catch-and-continue-able, and takes the seat with it. Two ordinary sequences hit it:

- A client retries `bookSession` after a network timeout with the identical
  payload. Today that retry succeeds (`tx.set(bookingRef)` is keyed on contactId
  and idempotent); with a bare `tx.create` it fails with an opaque
  `already-exists` for a booking that worked.
- A visitor ticks once, books Tuesday's class, uses Back — which §7.3 **requires**
  to be safe — and books Thursday's from the same mounted flow, still holding the
  `intentId` from that step render. Identical `{documentId, version, contactId,
  intentId}`, identical derived id, aborted commit, and every retry with the same
  client state reproduces it.

So: **read it, and skip the create when it exists.** And the rule the draft was
silent on, stated once: **when the gate computes `valid` for this caller the
acceptance write is a no-op, whatever payload arrived.** Both belong in
`accept.ts`'s contract (P4-G), because an implementer told to follow `journal.ts`
will write the uncatchable version.

**The signer row is written CONDITIONALLY, inside a transaction, on EVERY rail.**
Never an unconditional absolute `.set()`: §1.4.1's precedence rule is re-evaluated
against a row re-read inside the same transaction, and an event that does not
strictly improve the row leaves it alone. `rounds` is `read + 1`, never
`FieldValue.increment` — the same rule `bookings_count` and `usage_count` carry.

The alternative — a post-commit write beside the partner-visit ledger
(`:1256-1295`) and the contact alert (`:1308-1333`) — puts the acceptance in the
zone where failures are logged and swallowed. For a compliance record that is a
hole, and §0.4(c) records the reasoning; §10 Q2 puts it to Franco.

**On the paid rails the acceptance is written at the callable, before Stripe, and
is not conditional on payment — but it is still written in its own transaction.**
A signature is a fact about a person (§0's governing rule): they read the text and
ticked, and that is true whether or not the card clears. There is no reserve, no
commit and no release — the deliberate asymmetry with the promo reservation, which
guards a finite counter and therefore must be consumed only by a completed sale.
W1 pins it.

What the first draft got wrong here was the *transactionality*, not the timing: it
wrote the paid rails' acceptance outside any transaction, which meant Firestore's
optimistic-concurrency detection — the thing that saves the free rails from a lost
update — did not apply at all. A manager revoking at 10:00:00 while a drop-in
acceptance that read the row at 09:59:59 landed at 10:00:01 would have silently
undone the revocation **with no contention error**. A signer write outside a
transaction is a bug, not an optimisation (§1.4.1).

One accepted consequence: a visitor who signs and abandons checkout leaves an
acceptance attached to a `provisional: true` contact that `purgeProvisionalContacts`
may later delete. The event row survives (it is evidence and must); the signer
row is orphaned. Orphan signer rows are small, bounded by the abandonment rate,
and **deliberately not swept** — sweeping them would need a collection-group scan
and would risk deleting the row of a contact that still exists. The report filters
to contacts that still resolve. Named in §11 rather than fixed.

### 3.4 The queue: join, offer, claim

**`joinWaitlist` takes no waiver.** Joining a queue is not a booking, and the
code already says so (`booking/waitlist/join.ts` records "NO `acquisition_stage`,
on purpose … joining a queue is not a trial booking"). A waiver at join would
collect a signature for a class the person may never attend, and an offer that
lapses would leave a signature with no booking behind it.

**The claim takes the waiver, and the waiver must be PRESENTABLE there, not
merely refused.** The promoter has already written a `pending` booking carrying
`waitlist_claim` and `claim_expires_at` and incremented the contact's
`pending_bookings_count`; the person gets exactly one offer per entry, ever. A
bare refusal at the claim would silently cost a queued member their one offer for
a document they were never shown. So the claim page grows a third render branch
alongside `claimed` and `payment` (§7.3).

**It adds no second timer.** `docs/waitlist.md` §"The single-deadline rule"
forbids giving one seat two deadlines, and Phase 3 refused a promo code on this
rail for exactly that reason (`docs/promo-codes.md` §"The waitlist claim takes no
code"). A waiver is **not** a price modifier and holds nothing: the tick happens
inside the existing claim window and consumes none of it beyond the seconds it
takes to read. The reasoning is cited rather than inherited, so the next reader
does not assume symmetry where there is none.

**No double prompt across the payable hop.** A payable claim returns
`requiresPayment` and writes nothing (`claim.ts:211-224`), then re-enters via
`createDropInCheckout({ waitlistToken })`. The claim page collects the acceptance
**once** and passes it to whichever callable it then calls; the drop-in gate finds
the acceptance already valid and asks for nothing.

**And the guardian case on this rail is presented, never gated (§0.5(e)).** This
is the one place the self-sign reasoning above does **not** carry, and the first
draft left it unstated — which meant a kids' club's normal path silently destroyed
the scarcest thing in the system. The numbers make it unarguable:
`GUARDIAN_LINK_EXPIRY_HOURS` is 72 against `WAITLIST_DEFAULT_CLAIM_MINUTES` of 120
with a floor of 35 (`booking/waitlist/constants.ts:31-52`), the offer is **one per
entry, ever**, and §4.3 deliberately does not hold the seat while a guardian link
sits unopened. A parent who reaches the guardian branch inside a claim window and
whose partner is at work loses the class permanently, and the studio sees a queued
member who "didn't claim".

Both proposed repairs were rejected in §0.5(e) — clamping the link to the claim
window converts a silent failure into a prompt one, and exempting the rail makes
the gate's coverage depend on how a member arrived. So, on the claim rail only:

> The claimant is **shown** the waiver and told a parent or guardian must sign it.
> They tick nothing they cannot tick. **The claim completes**, the seat commits
> inside its own single deadline, and the booking is written with
> `waiver_state: 'outstanding'`. The guardian link is minted **after the commit**,
> with its ordinary 72 hours and **no seat behind it**. The roster and the
> manifest carry the chip until it resolves.

That is §3.8's posture — surface, do not block — applied to the one rail where
blocking destroys something scarce, and it follows directly from §0's governing
rule: **a signature is not a scarce resource, so it must never consume one.**
W14 is unaffected: the guardian request still carries exactly one deadline of its
own, and no seat, session or claim deadline is created, extended or shortened.

The cost is named rather than hidden: **one committed booking with an outstanding
waiver**, visible on every roster, listed in §11, and the only rail in the product
that produces one without a staff member having chosen it.

> **What the claim page must collect, added while implementing P4-J.** "The
> guardian link is minted after the commit" left the address it is minted *to*
> unspecified, and there is only one honest answer. `claimWaitlistSeat` accepts
> `guardian: { name, email }` on its payload, collected by the claim page's
> waiver branch **before** the claim (there is no second screen to ask on — the
> claim page redirects to a confirmation), and `mintDeferredGuardianLinks` runs
> after the commit with it.
>
> **There is deliberately no fallback to the member's own address.** Mailing the
> child's own mailbox a link that says "a parent must sign this" would produce an
> acceptance stamped `signer_email_verified_by: 'emailed_link'` — a claim of
> *guardian* mailbox control — over an address that is demonstrably the
> subject's. A missing link is visible on every roster; a false record is visible
> nowhere. So when the page collected no address, nothing is sent and the chip
> carries it.
>
> Nothing in that block can fail the claim: the seat is already committed, and a
> cap, a suppressed address or a provider failure leaves the waiver outstanding
> rather than throwing away a taken seat. Asserted in `guardian.test.ts`.

### 3.5 Refusals

Every refusal carries `details.reason`, and every reason has a translated string
(the rule `docs/promo-codes.md` §"Refusals — every reason has a code and
translated copy" states):

| Reason | Means | The surface does |
|---|---|---|
| `waiver_required` | a required waiver has no valid acceptance for this caller | fetch the requirement and render the step |
| `waiver_version_changed` | a `require_resign` publish landed between the tick and the submit | re-render the step with the new text; one extra tick |
| `waiver_guardian_required` | `guardianRequired` resolves to yes and no guardian signature exists | render the guardian branch |
| `waiver_guardian_pending` | the link was emailed, not yet used | show "we've emailed {masked}" + resend / change address |
| `waiver_guardian_undeliverable` | the address bounced or is suppressed | ask for a different address (§4.6) |
| `waiver_guardian_too_many` | `MAX_GUARDIAN_REQUESTS_PER_SUBJECT_PER_DAY` reached for this subject | say **when it resets** (§1.7) — a cap with no stated window reads as a permanent lockout |
| `waiver_guardian_subject_mismatch` | a guardian request is being redeemed against a contact it does not name (§4.3 step 7) | drop the stale request and re-resolve; never silently accept |
| `waiver_guardian_link_invalid` | the emailed link expired, was already used, was voided when the visitor gave another address, or never existed — **deliberately one reason for all four** (W15) | tell the holder the link is dead and to ask the studio for a new one |
| `waiver_guardian_email_invalid` / `waiver_guardian_name_required` / `waiver_guardian_subject_required` | the mint's own input validation | field-level copy on the guardian branch |
| `waiver_not_accepted` | `signAsGuardian` was called without the tick — a client bug, refused server-side rather than filled in | re-render with the box unticked |
| `waiver_birthdate_required` | `if_minor` + unknown age | ask once, with the reason stated (§4.5) |
| `waiver_unavailable` | the policy names a waiver whose version cannot be read | a generic "booking is temporarily unavailable"; the studio sees a banner |
| `rate_limited` | the shared `checkoutRateLimit` refusal, on the `'waiver-check'` / `'waiver-guardian'` buckets | on the **signing page** it must NOT read as an invalid link (§4.3 step 4) — a parent behind a busy studio's NAT would go back for a replacement that fails the same way |
| `plan_required` / `plan_inactive` | from `requirePlan` on the creation path only | never seen by a visitor (§6.4) |

Every one of these has a string in the `Waiver` namespace of
`apps/web/messages/{en,de,fr,it}.json`, keyed `reason_{code}`, in lockstep across
all four locales (W25).

### 3.6 A version published mid-checkout

The visitor is shown version N and submits. Between those, the studio publishes
N+1. The submitted acceptance carries `version` and `body_hash`, and the server
re-reads the floor:

- **`silent` or `notify` published N+1** → the acceptance is recorded **against
  version N**, the version they actually read. It is valid, because neither
  outcome moved the floor. Recording it against N+1 would claim they read text
  they never saw, which is the one thing the whole design exists to prevent.
- **`require_resign` published N+1** → the floor moved past N. The submit is
  refused with `waiver_version_changed`, carrying the new version and text; the
  surface re-presents and the visitor ticks again. One extra tick, no lost
  booking, no lost seat (the refusal is above contact creation and above the
  transaction).
- **A booking that already committed** is untouched. A publish never retroactively
  invalidates a completed booking — the same "in-flight objects complete their
  lifecycle" rule Decision 7 states for plans, applied to versions. Their *next*
  booking is where the floor bites.

Note the `body_hash` is checked, not just the version: if the hashes disagree for
the same version number, something is wrong that should never happen (versions
are immutable), and the server refuses with `waiver_unavailable` rather than
recording a signature against text it cannot identify.

### 3.7 Kiosk

`apps/web/src/app/[locale]/(public)/public/[slug]/kiosk/WalkIn.tsx` calls
`bookSession` with `source: 'kiosk'`. There is no kiosk booking callable — the
kiosk token deliberately carries no `contactId` or `teamId` claim — so a walk-in
books exactly like an anonymous guest and **inherits the gate with no server
work**.

The surface question is real: a doorway tablet is the worst place for a wall of
legal text and the best place for an unsigned person to slip through.
**Recommendation: present it inline** — the same component the booking form uses,
scrollable, one checkbox — because the walk-in is staff-supervised and the tablet
is right there. The alternative (mail the person a signing link, reusing §4's
machinery verbatim, and let them in with a `waiver outstanding` chip on the
roster) is a one-line branch if Franco prefers it.

**But the self-sign case is not where the two options differ, and §10 Q4 is
reframed around the case that decides it: a walk-in who is a MINOR.** Inline and
emailed-link are nearly equivalent for an adult ticking a box at a desk. For a
child they are not equivalent at all: `if_minor` at the door means the tablet
collects a date of birth, then a parent's email address, and then **waits** — on a
device with an idle timer (`useIdleTimer.ts`) that returns to standby, in a flow
(`WalkIn.tsx`) that today collects name, email and phone and funnels every error
into one generic string (`:143-145`). Whatever the answer is, the kiosk needs a
defined behaviour for a minor: refuse the walk-in and send the parent a link,
admit them with an outstanding chip, or require staff to complete it on another
device. §10 Q4 asks that question rather than the inline-versus-link one.

### 3.8 Staff booking — the enforcement hole, stated plainly

**Classes have no staff booking callable.** The studio adds an attendee by writing
`sessions/{id}/participants/{contactId}` **directly from the browser**
(`apps/web/src/app/[locale]/(auth)/sessions/[id]/page.tsx:250-261`), permitted by
`firestore.rules` under the `schedule.manage` capability. There is no server seam
to gate. Enforcing a waiver here would require either a new callable for staff
booking or a rules change that rules cannot express (rules cannot read a signer
row conditionally on a policy document without a `get()` chain per write).

**So: surface, do not block.** The add-participant dialog shows a warning when the
contact has no valid acceptance and offers "email them the waiver" (§4's link,
with the subject and the signer being the same person). The roster chip (§7.4)
shows the outstanding state permanently. This is an honest hole and it is named
here so the next reader does not believe the gate is universal. §10 Q6 asks
whether closing it — one `bookParticipant` callable — belongs in this phase.

**`createStaffAppointment` is the manual-override tool by design** (its own
comment says it works outside availability). A coach booking a client by phone
must not be stopped by a document the client has not opened. Same treatment: no
block, chip on the roster.

### 3.9 Mobile

`apps/mobile` calls the same callables and has **no waiver UI**. A required waiver
would surface as a raw `HttpsError`. The refusal's `details.reason` is what lets
the app say something useful, and the minimum acceptable behaviour is a mapped
message plus a deep link into the web Space. **Building the mobile waiver step is
not in this phase**

> **AS SHIPPED, and the deep link had to come from the SERVER.**
> `apps/mobile/src/utils/waiverRefusal.ts` maps the reason to a sentence naming
> the document (`details.title`), used by both check-in handlers in
> `ProfileScreen.tsx`. The link could not be built client-side: the web origin
> lives in a server-side env param (`HOSTING_URL`) and the app has no equivalent,
> so a guessed hostname would send somebody standing at a door to a page that may
> not exist. `selfCheckIn` therefore attaches **`signUrl`** to the refusal it
> throws — it holds both the origin and the team slug the QR carried — and the app
> offers it. Every other rail's refusal carries no URL and the message says so
> rather than promising one. The strings are English only: `apps/mobile` has no
> i18n layer at all, and inventing one for four sentences would be a bigger change
> than the feature and would sit unused. (`apps/mobile` does not depend on `@linyup/shared` at all — it
mirrors shapes locally — so it is a port, not a call-site edit). §11 records the
omission; P4-M owns the mapped message so the failure is legible rather than
opaque.

### 3.10 Attendance writes that are not bookings

Several paths put a person in a room without going through any booking callable.
None of them appears in a grep for booking callables, which is why §3.2's census
owner greps the **write sites** instead. Each is decided here — gated, exempted
with a reason, or surfaced — because a set is only enumerated when the exemptions
are as explicit as the inclusions (§8.1 shape 5).

> **The implemented census lives in the module header of
> `packages/functions/src/waivers/gate.ts`**, with its own re-derivation recipe,
> and `packages/functions/src/waivers/gate.test.ts` asserts against the SOURCE
> that every listed rail calls the one gate exactly once, that no unlisted rail
> has quietly wired itself in, and that each gate call sits above its rail's
> first contact write. This section is the reasoning; that file is the list.

**`selfCheckIn` — GATED.** `packages/functions/src/sessions/index.ts:800` is a
callable that takes a **contact session**, finds any session inside the check-in
window, and writes `sessions/{id}/participants/{contactId}` at `:927` **with no
booking required and none looked for** — the booking read at `:947-951` only
*confirms* an existing one, and its absence is not an error. It is live on two
surfaces: the kiosk renders a check-in QR
(`kiosk/KioskApp.tsx:143` → `CheckinQr.tsx`) and the mobile app scans it
(`apps/mobile/src/screens/ProfileScreen.tsx:306,328`).

Left ungated, a member who never signed — or whose signature a `require_resign`
publish superseded — walks up, scans, and is written into `participants` for the
18:00 class. They attend unsigned, and the studio's evidence is nothing at all.

It is gated because **it can be**: it is a callable, the `contactId` is on the
token, and the cost is the same one policy `get` plus N signer `get`s every other
rail pays. It refuses with `waiver_required` **before the batch at `:952`**, and
because a check-in creates no contact and books no seat, **it writes no
acceptance** — refusal only. The mobile and kiosk surfaces map the reason
(P4-M): the check-in screen says a document needs signing and deep-links into
Space, which is the one surface a member at the door can complete on their phone.

**`checkInContact` — EXEMPT, and it was MISSING from the first draft's census.**
`packages/functions/src/contacts/index.ts:107` is `selfCheckIn`'s staff-side
twin: a coach opens the session detail page, scans the member's QR, and the
callable writes `sessions/{id}/participants/{contactId}` at `:214` with **no
booking required** — the booking read at `:210` only *confirms* an existing one,
exactly as `selfCheckIn`'s does. The first draft's census named `selfCheckIn` and
not this, which is §8.1 shape 5 recurring inside the section written to foreclose
it; P4-G's re-run of the write-site grep found it.

It is decided the **other way** from `selfCheckIn`, and the axis is **who is
acting** rather than *can it technically be gated*:

> A member scanning at a kiosk is acting alone and unsupervised, so the gate is
> the only thing between an unsigned person and the room. A coach scanning is a
> team member standing at the door who has **chosen** to admit this person, and
> an override a human chose is precisely what §3.8's "surface, do not block"
> means — the same reasoning that leaves `createStaffAppointment` unblocked.
> Refusing here would stop a queue at the door over a document the coach cannot
> resolve from that screen, while the same coach can write the same
> `participants` row by hand from the same page (§3.8).

The reason is stated at the call site, not only here, and the roster chip (§7.4)
is the surfacing. **§10 Q6 now covers both**: if staff class booking gets a
`bookParticipant` callable, this is the second site that changes with it.

**Confirming an EXISTING booking into `participants` — NEVER gated.** Three
client/server sites do it (`bookings/page.tsx:302-315`,
`sessions/[id]/page.tsx:559-570`, and `checkInContact`'s booking arm), alongside
the Connect webhook. All of them settle an attendance relationship that was
created — and gated — upstream. A confirm that could refuse would strand a paid
seat, which is the same reason the webhook is "never" in §3.2's table.

**The waitlist promoter (`booking/waitlist/promote.ts:101`) — a SYSTEM write.**
`seatFreedEdge` writes a `pending` booking carrying `waitlist_claim` for the
person at the head of the queue. There is no caller to refuse and nobody has
attended anything; the gate binds when they *claim* it (§3.4). Named because it
is a `bookings` write and therefore appears in the census grep.

**`handleEventInvitationResponse` and `addEventCheckin` — EXEMPT, with the
reason.** `events/index.ts:360` writes `events/{eventId}/attendees/{contactId}` on
`action: 'attend'`, token-authenticated from the live public route
`public/event-invitation/page.tsx:117`; `events/addEventCheckin.ts:22` is its
admin-side counterpart. Events are exactly the seminars, competitions and open
days a release is most often demanded for, so the exemption is uncomfortable and
is stated rather than assumed:

> An **Event** is a different primitive. It is not a `Session`, it has no
> `Activity` and therefore no `scope: 'activities'` to match, its attendee model
> is its own, and `WaiverApplies` (§1.3) has no arm that can express "this
> event". Gating it would mean either applying every `all_bookings` waiver to
> every event — which silently changes the meaning of a setting studios will have
> configured for classes — or adding a third scope arm, an events surface, an
> events chip and an events report. That is a phase, not a row.

**So v1 does not gate events, and `docs/waivers.md` says so in the studio's own
words** rather than letting a studio infer coverage from "every booking entry
point". §11 carries it and §10 Q14 asks whether events want their own waiver arm
next.

**Staff class booking — CANNOT.** §3.8, unchanged: a direct client write with no
server seam.

---

## 4. Minors — WITHDRAWN AND REPLACED (Franco, 2026-08-16)

> **§4 SHIPPED ON 2026-08-15 AND WAS REMOVED IN FULL ON 2026-08-16.** What it
> specified — an emailed one-time guardian link, a `guardian_requests` store,
> three public callables, a public signing page, a four-language mail template,
> four rate-limit counters, a bounce fan-out, a date-of-birth question, and two
> rails that deferred instead of refusing — is deleted, ~2,500 dedicated lines of
> it. It is not restated here, because a spec section describing no code is worse
> than one that is missing: `docs/waivers.md` → **"Minors"** is the document.

### Why

Three reasons, and the first is the one that decides it.

1. **An emailed link proves control of a MAILBOX, not parenthood.** A teenager
   with a parent's phone defeats it. The mechanism looked like evidence and was
   barely stronger than a checkbox.
2. **It made the booking path a public, unauthenticated, studio-branded mail
   sender.** Everything in §4.6 and half of `waivers/limits.ts` existed to bound
   an abuse surface the feature created for itself. Three of the four blockers
   found across three verification rounds were inside this section.
3. **The studio is the party with the legal exposure and the only party that can
   actually verify** — they see the child at the door. The product's job is to
   make that check easy and PROMPTED, not to simulate an enforcement it cannot
   deliver.

### What replaces it

One optional flag, `WaiverConfig.mayIncludeMinors`, off by default. Setting it:

- adds a second **required** choice to the consent step — *I am the participant*
  vs *I am signing as a parent or guardian*, with an **optional** name;
- stores that on the acceptance as `signer_role` (`'self' | 'guardian'`) and
  `signer_name` — the fields §5.1 already had;
- puts a chip on the roster and the printed manifest for **both** answers
  (`Booking.waiver_state`: `guardian_declared` / `check_participant`), so the
  studio checks at the door.

It asks no age, computes nothing, emails nobody and **refuses nothing**. It is a
**self-declaration**, and the UI copy, the signers tab and the export all say so
in as many words.

### What went with it, so nothing here reads as still-true

`GuardianRequirement`, `resolveGuardianNeed`, `ageInYearsAt`,
`AGE_OF_MAJORITY_YEARS`, `GUARDIAN_LINK_EXPIRY_HOURS`,
`MAX_GUARDIAN_REQUESTS_PER_SUBJECT_PER_DAY`, `GuardianSignatureRequest` and its
predicates, `guardianSubjectMatches`, `waiverSubjectNameKey`, `maskEmail`,
`WaiverGuardianPolicy` and the gate's `defer` / `redeem_guardian` arms,
`WaiverSubmission.birthdate` and every contact birthdate write behind it,
`subject_birthdate_declared`, `guardian_address_same_as_subject`,
`guardian_request_id`, `test_mode`, `BookingWaiverState.outstanding`, the
`guardian_requests` rules block and its `fieldOverrides` index entry, the mail
template, the mint's four counters, the Brevo fan-out's third map, and the
`/public/{slug}/waiver` page (**the slug stays reserved** — freeing it is a data
decision and irreversible once a team claims it).

Invariants **W12, W14, W15, W26 and W27** are withdrawn with their subject. The
refusal set is now three: `waiver_required`, `waiver_version_changed`,
`waiver_unavailable`.

---

## 5. Evidence quality

### 5.1 What an acceptance record contains

The full shape is `WaiverAcceptanceEvent` in §1.4. What it *asserts*, precisely:

> At `accepted_at` (server time), a browser at `ip` running `user_agent`, reading
> the `locale` rendering of the text whose sha256 is `body_hash` — which is
> version `version` of document `documentId`, frozen at publish and unmodifiable —
> submitted a tick. The tick was submitted by `signer_role`, identified as
> `signer_name` at `signer_email`, whose control of that address was established
> by `signer_email_verified_by`. The release is about `subject_name`.

And what it does **not** assert: that the person named is the person who ticked.
Nothing in this design proves identity. `signer_email_verified_by` is the whole
strength axis, and it has **four** honest values:

| Value | What was actually shown | Where it happens |
|---|---|---|
| `emailed_link` | control of that mailbox at that moment | the guardian path (§4) |
| `verified_code` | control of **that specific address**, minutes ago, via a six-digit code | the OTP branch (`authenticatedContactId` + `verificationCodeId`) |
| `session` | control of *an* address on the contact's login allow-list, at some point in the last 7 days | a signed-in contact session |
| `none` | somebody typed an address into a form | a guest booking, and any `test_mode` guardian link (W-B15) |

**`verified_code` was missing from the first draft, and its absence made the
record actively false on the commonest family path.** `bookSession`'s
`authenticatedContactId` branch is not a session: it carries a
`verificationCodeId`, and `booking_verification_codes` stores `email:
sanitizedEmail` — **the address the code was actually mailed to**
(`booking/index.ts:157-168`). That is mailbox-control proof of a specific, known
address, exactly as strong as `emailed_link`. The draft instead took
`signer_email` from the *contact* (`sanitized.email` at `:642-647`) and labelled
it `'session'`, which does not even describe the path.

> A parent verifies with `parent@example.com`, selects their 14-year-old from the
> matched list — the flow `booking/index.ts:560-563`'s own comment describes, "a
> parent booking their child" — and books. The draft would record
> `signer_role: 'self'`, `signer_email: child@example.com`,
> `signer_email_verified_by: 'session'`. All three false, and the export prints it
> as the child's own signature.

So on that branch `signer_email` is copied from
`booking_verification_codes.email` — a field on a document the callable already
fetched — and stamped `verified_code`. **Where that address differs from the
subject's, the record is already telling the reader a third party signed**, and
§5.3's export prints both columns side by side so it can be seen.

The `none` row is still the majority of acceptances on the acquisition surface,
and it is not hidden: the export prints the value and the report can filter on it.

### 5.2 What it is worth — the honest paragraph

This section is not decoration. Its content appears in three places, in the same
words: the publish chooser (§7.2, one line per option), `docs/waivers.md`, and
the export's header.

**Click-wrap is the lightest signature this design could have chosen.** A
checkbox, chosen deliberately for the lowest conversion cost, because this sits on
the path to every booking. It is well-established as an acceptance mechanism and
it carries no drawn mark, no typed name, no second factor.

**Silence-as-acceptance is the lightest renewal.** A `silent` publish tells nobody;
a `notify` publish tells them and treats not-objecting as continued assent.

**Stacked, they are the weakest combination in this design, and a studio should
know it before it clicks.** A long-standing member's record can be **one tick
years ago plus a series of unanswered emails**. For a *liability release* that is
weaker evidence than the same combination would be for terms of service: a
waiver's job is to show the person understood **this specific risk**, and a risk
that was added in version 4 and shipped `silent` was never put in front of them at
all. Terms of service can lean on continued use; a release cannot lean on
continued use to establish comprehension of a hazard.

**Therefore:**

- the publish chooser states the evidential cost of each option in one line, in
  the studio's own language, so the choice is informed rather than default;
- `require_resign` is the recommended option whenever the change touches the
  risks or the release language, and the chooser says so;
- the notice report's "no valid notice" bucket exists so a `notify` publish is a
  *recorded* renewal rather than a decorative one — that difference is the whole
  reason Decision 5 demands deliverability;
- the export prints, per document, every version that ever applied **with its
  publish outcome**, so a reader can see at a glance which changes the member was
  never asked about;
- none of this is legal advice, and the docs say so. The studio picks.

**Three further limits, stated rather than discovered:**

- The declared date of birth is a **declaration**. Nothing verifies it, and the
  record says `subject_birthdate_declared` rather than `birthdate` for exactly
  that reason.
- Images embedded in a waiver body are **not** covered by the version's
  immutability. The snapshot freezes the HTML, which references
  `teams/{teamId}/documents/…` in Storage; replacing that object changes what a
  reader sees without changing `body_hash`. W-B6 also makes those objects
  world-readable regardless of status. §7.2's editor warns when a waiver body
  contains an image, and §10 Q9 asks whether images should simply be forbidden in
  a waiver.
- An `external_link` waiver snapshots the **URL**, not the content. Whatever is at
  that URL can change freely. The publish chooser says so and recommends
  rich-text for waivers.
- `guardian_address_same_as_subject` is a **floor** on the guardian weakness, not
  a proof of distinctness: the comparison is `normalizeEmail` — trim and lowercase
  (`shared/utils/normalizeEmail.ts:5-7`) — so plus-aliases and dot-variants of one
  mailbox read as two. **False means "not detected", never "different person"**
  (§4.4).
- In a **`TEST_MODE`** environment `dispatch` redirects every recipient to one
  inbox and bypasses the policy layer entirely (`mailService.ts:147-155`), so a
  guardian link lands in a shared mailbox and anyone with access can tick it.
  Minting is not refused — that would break local development and the seeded lead
  demos of the one flow that most needs both (§0.5(d)) — so the record says what
  happened instead: `test_mode: true` on the request and the acceptance, and
  `signer_email_verified_by: 'none'`, **never `'emailed_link'`**.

**And the accumulating weakness is SURFACED, not only recorded.** Every honest
paragraph above appears in the publish chooser (before the fact), in
`docs/waivers.md`, and in the export (after somebody has already asked). None of
them tells a studio the one thing it could act on, because the gate treats a
bounced-notify signer as `valid` and the roster chip renders nothing for `valid`.
So the waiver's **signers tab carries a standing summary line** (§7.1):

> *"31 members' signatures predate a change they were never asked to accept, and
> 4 of those notices did not arrive."*

Both numbers are already computed — the first from each signer's
`accepted_version` against every later `silent`/`notify` version, the second from
§2.4's bucket two — so this is a rendering, not a new mechanism. It is the only
place in the product that answers *"how good is my evidence right now"*.

### 5.3 The export — a single member's complete consent history

`exportContactConsentHistory({ contactId, format: 'json' | 'html' })` — a
callable, returning a self-contained artefact:

- **Header**: the studio, the contact as of export, the export instant, the
  operator, the §5.2 paragraph in short form, and one sentence stating that **an
  email address is not a person** (it governs the last section below).
- **Per document**, ordered: every version that ever existed with its
  `publish_outcome`, `published_at`, `published_by_name` — so the reader sees
  which changes were `silent` — and **`backfilled_at` where set**, because a v1
  minted retroactively by §2.1.1 must not be printed as an ordinary publish.
- **Per acceptance and revocation event**, ordered: every field of §1.4's shape,
  with the **full text materialised** from the version document, plus the stored
  `body_hash` and an explicit **hash-match verdict**. A mismatch is printed, not
  hidden — and it now prints **next to what to do about it** (§5.4), because an
  artefact that tells a lawyer the evidence is broken and stops there is worse
  than one that does not check.
- **Per notice**: every notice row for every version — which version, which
  attempt, the final delivery state and the instants — read from
  `documents/{d}/notices`, which is append-only, so a later `notify` publish
  cannot erase an earlier one's record (§1.2).
- **Current state** per document, from the one predicate.
- **"Other records for this email address"** — a separate, explicitly labelled
  section, never merged into the member's own history. See below.

**Both queries run, always, and they render differently.** The primary query is
the collection group on `acceptances where contactId == …`. The
`identity_key` query is **mandatory, not optional** — the first draft called it
"a second, optional" index and that made the export quietly incomplete:

> One human routinely holds several contact ids here, because the guest match
> requires email **and** name (`booking/index.ts:815-831`). Anna books in March as
> "Anna Müller" and signs; in June a phone drops the umlaut, "Anna Muller" fails
> the name match, a second contact is created and she signs again. In September
> the studio exports *her* consent history from contact B and gets June only. The
> March version — the one she actually signed under — is absent from an artefact
> headed with her name.

But the two must never be merged, because `identity_key` is
`sha256(normalised email)` and the promo type's own docblock says it is *"not
unforgeable"* (`types/promoCode.ts:668-682`). **A shared family mailbox gives a
mother and her child the same key.** Over-inclusion is harmless for a redemption
cap and is a fabrication in a consent artefact. So the second query's rows are
printed in their own section, each carrying its `contactId`, `subject_name` and
`signer_role`, under a heading that says these are records **for this address**,
not for this person. §0.5(b) explains why this does not reopen the rejected
proposal to *key* the signer row on the identity.

**The storage decision behind "immutable snapshot", stated once.** Franco's
Decision 4 requires an immutable snapshot of the exact text accepted. The
acceptance row stores the **hash**; the one copy of the text lives in the
immutable version document; the export **materialises the full text** into the
artefact. That is a complete snapshot at every point that matters, at one copy of
the text instead of one per signer — and it is only sound because the version
document is genuinely unmodifiable and undeletable (W2, W3, W4). If any of those
three invariants is ever relaxed, this decision must be revisited in the same
change, and W4's docblock says so on the line.

Reads: two collection-group queries on `acceptances` plus the version documents
they reference. **Two indexes** (§9 P4-L), both on `acceptances` COLLECTION_GROUP:
`contactId ASC, accepted_at DESC` and `identity_key ASC, accepted_at DESC`. The
second is no longer "optional" — §12's index budget is amended to say two, with
the reason, rather than one plus a hedge.

The same callable, scoped to `request.auth.token.contactId`, backs the member's
own download from Space (§7.5) — a member should be able to take their own consent
history with them, and it is free once the callable exists. **The member's own
download omits the identity-key section**, because it would show them somebody
else's records: that section is an operator tool, and the export's scope parameter
carries the distinction.

### 5.4 Who checks the ledger, and what happens when a check fails

The finance journal this design takes as its precedent does not rely on discipline
alone: it has `assertFinanceInvariant`, a reconciliation check and
`scripts/backfill-finance-journal.ts` — a checker, an alarm and a repair path,
because *"append-only by convention over the Admin SDK"* is an intention, not an
enforcement. The first draft inherited the convention and none of the machinery:
W4's verification was "publish twice and diff", which tests one scenario rather
than the invariant, and §5.3 printed a hash mismatch and stopped.

**`scripts/verify-waiver-ledger.ts`** (P4-L), runnable per team or globally,
read-only, exit-code-bearing:

| Check | Why it can fail despite the rules |
|---|---|
| `body_hash === sha256(bodyHtml)` for every version | the Admin SDK bypasses `allow write: if false`; a migration or a console edit is the realistic cause |
| every `signers` row is backed by an `acceptances` event at the version it claims | a signer write that landed while its event create was skipped |
| every `acceptance_id` on a signer row exists and is `kind: 'accepted'` | the precedence rule applied against a row it should not have |
| every `required` policy entry matches its document's `current_version` / `min_valid_version` | W5's "always agree", actually checked (§1.5 runs the same converse on page load) |
| no document has `status: 'published' && current_version == null` | §2.1.1's backfill precondition, permanently |

**And the export names the repair path rather than only the fault.** A printed
mismatch now reads: *"The stored fingerprint does not match the stored text for
this version. The signature and its instant are unaffected; the text shown may
have been altered after signing. Run `verify-waiver-ledger` and consult the
version's `published_at` and `published_by_name`."* That is the difference between
an artefact that is honest and one that is unusable.

Run it **on a schedule for one document per team** — cheap, and it turns a silent
corruption into an alarm — or, if Franco prefers no scheduled entry at all (W13's
spirit), as a pre-release step. **§10 Q16** puts that choice.

---

## 6. De-gating Documents

### 6.1 Why it is a prerequisite, not a tidy-up

Uninstalling the Documents plugin **batch-deletes every public mirror for the
team** — `onInstalledPluginStatusChange.ts:63-65` →
`deleteAllDocumentPublicProfiles` (`utils/plugins.ts:85-104`) — and
`downgradeTeamToFree` flips every install to `'inactive'`, which fires the same
trigger. Under a waiver gate that means: downgrade a team, and the booking gate
points at content that no longer resolves while `signup_documents` empties in the
same beat. That is the structural reason
`docs/fareharbor-analysis.md:575-583` settled the de-gating, and it is why this
section lands **before** the gate does (§9.2).

Documents was never monetised — `minPlan: 'free'`, no `addon` field — so this
gives away no revenue. Deliberately **not** replaced by an "extended documents"
plugin: that was considered and rejected as confusing.

> **The draft added "and on Coach it frees the one-plugin explore slot". That
> mechanism does not exist and the clause is deleted.**
> `grep -rn "pluginInstallLimit\|installLimit\|explore slot"` across this repo
> hits only prose — this spec and `docs/fareharbor-analysis.md:688`, which hedged
> with "may free" where the draft hardened it into an assertion. There is no
> per-plan install count anywhere: Coach access is decided by
> `pluginAccessForPlan` (`packages/shared/src/types/plan.ts`) plus
> `firestore.rules:501`/`:504`'s `plan in ['studio','organization']` check. And by
> W-B5 a Coach team could never install Documents at all, so it occupied no slot
> to free. The de-gating rationale stands on W-B5 and W-B10 without it; leaving
> the clause in would invite a reader who checks it to distrust the parts that are
> load-bearing and true.

### 6.2 The edit census

The census owner is

```
grep -rn "requiresPlugin: 'documents'\|'documents'" \
  apps/web/src packages/functions/src packages/shared/src scripts \
  firestore.rules firestore.index.json
```

— regenerate it rather than trusting this list to be exhaustive. **The draft
searched only the first three roots**, which is how it missed both the
`teams/{teamId}/settings` rule that does not exist (W-B14, item 13) and three
`packages/shared` comments that still describe Documents as a plugin (item 14) —
the second being §8.1 shape 3 landing inside the section claiming to foreclose it.
As of `129a8c9` it covers:

| # | Site | Change |
|---|---|---|
| 1 | `apps/web/src/app/[locale]/(auth)/layout.tsx:209-215` | drop `requiresPlugin: 'documents'`; move `href` to `/documents` |
| 2 | `(auth)/plugins/documents/page.tsx` (not-installed wall) | delete the wall and its i18n keys |
| 3 | `apps/web/src/plugins/documents/manifest.ts` + `registry.ts:18,35` | delete the manifest and its registration, or it keeps appearing in the marketplace with an install button that means nothing |
| 4 | `syncTeamPublicProfile.ts:88-103` | `documentsActive` drops the plugin probe **and gains a mirror requirement** — see §6.3's Population B, where dropping the probe alone silently publishes a surface |
| 5 | `syncTeamPublicProfile.ts:106-131` | `signup_documents` stops reading `installed_plugins/documents.config` |
| 6 | **the config's new home** | `teams/{teamId}/settings/documents` (server-readable, owner-writable) — see §6.3 |
| 7 | `onInstalledPluginStatusChange.ts:63-65` | delete the `documents` arm; `deleteAllDocumentPublicProfiles` becomes dead and is deleted with it (W-B10 resolves) |
| 8 | `apps/web/src/hooks/usePublicSurfaces.ts` | `documentsActive` collapses into `documentsLive`; every consumer that branched on the pair follows |
| 9 | `(auth)/public-page/page.tsx` | "Manage" vs "Set up" collapses to the live flag |
| 10 | `scripts/seed-{emulator,sandbox,lead,staging}.ts` | stop writing `installed_plugins/documents`; write the new config location |
| 11 | `(auth)/settings/plugins/page.tsx` | the marketplace card disappears with the manifest |
| 12 | route move | add a redirect shim at `/plugins/documents` for bookmarked URLs, in the shape of the `bio-link` legacy segment already kept in `RESERVED_SLUGS` |
| 13 | **`firestore.rules`** | add the missing `match /settings/{settingId}` block inside `match /teams/{teamId}` (W-B14, §1.6). **Without it the config move's very first save fails with a permission error** — the loud version of the silent no-op-save window P4-C's atomicity exists to prevent |
| 14 | **`packages/shared/src/types/team.ts`** | three comments that survive the migration and would then be false: `:76-78` (*"documents plugin active"*), `:164` (*"documents plugin"*), and `:453-458`, which names `installed_plugins/documents.config` as the source of `signup_documents` — the exact location item 6 moves. `:453-458` is the type declaration of the field itself, so it is the first place a reader looks and the worst place to leave a stale mechanism |
| 15 | **public-page indexability** (D2's required consequence) | the public document pages emit `noindex` below a paid, active plan — see §6.5. Added because **§9 had no owner for it** while D2 says a work item must own it: `publicPagesIndexable` in `types/plan.ts`, `public_pages_indexable` on `TeamPublicProfile`, and a server `generateMetadata` on both public document routes |

The route move (1, 12) is the one discretionary item: a default feature living
under `/plugins/` reads as an oversight. §10 Q10 offers Franco the alternative of
leaving the path alone. Items 13 and 14 are not discretionary — 13 is a hard
prerequisite for item 6, and 14 is shape 3.

### 6.3 The migration, per population

**Population A — teams with `installed_plugins/documents.status === 'active'`.**
Today that can only be Studio/Org teams (W-B5), plus every trialing team (new
teams are provisioned `plan: 'studio'`, `plan_status: 'trial'`), plus every seeded
team. Their `signupDocumentIds` sits inside the document being retired.

**The dual-read window must land in the same commit as the write switch**, not
before it — the ordering `docs/fareharbor-analysis.md:592-595` flags, because the
proposed alternative has a silent no-op-save window. Concretely, one commit:
`ConfigPanel.tsx` reads *new ?? old* and writes *new*; `syncTeamPublicProfile`
reads *new ?? old*; a backfill copies old → new for every team. Splitting the read
and the write means a studio's save silently does nothing.

Both `active_public_surfaces.documents` and `signup_documents` are recomputed
wholesale on every sync run, so a deploy ordering where the sync reads the new
location before the backfill has run produces an **empty `signup_documents` for
the window** — the signup form silently losing its consent links. Run the backfill
before deploying the sync, or make the sync's dual read genuinely tolerant of
either shape. The latter is cheaper and is what P4-C does.

**Population B — teams that have NOT installed.** Every Free and Coach team (which
could not install — W-B5), any Studio/Org team that never clicked install, and any
team that was downgraded (the install flipped to `'inactive'`, the trigger deleted
their mirrors).

`docs/fareharbor-analysis.md:585-590` warns that these teams' surfaces would
**flip live** when the gate comes out. The mechanism is the inverse of the
warning's phrasing, and the phrasing matters because it changes what the
migration must do: `syncDocumentPublicProfile` is `onDocumentWritten`, and nothing
writes those documents, so removing the gate does **not** re-create their mirrors.
The practical outcome is that documents the studio believes are published are
**invisible** until each is touched. A backfill is therefore required — and **that
backfill is exactly what makes previously-dark content go live.**

So the migration is two scripts, deliberately:

1. **`scripts/audit-document-visibility.ts`** — read-only. Lists, per team, every
   document that is `published + isPublic + !archived` and has no
   `public_profile` mirror, alongside the team's plan, `plan_status` and its
   `installed_plugins/documents` status. This is the set that goes live.
2. **`scripts/backfill-document-mirrors.ts`** — **opt-in per team**, driven by the
   audit's output, with a typed confirmation against the cloud (the discipline
   `pnpm sandbox:reset` and `lead --reset` already use).

Downgraded teams are the sharp case: they published, were torn down, and a naive
backfill re-publishes content they may believe retired. The audit cannot always
distinguish "never had a mirror" from "had one, torn down by a downgrade" — the
teardown leaves no marker — so opt-in per team is the only honest posture.
Pre-launch this is seed data only, which is why it is cheap **now** and expensive
later.

**But the CONTENT being opt-in does not make the SURFACE opt-in, and the draft
assumed it did.** `documentsActive` (`syncTeamPublicProfile.ts:88-104`) is
currently `plugin active AND ≥1 published+public+non-archived document`. Drop the
plugin probe and the remaining test is a query over the **root `documents`
collection** — which no teardown ever touched. `deleteAllDocumentPublicProfiles`
(`utils/plugins.ts:85-104`) deletes only the `public_profile` subdocs. So:

> A team trialed on Studio, published three documents, lapsed and was downgraded.
> `downgradeTeamToFree` flipped the install to `'inactive'`,
> `onInstalledPluginStatusChange.ts:63-65` deleted all three mirrors, and
> `documentsActive` went false. After P4-C deploys, **the next write to their team
> document for any unrelated reason** recomputes `documents: true` —
> `touchTeamForSurfaceRecompute` fires on plenty of them.
> `public-page/page.tsx:212-216` then shows Documents as a live public surface
> with a working preview URL, and `:140` offers it as a selectable **default
> landing surface** for `/public/{slug}` — pointing at a page that renders the
> empty state, because no mirror exists and the backfill is opt-in and has not
> been run for them.

A studio advertising an empty public page it did not choose to publish is a worse
outcome than dark content. So:

> **`documentsActive` requires a MIRROR, not a document.** The probe becomes a
> `limit(1)` query on the `public_profile` collection group scoped to the team —
> the same shape and cost as the current document query, over the collection that
> actually backs the page. The surface then stays dark until the backfill runs,
> which is exactly what "opt-in per team" was supposed to mean, and it makes the
> flag agree with what a visitor would see.

Two consequences worth stating: the existing `documents` composite index
(`firestore.index.json:142-162`) is no longer needed for this probe (it stays,
other readers use it), and a team whose backfill *has* run gets the surface in the
same sync — one decision, one moment, no drift. **No index is added**: the probe
is the exact `teamId + type == 'document'` collection-group query the public
documents index page already runs.

**Population C — a team that downgrades AFTER this ships, with a required waiver
live.** This is the case the whole de-gating exists for, and it is worth walking
because it crosses §6 and §6.4:

- `downgradeTeamToFree` flips every install to `'inactive'`. The
  `onInstalledPluginStatusChange` documents arm **is gone**, so nothing deletes
  their document mirrors. The waiver's public copy, the signup consent links and
  the Documents surface all survive the plan change.
- The gate keeps blocking, visitors keep signing, guardians keep signing, and the
  requirement can still be turned **off** and the waiver archived — §6.4's table,
  in both directions. What stops is authoring: new waivers, text edits, new
  versions, and turning a requirement **on**.
- The only thing that changes on the public side is **indexability** (§6.5): the
  team's public document pages start emitting `noindex` at the next sync. The
  pages keep working, and every link and QR code already in circulation keeps
  resolving. Nothing is withdrawn — which is exactly the property that let D2
  de-gate completely.

### 6.4 Plan tier, and what must not break

`WAIVER_MIN_PLAN = 'studio'`, mirrored client and server, in the shape Phase 3
established:

- **Server**: `requirePlan(teamId, 'studio')` is called by the waiver
  creation/publish path and by **`setWaiverRequirement` when, and only when,
  `required` is being turned ON** — and by nothing else. Signing, resolving,
  revoking, reporting and exporting call it never. The discipline is
  `connect/promoCodes.ts:2283-2285`'s.

  > **The asymmetry is the point, and the draft left it out.** The draft made
  > `setWaiverRequirement` wholly ungated on the reasoning that "gates control
  > creation only", and enumerated only turning a requirement **off** as the
  > thing that must survive a downgrade. But turning one **on** is the switch that
  > converts a published document into a gate on every booking. A studio could
  > subscribe for one month, create a waiver, publish v1, leave `required` off
  > (§1.7's ship-dark default), cancel to Free, and then call
  > `setWaiverRequirement({ required: true })` — nothing would refuse it, no new
  > object is created, and a fully working Studio-tier feature runs indefinitely
  > on Free. So: **`required: true` calls `requirePlan`; `required: false`,
  > `updateWaiver`'s settings edits and `archiveWaiver` never do**, because a team
  > must always be able to stop gating its own bookings.
- **Client**: one exported constant, `isAtLeast(WAIVER_MIN_PLAN)`, and the create
  dialog's waiver option is **visible and locked** with the upsell modal — the
  promo nav entry's reasoning (`layout.tsx:182-187`: hiding a lever teaches
  nobody it exists), not the plugin wall's.
- **Stored values are carried through untouched below the tier.** The rule
  `apps/web/src/app/[locale]/(auth)/offer/activities/page.tsx:485-486` states for
  the waitlist toggle (`WAITLIST_MIN_PLAN` at `:34`, the disabled control at
  `:751-758`) applies verbatim: a gate stops a waiver being **created**, it does
  not quietly strip one a team already had.

**Gates control creation only**, and the consequences are enumerated because each
is a thing someone will otherwise get wrong. On a team downgraded to Free with a
live required waiver:

| Operation | Still works? |
|---|---|
| The gate blocks a booking | **yes** — a required waiver survives a downgrade |
| A visitor signs it | **yes** |
| A guardian link is minted, sent and used | **yes** |
| The notice report and the export | **yes** |
| Revoking an acceptance | **yes** |
| Turning the requirement **off**, or archiving the waiver | **yes** — retiring is not creating, and a team must always be able to stop gating its own bookings |
| Editing a waiver's settings (`guardianRequired`, `validityMonths`, `scope`) | **yes** — `updateWaiver`'s settings arm is ungated for the same reason |
| Editing a waiver's **text** | **no** — `plan_required`. Text edits are authoring |
| Turning the requirement **on** | **no** — `plan_required`. It is the switch that makes a document a gate |
| Publishing a new version of a waiver | **no** — `plan_required` |
| Creating a new waiver | **no** — `plan_required` |

The two refusals are reachable only from the admin surface, never from a public
one, so a visitor never sees `requirePlan`'s English billing prose. That is the
condition `utils/plan.ts:10-17` sets for adding a caller.

### 6.5 Indexability — D2's required consequence, and the half that is easy to miss

De-gating completely hands **every** signup a public publishing surface on a
Linyup domain: sign up, publish keyword pages, borrow the domain's standing. The
mitigation gates **indexability, not existence** — the page renders identically
for everyone and is shareable by link and QR; it carries `noindex` until somebody
is paying. Nothing has to be withdrawn later, which is the property that made
D2 safe to choose.

**A TRIAL IS NOT A PAID TIER, and keying on the plan alone would leave the
vector wide open.** Self-service signups are provisioned `plan: 'studio',
plan_status: 'trial'` (`types/plan.ts` `TRIAL_DAYS`), so "any paid tier" read as
`plan !== 'free'` would grant indexable pages to every throwaway account for 30
days — and a page only has to be crawled once. The predicate therefore requires
`plan_status === 'active'` as well, and refuses `expired` explicitly because a
lapsed trial reports its stored plan until the nightly cron rewrites it:

```ts
publicPagesIndexable({ plan, plan_status })   // packages/shared/src/types/plan.ts
```

Three implementation facts, each of which is a way to build this and have it not
work:

1. **The flag is denormalised onto `TeamPublicProfile.public_pages_indexable`**,
   computed by `syncTeamPublicProfile`. The pages that need it read
   `public_profile` alone and must not read the private team document. It is
   deliberately **not** `showBranding` reused: that flag asks "is this the free
   tier", and would answer "indexable" for a trial.
2. **It fails CLOSED to `false`.** Every mirror written before the flag existed —
   and any team whose sync has not re-run — reads as not-indexable. The wrong
   direction is the expensive one: a spam page that got crawled cannot be
   un-crawled, while the repair is a single team write.
3. **The tag is emitted by `generateMetadata` on a SERVER page**, which is why
   both public document routes became a server shell around their existing
   client component. A robots tag written by client JavaScript is not a
   mechanism. The read is Firestore **REST**, not the web SDK, for the reason
   `site/page.tsx` already records: inside the Next server runtime the SDK's
   streamed query responses come back empty, so a metadata read would silently
   behave as if the team did not exist — and "we could not tell" must not read as
   "indexable".

---

## 7. Surfaces

### 7.1 Admin — authoring

The Documents page gains a `kind` filter including `waiver`, and the create dialog
offers Waiver as a kind — **visible and locked below Studio** (§6.4). Choosing it
routes creation through `createWaiver` (callable) rather than the client
`addDoc`, which is what carries the plan gate, the cap and the callable-only rules
(§1.6).

The waiver detail page is the document editor plus three additions:

- a **waiver settings** block: `guardianRequired` (three radio options, each with
  its consequence in one line), `validityMonths`, `scope` (all bookings / selected
  activities), and the **Required** switch — off by default, with the sentence
  *"Until this is on, nobody is asked to sign it."*;
- a **version history** list: version, published instant, who, outcome, and a
  "view text" link. Read-only, forever. **The outcome cell of any `notify`
  publish is a link to that version's notice report**, and a `backfilled_at`
  version is labelled as retroactive (§2.1.1);
- a **signers** tab: the roster of acceptance states and §5.2's standing
  evidence-quality line.

> **CORRECTION, D1: the notice report, its version selector and the
> outcome-cell links are NOT part of this phase.** All three exist only to read
> the `notify` outcome, which is deferred to v2 — `getWaiverNoticeReport` has no
> implementation, and a version selector over reports that do not exist is a
> control with nothing behind it. The paragraph that called them "not polish"
> was written before D1 and is correct **about notify**; it returns with notify.
> The half that does NOT depend on notify is the standing evidence line, and it
> shipped: `WaiverSigners.tsx` computes it from each signer's `accepted_version`
> against every later `silent` version, which is the only place in the product
> that answers *"how good is my evidence right now"*. Its second clause ("…and 4
> of those notices did not arrive") is absent rather than shown as zero — a
> count of notices nothing sends is a false reassurance, not a placeholder.

> **CORRECTION, found while implementing: the document editor's STATUS controls
> are wrong for a waiver, and the spec never noticed.** Unpublish, Restore and
> Delete all write `status` or delete the document, and §1.6's rules deny both
> on `kind: 'waiver'` while **none of the five callables writes `status` at
> all**. Offering them would be three live controls that always error. So on a
> waiver they are not rendered, and each has a replacement that already exists:
> stop asking = turn **Required** off (which removes the policy entry in the
> same transaction, where unpublishing would leave the gate pointing at text
> nobody can serve — the one state `waiver_unavailable` refuses); retire =
> **archive**; delete = nothing, deliberately, because the text may be somebody's
> evidence. An archived waiver is **terminal**, and the editor says so: a
> re-opened document would claim a continuity the ledger cannot support.
> The `isPublic` toggle is hidden for the same class of reason — §1.3 withdrew
> the mirror widening for waivers, so a waiver's public page is not how its text
> is served.

The activity form does **not** grow a waiver picker. Scope lives on the waiver so
"which waivers does this booking need" is one filter over one list (§1.3). The
activity form gains a read-only line naming any waiver that applies to it, so a
coach setting up a class sees the gate rather than discovering it.

### 7.2 Admin — the publish chooser

The single most important screen in this phase, because it is where Decision 5's
evidential trade is actually made.

**AS SHIPPED — TWO OUTCOMES (§10 D1).** The `notify` option is not offered, and
is deliberately not offered *disabled* either: a greyed-out control that never
becomes available is worse than one that does not exist.

```
Publish "Liability release"                                  version 4

  ( ) Silent update
      Existing signatures stay attached to the old wording. Nobody is told
      the text changed.
      Evidence: a signature on file may be a tick against wording that no
      longer exists.

  (•) Require re-signing                                      recommended
      Everyone must tick again before their next booking.
      Evidence: strongest — every valid signature matches the text people
      actually read. Most friction.

  ⓘ A tick in a checkbox is the lightest signature there is. For a liability
     release that counts for less than it does for terms of service, which can
     lean on continued use: a risk you add here was never put in front of
     anyone who signed the previous version. If this change touches the risks
     or the release language, require re-signing. This is not legal advice.

  ⚠ This text contains an image. Only the text is frozen with the version —
     replacing the image file later changes what people read.
```

Rules for this control:
- named by **what happens**, never by severity;
- each option carries its evidential cost in one line, **beside the choice** —
  the trade is stated when a studio can still act on it, not when it needs the
  document;
- the default is `require_resign` for waivers and `silent` for every other kind
  (§10 Q3);
- the image warning appears only when the body contains an `<img>` (§5.2);
- the `external_link` warning replaces it when the source is a URL;
- on a **first** version the chooser is still shown (uniform, and testable), with
  one line saying that nobody has signed anything yet so the choice has no effect
  today;
- every server refusal is mapped to a translated string. `publishDocumentVersion`
  refuses an empty body, an invalid external URL, an archived document, the
  version cap, a concurrent publish and the plan gate by name, and a studio that
  is told only "could not publish" will not find the empty body.

**Publishing writes the stored draft first, unconditionally.** The snapshot is
frozen from the body the SERVER holds, so publishing what is on screen means
storing it beforehand — otherwise a studio edits the risk clause, publishes, and
freezes the previous wording under the new version number. The alternative
(refuse to publish while the editor is dirty) was rejected: a rich-text editor
that re-serialises its own input on mount leaves the button permanently dead.

### 7.3 The consent step on every public surface

**`/public/{slug}/booking` — `BookingForm.tsx`.** The step machine
(`:144-156`) gains `'waiver'`. **The critical structural finding**: there are
three terminal submit paths and only one passes through `details`.
`nextStepAfterSession` (`:223-227`) routes a gated class with no guest door to
`'returning'`, and `onVerified` (`:1067-1112`) then calls `bookSession`
**directly** — a member on a gated class never sees `details`. So the waiver step
cannot be a block inside `details`; it must be **a step of its own, immediately
before submit on every path**:

- guest free → `who` → `details` → **`waiver`** → submit
- guest paid → `who` → `details` → **`waiver`** → checkout
- returning member → `returning` → **`waiver`** → submit (interposed where
  `onVerified` books today)
- queue join → unchanged; no waiver (§3.4)

Wiring, each item a place the step is silently dropped if missed:
`showConfirm` (`:1371`) must include it or the step renders with no submit
control; `stepQuery` and the restore switch must know it; and it must be
**non-terminal**, unlike `confirmed`/`waitlisted`, so Back into it is safe. The
booking-questions block (`:1416-1441`) is the shape to follow — it already renders
above the identity form on two steps for the stated reason that the sticky Confirm
must submit last.

The static consent sentence at `:2176-2178` (`PublicBooking.consentText`) stays
where it is; it is a data-use notice, not a waiver, and conflating them would make
both weaker.

**`/public/{slug}/appointments` — `AppointmentPicker.tsx`. This rail has THREE
terminal submits too, and the draft allocated it one sentence.** The file declares
`type BookScreen = 'guest' | 'signIn' | 'memberPay' | 'autobooking'` (`:90`) and
submits from three independent places:

- `onSubmitGuest` (`:374` → `book()` at `:385`) — has a form, has a seam;
- `onMemberPay` (`:502` → `book()` at `:537`) — has a CTA, has a seam;
- `onVerifiedAppointment` (`:428`) → **`autobooking`**, which calls `book()` at
  `:456` **automatically the instant a covered member's code verifies**, rendering
  only a spinner with no confirm control at all (`:569-575`).

The third is the exact analogue of `BookingForm.tsx`'s `onVerified`, which this
spec correctly singles out as "the item most likely to be missed" — and there is
**no seam "between the guest form and the call"** on it, because there is no form.
Left as drafted, the consequence is not a missing step but a lockout:

> `resolveAppointmentCaller` marks the verification code `used: true` at
> `appointments/booking.ts:258-262` **before** any gate. `bookAppointment` then
> refuses `waiver_required`; the refusal falls through `AppointmentPicker.tsx:477`
> into `else { throw new Error(t('errorGeneric')) }` — "something went wrong", no
> waiver text, no way forward. Retrying needs a new code, and
> `sendBookingVerificationCode` allows 3 per email+team per hour
> (`booking/index.ts:116`). The member cannot book for the hour.

So the `autobooking` screen becomes **verified → waiver step → book**, not
verified → spinner → book, and all three paths are named individually in P4-M's
verify list. The sticky Confirm condition must learn the new screen.

**And the same exercise is mechanical, not a matter of trust, for every surface in
P4-M**: count the terminal submits **per file** rather than accepting one sentence
per surface. `waitlist/page.tsx`, `WalkIn.tsx` and `SignupForm.tsx` each get the
same treatment in P4-M's verify list.

**Waitlist claim — `/public/{slug}/waitlist?token=…`.** A third render branch
beside `claimed` and `payment`, inside the existing claim window, adding no timer
(§3.4). Collected once and carried across the payable hop.

> **CORRECTION, found while implementing: the claim page could not resolve the
> requirement at all, and the failure was silent in the dangerous direction.**
> `getWaitlistEntry` returned neither the session's `activityId` nor the
> claimant's own `lastname`/`email`. Without the activity,
> `resolveWaiverRequirement` is called with `activityId: null`, which
> deliberately **excludes** an `activities`-scoped waiver rather than widening it
> (§1.3) — so the page would have shown nothing while the claim's own gate, which
> reads the activity off the session document, enforced it. The queued member
> would have spent their one and only offer on a document they were never shown,
> which is precisely the outcome §0.5(e) rejects. Without the name and address,
> the caller resolves conservatively for nobody, so a member who signed last year
> is asked again and an `if_minor` age can never be resolved. All three are now
> returned by `getWaitlistEntry` — they are the holder's OWN data, returned to
> the holder of their own link, and the page already rendered `firstname`.
>
> The claim page also skips `ensure()` entirely on its second pass. A guardian
> arm is never locally "ready" — nobody at that keyboard can complete it — so
> re-entering the resolution would loop on the one rail whose whole design is
> that a guardian requirement does not block. `waiverDeferredReady` is the
> Confirm's condition there and nowhere else: self-signing is still required,
> because deferral is guardian-only or coverage would depend on which rail
> somebody arrived on.

**Kiosk — `WalkIn.tsx`.** Inline, scrollable, one checkbox (§3.7), with §10 Q4's
answer deciding what happens when the walk-in is a minor.

> **CORRECTION: Q4's answer ("admit with the chip") had NO OWNER, and could not
> be implemented on the surface alone.** The kiosk is listed as INHERITING the
> gate — it calls `bookSession` like any guest — and `bookSession` passed
> `guardianPolicy: 'refuse'` on every source. So a walk-in minor was **refused at
> the door**, which is the opposite of the decision, and no work item covered it:
> P4-M owns the surface, P4-G owned the rail and neither carried Q4.
>
> `bookSession` now selects `guardianPolicy` from `parseBookingSource(data.source)
> === 'kiosk'` — from the SOURCE and never from a client flag, or any caller could
> opt out of the gate — and mints the deferred link after the commit through the
> same `mintDeferredGuardianLinks` the claim rail uses. The tablet collects the
> parent's address in the step; with none given nothing is sent and the roster
> chip carries it, exactly as on the claim rail, and for the same reason: mailing
> a child's own mailbox a "a parent must sign" link would stamp `emailed_link` —
> a claim of GUARDIAN mailbox control — on an address that is demonstrably the
> subject's.
>
> **These are now the ONLY two rails that defer**, and
> `waivers/surfaces.test.ts` asserts that against the source of every other.

**What the step looks like at the cap, which nobody has costed.**
`MAX_REQUIRED_WAIVERS_PER_TEAM` is 3 and `MAX_WAIVER_BODY_CHARS` is 50000, so the
worst case this step must survive is **three 50k-character documents rendered on a
phone between "details" and "confirm"**. The gate's *read* cost is bounded and
stated (§1.5); the *reader's* is not, and "a step of its own" does not say whether
that is one scroll-and-tick or a sub-flow with its own progress. Build it for
**one** — additional waivers render as sequential sub-steps with a "1 of 3"
affordance — and see §10 Q18 on whether three required waivers is a coherent
product at all.

**Signup — `SignupForm.tsx`.** The existing checkbox (`:471-505`) keeps covering
terms and privacy, now with real versions; a waiver among the signup documents
gets its own step with its own tick, because bundling a liability release into a
list of links beside a privacy policy is the weakest possible presentation of the
strongest possible document.

**Shop — no waiver.** Buying a membership, a product, a course or a gift card is
not attendance. A membership purchase implies future attendance, and the waiver is
taken at the first booking, where it belongs. Recorded in §11 so the omission is a
decision.

**`/public/{slug}/waiver?doc=&token=`** — the guardian signing page (§4.3 step 4).
New route: add to `PublicRoutable`, `PublicRouteParams` and `RESERVED_SLUGS`
(P4-A), alongside W-B9's four missing segments.

### 7.4 Roster and manifest

**The chip.** Four states from the one predicate, rendered as a tri-state in the
`showsNoSubBadge` shape (`sessions/[id]/page.tsx:528-531`) — note its deliberate
`=== false`, so *unknown* renders nothing rather than a false accusation:

| State | Chip |
|---|---|
| `valid` | nothing |
| `none` | **Waiver** (amber) |
| `superseded` / `expired` | **Waiver ·** (amber, with a tooltip naming which) |
| `revoked` | **Waiver** (red) |
| unknown (we cannot see this contact) | nothing |

**The manifest constrains its form.** `globals.css:374-379` forces
`.manifest-session` backgrounds transparent, and most browsers drop background
graphics by default, so **a coloured pill prints as invisible text**. The chip
must be legible from its glyph and text — the existing tick box solves the same
problem with `bg-foreground print:bg-transparent` so the *border* carries the
meaning. An extra per-row line is cheap (the answers pattern at
`manifest/page.tsx:290-294`); an extra column is not, at 14mm margins. Place the
chip immediately after the `unpaid` chip (`:279-281`), which is the exact template:
one word, colour-coded, `shrink-0`, read off data already loaded.

**Do not copy `rosterContactsQ` wholesale.** It fetches the whole active contact
list and is `enabled` only when the activity is gated
(`sessions/[id]/page.tsx:502`). A waiver chip is wanted on **every** session, so
that shape becomes a full-contacts read per page view. Instead **denormalise the
waiver state onto the booking at write time** — `booking.waiver_state`, written by
the same transaction that writes the acceptance, in the shape
`question_answers` and `subscription_type_id` already take. The manifest's own
comment (`manifest/page.tsx:63-71`) records this trade-off and lands on the same
side: mirror what the sheet needs at write time rather than joining at read time.

> **AS SHIPPED, and the two halves are not the same shape.** `Booking.waiver_state`
> has only two values (`ok` / `outstanding`, plus ABSENT), so a roster row on the
> printed sheet can say "a waiver was outstanding when this seat was taken" and
> nothing finer — which is exactly what a sheet describing the booking as taken
> should say. The FOUR-state chip needs the signer rows, and the two surfaces that
> read them are the live session page (every roster member, so a revocation since
> booking is visible to a coach at the door) and the sheet's `walkIns` list (the
> rows that have no booking document at all). Both go through
> `useWaiverRoster`, which lists by document id — a `getDoc` on a MISSING signer
> row comes back permission-denied rather than not-found, because `resource` is
> null in the rules and `resource.data.teamId` errors, and a missing row is the
> common case. That form needs no index, which is why none was added for it.

The denormalised value is a **snapshot at booking time**, so a later revocation or
a `require_resign` publish does not retroactively update a printed sheet. That is
correct for the manifest (it describes the booking as taken) and wrong for the
live session page, which therefore also consults the signer rows for the
currently-listed contacts — a bounded read, one `get` per roster member per
required waiver, and only when the team has any. State both, because "why does the
sheet say signed and the screen say expired" is otherwise a support ticket.

**Rows with no booking need the chip most, and `booking.waiver_state` cannot
reach them.** The manifest renders participants-without-bookings in a separate
`walkIns` list (`manifest/page.tsx:299+`, fed by `useDaySheet.ts:127-137`), and
those rows carry no booking document — so the denormalised field does not exist
for exactly the people who arrived outside a booking flow. Two populations land
there: a staff-added participant (§3.8, deliberately never gated) and a
`selfCheckIn` scan (§3.10 — now gated, but a pre-existing participant row from
before the gate, or a staff add, still shows up).

> Left as drafted, the printed sheet shows no chip for the one person on it whose
> waiver nobody ever collected.

So `walkIns` rows and the session page's participant rows read their state from
the **signer rows** — the bounded per-roster-member read the live page already
performs — rather than from a booking field that is not there. P4-N owns it.

### 7.5 Space — the member's own view

> **CORRECTION, found while implementing: "Review and sign" had nothing to call.**
> §9's P4-O lists two component files and no callable, and no other work item
> owns one — the gate is composed into the BOOKING rails, and every one of them
> refuses rather than records when a signature is missing. So the action as
> specified could only have linked a member into a booking flow they may have no
> reason to enter, and a `require_resign` publish would still have announced
> itself by refusing a booking: a compliance feature choosing the worst possible
> moment to introduce itself, to somebody doing nothing wrong.
>
> **`signWaiverInSpace` (`packages/functions/src/waivers/space.ts`)** closes it. It
> is deliberately **outside `waivers/gate.ts`'s census**: that census enumerates
> every site that PUTS A PERSON IN A ROOM, and this one books nothing, admits
> nobody and refuses no attendance — listing it beside the rails would misdescribe
> both, and a census whose members are not all the same kind of thing stops being
> checkable. It still has exactly one answer to "does this tick count", because it
> composes the same pieces: `loadWaiverPolicy`, `resolveWaiverSubmissions`,
> `decideWaiverGate` and `recordWaiverEvents`. The census names it, with that
> reasoning, so a reader who finds it has the reason beside it.
>
> Two limits it states rather than implies. It resolves with **no activity**, so
> it covers the waivers scoped to every booking; an `activities`-scoped one is
> presented at the booking step, where the activity is known — and the panel says
> so, because a banner that claimed to be complete and was not would be worse
> than no banner. And a **guardian requirement refuses** here exactly as on the
> rails: a member cannot tick past one for themselves, and the callable must not
> invent a signature it could not have taken.

- **`SpaceHome.tsx`** — a banner above the existing cards when any required waiver
  is not `valid`, with a "Review and sign" action. This is where a
  `require_resign` publish becomes visible to a member who is not currently
  booking.
- **`AccountHome.tsx`** — a "Signed documents" card: per document, the version, the
  date, who signed (self / guardian), and the current state; plus **Download my
  consent history** (§5.3, scoped to the caller). `AccountHome` already reads and
  edits `contact.birthdate`, and it must **not** grow a second date-of-birth
  prompt — Decision 6's "and nowhere else in the product" is a constraint on this
  file specifically.
- **No fifth nav tab.** `SpacePortalNav` is four items in a pill row and a fifth
  breaks the mobile layout.

### 7.6 i18n

Conventions are CLAUDE.md's and are enforced by practice: `en.json` first, the
same key added to all four locales immediately, `useTranslations('Namespace')`,
namespaces split by **surface** rather than by feature. Phase 3's split is the
model: `PromoCodes` (the admin page) versus `Promo` (the public widget, one key
per server refusal reason).

Phase 4 follows it:

- **`Waivers`** — the admin surface: the waiver settings block, the publish
  chooser with its three evidential-cost lines, the version history, the signers
  report with its four buckets and their explanations, and its version selector.
- **`Waiver`** — the public surface: the step scaffolding, the checkbox label, the
  date-of-birth ask **with its stated reason**, the guardian branch and its
  states, and **one key per `details.reason` in §3.5**.
- In-place additions to `Documents` (`kind_waiver`, and the publish flow replacing
  the status switch), `PublicBooking` (the new step), `Appointments`, `Waitlist`,
  `Space`, `Manifest`, `SessionDetail`, `Nav`.
- Guardian-link email copy lives in
  `packages/functions/src/booking/templates.ts`'s family with its four-language
  `Lang` union, **not** in `messages/*.json`.

The census owner for key sets is the lockstep check in W25, not a number in this
prose. For sizing only: Phase 3 added roughly 120 `en.json` lines and Phase 2
roughly 100; Phase 4 spans more surfaces than either.

> **AS SHIPPED, the lockstep check is EXECUTABLE, not a grep somebody runs once
> at the end of a phase.** `packages/functions/src/waivers/waiverReasons.test.ts`
> spans the functions/web boundary — the same move `connect/commitSites.test.ts`
> makes, for the same reason: that boundary is where corrections stop travelling.
> It asserts, from the SOURCE rather than from a maintained list:
>
> - every `waiver_*` reason raised under `packages/functions/src/waivers/` appears
>   in the client's `WAIVER_REFUSAL_REASONS` — so a new refusal cannot reach a
>   visitor with no translated sentence;
> - the only MAPPED reason the server does not raise is
>   `waiver_guardian_pending`, asserted as an exact set with the reason recorded,
>   because a second unraised reason is how a table stops describing the system;
> - every mapped reason has a **non-empty** string in all four locales;
> - the capped refusal interpolates `{resetAt}` in every locale and its fallback
>   does not (a missing interpolation value throws at exactly the wrong moment);
> - identical key **sets** per namespace AND across the whole file — the second is
>   what catches a key that landed one namespace over, which is the failure this
>   repo has actually had, because several namespaces share key names and a naive
>   anchor lands in the wrong one;
> - no `Waiver`/`Waivers` string over 25 characters is byte-identical to the
>   English, because a studio in Ticino reading English liability copy is a worse
>   failure than a missing key: nothing errors.
>
> The earlier form of the `lib/waiver.ts` comment claimed this file already
> existed. It did not — shape 3, in the file whose whole job is to make refusals
> legible. It exists now.

---

## 8. Invariants

### 8.1 The Phase-2 and Phase-3 failure shapes, and how this design forecloses each

**Shape 1 — a predicate whose boundary cases were reasoned about one shape at a
time.** The equivalent here is *does this signature count*: (never signed × below
the floor × past its validity × revoked × wrong version × wrong hash). Foreclosed
three ways: (a) **one pure function**, `waiverAcceptanceState`, with a fixed
decision order, called by the gate, the public callable, the roster, the manifest,
Space, the report and the export; (b) supersession and expiry are **never stored**,
so there is no stored value to disagree with the computed one; (c) the fixture
block is a **matrix** — every state × every publish outcome × every guardian
setting — not a list of anecdotes (P4-B).

**Shape 2 — a counter adjusted repeatedly because a predicate was reasoned about
one shape at a time.** There is **no counter**. `WaiverSignerState.rounds` is the
only number, it has exactly one writer (the acceptance transaction), it is written
absolutely from that transaction's own read set, and **no `FieldValue.increment`
touches it anywhere**. A `require_resign` publish, which is the obvious place a
second writer would appear, writes no signer rows at all (§2.2(a)).

**Shape 3 — comments asserting preconditions the code did not establish.** Three
live instances are fixed here rather than inherited: `document.ts:62`'s
"consent version stamp" (W-B4), `completeSignup.ts:165-167`'s advisory record that
the client fills with `''` (W-B3), and the two stale gift-card hold-key comments
Phase 3 already corrected. The forward rule, unchanged from Phase 3: **every
precondition comment names the line that establishes it**, and every "must happen
before X" comment sits next to the ordering that enforces it. §5.3's storage
argument carries its own tripwire: the docblock on `DocumentVersion` names the
three invariants it depends on.

**Shape 4 — a notification layer specified but never built.** This phase has one
and it is the feature's evidential core, so it cannot be foreclosed by specifying
none. It is foreclosed by **⚛ ATOMIC GROUP C**: the send and the read-back land in
one commit, because a notice whose deliverability nothing can read is the
"decorative" outcome Decision 5 rejects by name. W23 is its falsifiable form.

**Shape 5 (Phase 3's own, and this phase's likeliest) — incomplete enumeration: a
fix applied to the sites a report NAMED rather than every site that EXISTS.**
Phase 3 paid three rounds for it. Foreclosed by naming a **census owner** — a
command, not a number — for every enumerable set in this document: the booking
entry points (§3.2), **the attendance writes that are not bookings (§3.10)**, the
de-gating edit sites (§6.2), the public route segments (§7.3), the i18n key sets
(§7.6), the resolver call sites (untouched: `git diff` on `paymentOptions.ts` is
empty). **No count appears in prose anywhere in this spec**, per CLAUDE.md's
convention, and W24 makes that checkable.

**Two of those census owners were themselves wrong in the first draft, which is
the shape reproducing itself one level up**, and both are corrected rather than
patched around:

- §3.2's greped the **callable names it already believed in**. A list of names you
  trust cannot discover the name you forgot, and it did not: `selfCheckIn` writes
  `participants` with no booking and was invisible to it. The owner now greps the
  **write sites** (§3.2), and §3.10 decides every hit.
- §6.2's searched three roots and omitted `packages/shared` and `firestore.rules`
  — which is how a missing security rule (W-B14) and three stale plugin comments
  in the file a reader trusts most (`team.ts:453-458`, the declaration of the
  field being moved) both survived a census whose whole job was to find them.

**The lesson, stated so the next phase inherits it rather than re-deriving it: a
census owner must search where the thing could be, not where you last saw it.**

### 8.2 The invariants (W-series)

**W1 — a signature is never reserved.** No waiver code path writes a hold, a
reservation, an expiry-of-a-hold or a release. Falsifiable by grep:
`packages/functions/src/waivers/` contains no `reserve`, `release`, `hold` or
`_count` identifier.

**W2 — a published document cannot be deleted.** `firestore.rules` denies delete
on `documents/{id}` when `current_version != null`, from every role including
owner. Verified in the rules emulator.

**W3 — a waiver document is callable-only.** `firestore.rules` denies client
create, update and delete where `kind == 'waiver'` (before or after), including
from a manager and an owner. `current_version` and `min_valid_version` are
unwritable by any client on any kind.

**W4 — a version is immutable.** `documents/{d}/versions/{v}` is
`allow write: if false`, is written exactly once by `publishDocumentVersion` with
`.create()`, and no callable ever updates one. `body_hash === sha256(bodyHtml)`
for every version, checkable by a script.

**W5 — one WRITE PATH to the policy, and it is a function, not a callable
list.** `teams/{t}/waiver_policy/current` is never written by a client
(`firestore.rules` denies it) and, on the server, is written **only through
`writePolicyAndTouchTeam`** in `packages/functions/src/waivers/publish.ts` —
which is the census owner. That helper is the single `tx.set` on the policy ref,
and it exists so the team touch (which keeps `TeamPublicProfile.required_waivers`
fresh) cannot be forgotten at a new call site. Every caller is inside the same
transaction as the document write that motivates it, and every one patches
exactly one entry through `patchedPolicy`. Its `required` entries and the
corresponding documents' `current_version` / `min_valid_version` always agree.

> **The draft said "only by `publishDocumentVersion` and `setWaiverRequirement`",
> which was already wrong when written**: `updateWaiver`'s settings arm and
> `archiveWaiver` write it too, and a title edit now does as well (W-fix, this
> round). That is exactly the count-shaped claim §8.2 is supposed to be free of —
> naming a helper instead makes the claim survive the next writer, because the
> next writer has to call it.

**W6 — authorization never reads the display mirror.** The gate and
`resolveWaiverRequirement` read `teams/{t}/waiver_policy/current`.
`TeamPublicProfile.required_waivers` is read by the client for rendering only.
Falsifiable by grep: no function under `packages/functions/src` reads
`required_waivers`.

**W7 — the gate refuses before any contact write.** On every rail in §3.2's table,
a `waiver_required` refusal leaves no contact created, no funnel stamp, no
`trial_used_at` burned and no acceptance recorded. On `createDropInCheckout`
specifically the check sits **above** `db.collection('contacts').doc()`, and
above the gift-card drawdown, the promo reservation and the Stripe call — earlier
than every other gate on that callable. Asserted by ORDERING, not by line
number: `gate.test.ts` → "RULE 1 — the gate refuses ABOVE the first contact
write" compares the offsets in the source, so the check survives every edit that
moves the code.

**W8 — the acceptance is atomic with the booking, on the free rails; and the
signer row is transactional and conditional on EVERY rail.** On `bookSession`,
`bookAppointment` and `claimWaitlistSeat` the acceptance event and the signer row
are written **inside** the same transaction that commits the seat, and neither can
exist without the other. On the paid rails the acceptance is written before Stripe
in **its own** transaction. **No signer row is ever written by an unconditional
`.set()`, on any rail**: every write re-reads the row inside the transaction and
applies §1.4.1's precedence rule. Falsifiable by grep — every `signers/` write in
`packages/functions/src/waivers/accept.ts` is a `tx.set` and there is exactly one.

**W9 — the public answer and the gate's answer agree, for the same person.**
`resolveWaiverRequirement` resolves the caller through the **same email+name
helper** the rails use — `matchGuestContact`, extracted to
`packages/functions/src/booking/guestContactMatch.ts` and imported by
`bookSession`, `createDropInCheckout` and `waivers/caller.ts` — not by email
alone, so for the same caller at the same instant it reports exactly the state
the gate computes. (Named rather than cited by line: the extraction is the
invariant, and a line number is stale the next time either rail is edited.) When an email resolves to more than one contact and
no name narrows it, it returns the conservative answer (`none` / `sign_self`),
never a candidate's state (§3.1).

**W10 — one predicate for the STATE OF A SIGNATURE.** `waiverAcceptanceState` is
the only expression of whether an existing signature counts: every surface that
answers "is this person covered" — the gate, the requirement callable, the roster
hook, the signers tab, the export — calls it and none reimplements it.
Falsifiable by grep: `waiverValidUntilMs` has exactly one non-test call site
(`accept.ts`), and no file compares `accepted_version` against
`min_valid_version` itself.

> **Not "nothing else touches `min_valid_version`", which is a different claim
> and a false one.** `decideWaiverGate` compares a *submitted* version and a
> *guardian request's* version against the document's window, and
> `guardianRequestIsRedeemable` does the same for a stored request. Those answer
> "may this tick be recorded", not "does an existing signature count" — the
> second question is the predicate's, and the first cannot be expressed in it
> because it is about a payload, not about a signer row.

**W11 — nothing reads the session's email claim to identify a signer.** No waiver
code path reads `request.auth.token.email`. ~~The only address that ever lands in
`signer_email` on a guardian acceptance is the request's `guardian_email`, copied
server-side.~~

> **AMENDED 2026-08-16 (§4).** The headline **still holds and is still checkable**
> — grep the waiver paths for `token.email` and you get nothing. Only the second
> sentence went with the guardian machinery. `signer_email` is now the address the
> six-digit code was mailed to on the three OTP rails (`bookSession`,
> `bookAppointment`, `createAppointmentCheckout`, each passing
> `WaiverGateParams.signerEmail`), and the subject's own address on the three that
> never see a code (the drop-in checkout, the waitlist claim, `selfCheckIn`).

**W12 — WITHDRAWN 2026-08-16 (§4).** ~~a guardian address equal to the subject's is RECORDED, never silently
accepted and never refused.** `requestGuardianSignature` mints the request, and
every acceptance derived from it carries
`guardian_address_same_as_subject: true`, which the export prints and the signers
tab shows. Falsifiable both ways: a mother using her own address for her
9-year-old **books successfully**, and her acceptance carries the flag (§0.5(f),
§4.4).

> **What makes the second half of that true, because it was false once.** The
> signers tab reads `documents/{d}/signers/{contactId}` and never the event
> subcollection, so the flag has to be **copied onto the signer row** by
> `nextSignerRow` alongside `signer_role`, `signer_name`, `signer_email` and
> `signer_email_verified_by`. It was not, and the tab could not have shown it at
> any effort — the value was not in the data it reads. The strength-axis fields
> travel together or the column is a partial answer wearing the shape of a
> complete one.

**W13 — expiry and supersession are lazy; there is no SWEEP.** No entry is added
to `dailyTasks` or `bookingRemindersHourly`, and nothing scans for expired
signatures or superseded signers ~~or stale guardian requests~~. A
`require_resign` publish writes zero signer rows.

> **AMENDED 2026-08-16 (§4).** Unchanged in substance and still checkable; the
> third item in the list simply has no referent now that `guardian_requests` is
> gone. Laziness got *easier* to hold, not harder — the one store in this feature
> that carried its own deadline was that one.

> **"There is no job" is literally true in this phase, and the narrowing below
> is a v2 note.** The draft narrowed W13 because the `notify` fan-out was going
> to be a job — an `onDocumentCreated` worker on `notify_jobs/{jobId}` at
> `timeoutSeconds: 540`, re-enqueuing on a cursor (§2.3, §0.5(g)), because a
> 60-second callable cannot drain 400 serial Brevo sends and a partial notify is
> a compliance answer that is wrong rather than late. **D1 deferred all of it**,
> so this tree has no `notify_jobs`, no worker, and no scheduled entry of any
> kind — which is what CLAUDE.md's waiver section states.
>
> The narrowing is kept here because it is the v2 constraint, and because the
> reason survives the deferral: the invariant that matters is **lazy
> derivation**, and a send worker would not touch it — it writes notice rows and
> one cache field, and computes no validity.

**W14 — WITHDRAWN 2026-08-16 (§4).** ~~one deadline per guardian request.~~ A `GuardianSignatureRequest` carries
exactly one `expires_at`, and no booking, seat or session deadline is created,
extended or shortened by anything in this phase. Phase 2's single-deadline rule is
untouched.

**W15 — WITHDRAWN 2026-08-16 (§4).** ~~THE token is single-use and its miss is ambiguous.~~ There is exactly one
(`sign_token`; the `poll_token` was narrowed out — §4.2). It is deleted with
`FieldValue.delete()` in the same transaction that writes the ledger, and a miss
is reported identically whether the token lapsed, was used, was voided by a
change of address or never existed.

**W16 — no PUBLIC surface reads a waiver document; every public answer comes
from a callable.** A contact session and an anonymous visitor read *none* of
`documents/{d}/versions`, `/acceptances`, `/signers` or `/notices` — each of those
rules requires `isTeamMember`. The public answers arrive over
`resolveWaiverRequirement` and `signWaiverInSpace`, on the one rate-limit bucket
(`'waiver-check'`).

> **AMENDED 2026-08-16 (§4).** The invariant holds and got *simpler*: the
> `/guardian_requests` collection, its `read, write: if false` rule, the three
> guardian callables and the `'waiver-guardian'` bucket are all deleted. There is
> now exactly one waiver bucket in the tree — grep `RATE_LIMIT_BUCKET` and
> `'waiver-check'` (`connect/checkout.ts`) is the only waiver entry. Removing the
> only unauthenticated public *writer* is what shrank the surface this invariant
> is about.

> **Stated as "no client reads" in the draft, which was false and was going to
> stay false.** The studio-side authoring UI reads `/versions` (the version
> history and the publish dialog) and `/signers` (the signatures tab) directly,
> under exactly those `isTeamMember` rules — see `WaiverSigners.tsx`'s own header,
> which says so. The discipline being asserted is about the READER, not about
> the collection: a signed-in team member reading their own tenant's data is the
> ordinary admin pattern, and forcing it through callables would buy nothing.
> `/acceptances` and `/notices` are readable by a member too but are read by no
> client today. ~~`/guardian_requests` is readable by none.~~

**W17 — gates control creation and REQUIRING; never retiring.**
`requirePlan(teamId, 'studio')` is called by `createWaiver`, by
`publishDocumentVersion` (waiver kind only), by `updateWaiver`'s **content** arm,
and by `setWaiverRequirement` **when `required` is being set to `true`** — and by
nothing else. `setWaiverRequirement({ required: false })`, `updateWaiver`'s
settings arm and `archiveWaiver` never call it. Every row of §6.4's table holds on
a downgraded team, in both directions.

> ### W18–W20 and W23 are v2 invariants — NOTHING in this phase establishes them
>
> D1 deferred `notify`. `publishDocumentVersion` refuses the outcome by name,
> there is no fan-out worker, no `notify_jobs`, no `getWaiverNoticeReport` and no
> writer for `documents/{d}/notices`. The four statements below are therefore
> **specifications for the phase that ships notify**, not claims a reader can
> check against this tree — read them in the future tense.
>
> What this phase DOES establish, and what makes them buildable as an addition
> rather than a migration: the `notices` subcollection and `WaiverNoticeRow`
> exist in the model with no writer, `waiverNoticeKey` is defined, and no notice
> state is stored as a field on the signer row (`latest_notice_id` is a pointer
> carried forward across every signer write and read by nothing). That last part
> IS checkable today, and it is the half of W18 that matters now.

**W18 — one notice ROW per signer per attempt, keyed on the event.** A `notify`
publish writes one append-only `documents/{d}/notices/{id}` row per signer, with
`id === waiverNoticeKey(documentId, version, contactId, attempt)` — the same
string as the `mail_sends` document id. A resend mints `attempt + 1`, so it is a
**new row** and a genuinely new send rather than an idempotent skip. **No notice
state is ever stored as a field on the signer row**: `latest_notice_id` is a
pointer, nothing evidential reads it, and a later publish therefore cannot erase
an earlier version's record. Falsifiable: two `notify` publishes leave both
versions' reports correct.

**W19 — suppression is recorded, never inferred.** Every notice records
`suppressed_at_send` from an explicit `isSuppressed` call, so "no ledger row"
never has to be interpreted — and `mailService` genuinely writes none for an
already-suppressed recipient (`:181-186`, `:192`). The report re-checks
suppression at read time as well, so a missed webhook degrades to `suppressed`
rather than to a false "not confirmed" (§2.4(c)).

**W20 — `sent` is not a failure, and the buckets partition the SIGNER set.** The
report enumerates signers and joins notices onto them; `sent` and `deferred`
appear in "Not confirmed" and never in "No valid notice"; a soft bounce maps to
`deferred`; and every signer with no notice row for the requested version lands in
"Not sent by us" rather than in no bucket at all. Operator and environment facts
(`blocked_by_policy`, `not_sent_env`, `not_attempted`) never appear in the bucket
that accuses a member.

**W21 — the price pipeline is untouched.** `git diff` on
`packages/shared/src/utils/paymentOptions.ts` and
`packages/functions/src/booking/paymentOptions.test.ts` is **empty** for this
phase: a waiver has no price, so it gets no arm in the resolver, no quote, no
money mechanics.

**The one exception, stated rather than hidden.** `connect/checkout.ts` gained
~~exactly two waiver-shaped identifiers~~ **— AMENDED 2026-08-16 (§4): exactly
ONE —** `WAIVER_CHECK_RATE_LIMIT_BUCKET`, an `export const` string name.
(`WAIVER_GUARDIAN_RATE_LIMIT_BUCKET` was deleted with the mint it bounded;
`limits.test.ts` now asserts its **absence**, because a bucket nothing spends is a
bucket somebody re-uses.) It is
acceptable, and the original blanket clause ("no waiver identifier appears in
`connect/checkout.ts`") was the wrong shape of invariant, for one reason: that
module owns the public-surface IP rate limiter, and the taken bucket prefixes are
deliberately declared **in one place** so two surfaces cannot collide on a
counter by accident. Putting the waiver names anywhere else would buy a literally
true invariant at the cost of the property the limiter actually needs. What
matters is that they are *names of counters*, not price logic — a waiver still
never reaches an amount, a fee, a currency or a Stripe call.

So the checkable form is: **no waiver identifier in `connect/checkout.ts` outside
the rate-limit block, and no waiver name in any pricing or money function.**
Falsifiable by grep: every `-i waiver` hit in that file is that one constant or
its docblock, and `git diff` on the resolver is empty. The comment above the
constant states the same rule at the site.

**W22 — the export is self-contained and honest.** Every acceptance in the
member's OWN history carries the full materialised text, its stored hash and an
explicit match verdict; a mismatch is printed rather than suppressed.

> **The `other_records_for_this_email` section is the stated exception, and it is
> exact.** Those rows belong to a *different contact* that happens to share the
> address, so they are a pointer for an operator rather than a signed artefact
> about this person: the text is deliberately not materialised. Their hashes ARE
> checked against the real version snapshots, so the verdict beside them is a
> verdict — the draft rendered that section against an empty version map, which
> stamped `version_missing` on every foreign row and fired the integrity alarm
> unconditionally, in the document a studio hands a lawyer. "Self-contained"
> therefore means: everything the artefact ASSERTS ABOUT ITS SUBJECT stands on
> its own, and the one section that does not is labelled as somebody else's.

**W23 — the notice layer is auditable the day it ships.** `getWaiverNoticeReport`
exists and returns real data in the same commit as the first `notify` send.
Falsifiable from the git history of **⚛ ATOMIC GROUP C**.

**W24 — no count-assertion in prose, and it is a RULE, not a state.** A comment
or document line may not assert a count of an enumerable set; it names a census
owner, or names the members and drops the number, or asserts it in a test where
it is executable (CLAUDE.md → "Comments must not assert a COUNT of code sites").

> **Stated in the draft as an accomplished fact — "no line added by this phase
> asserts a count" — which was false in every review round, including the one
> that wrote it.** The corrected ones, kept as a record of the shape rather than
> as a boast: the gate's "the four refusals" (`WaiverRefusalReason` had five);
> "ONE WRITER-PAIR for the policy" in three files (four callables wrote it, then
> five); `waiverAcceptanceState`'s docblock listing its callers (it named two
> that do not call it and omitted one that does); `WaiverStep`'s per-file submit
> counts (they disagreed with the census test that checks them);
> `waiverCallableError`'s "every refusal … mapped to copy" (five were not);
> `hooks.ts`'s "all five of them" over a block containing four; W5, W10 and W16
> here. Each was replaced by a pointer, a named list or a fixture.
>
> The three that ARE executable now: `gate.test.ts` walks
> `packages/functions/src/**` and asserts that the set of files calling
> `enforceWaiverGate` equals the census; `surfaces.test.ts` re-derives the
> surface/submit table from the sources; `waiverReasons.test.ts` re-derives the
> refusal set from the server source. Prose outside those is checked by reading.

**W25 — i18n lockstep, and every refusal is actionable.**
`apps/web/messages/{en,de,fr,it}.json` have identical key **sets** in `Waivers`,
`Waiver`, `Documents` and `Nav`, and **every `details.reason` in §3.5's table has
a string** ~~— including the two the draft's table omitted while §4 raised them
(`waiver_guardian_too_many`, and now `waiver_guardian_subject_mismatch`)~~. A
capped refusal's copy names **when the cap resets**.

> **AMENDED 2026-08-16 (§4).** Still live and still the one invariant here with a
> test that re-derives it rather than restating it. `WaiverRefusalReason` is now
> **three** arms — `waiver_required`, `waiver_version_changed`,
> `waiver_unavailable` — the two guardian reasons having gone with their
> callables, and `waiverReasons.test.ts` reads the union out of the server source
> so the count can never be asserted in prose here again. Key-set lockstep is
> unchanged and holds: 5067 keys, identical sets, all four locales.

**W26 — WITHDRAWN 2026-08-16 (§4).** ~~a guardian request is only ever redeemed for the subject it names.~~
Redemption asserts `subject_contactId` (when set) equals the resolved contact, and
otherwise that the resolved contact's identity equals `subject_identity_key`;
mismatch refuses with `waiver_guardian_subject_mismatch` and writes nothing.
Falsifiable: mint a request for A, redeem it against a booking for B, expect a
refusal and an unchanged ledger.

**W27 — WITHDRAWN 2026-08-16 (§4).** ~~exactly one acceptance event per guardian tick.~~ §4.3's steps 5 and 7 are
mutually exclusive, interlocked by `GuardianSignatureRequest.acceptance_id`, and
both derive the same id because `intentId := requestId`. Falsifiable: sign with an
existing contact and with a not-yet-created one; each produces exactly one
`kind: 'accepted'` event carrying that `guardian_request_id`.

**W28 — no acceptance is created inside a transaction without first reading its
ref.** Every rail `tx.get`s the acceptance document in the transaction's read
phase and skips the create when it exists. Falsifiable by grep: no
`tx.create(acceptanceRef)` appears without a preceding `tx.get` of the same ref,
and no `catch` of gRPC 6 appears inside any `runTransaction` callback in
`packages/functions/src/waivers/`.

**W29 — every published document has a version.**
`documents where status == 'published' && current_version == null` is **empty**
across all teams after ⚛ ATOMIC GROUP A, and the mirror sync reads `bodyHtml` only
from a version document. A version minted retroactively carries `backfilled_at`
and the export prints it as such (§2.1.1).

**W30 — the Documents public surface never advertises an empty page.**
`active_public_surfaces.documents` is computed from the existence of a
`public_profile` **mirror**, not from the root `documents` collection, so a
downgraded or never-backfilled team's surface stays dark until its mirrors exist
(§6.3). Falsifiable: downgrade a seeded team, delete its mirrors, touch its team
document — `documents` stays false.

---

## 9. Work items

Ordered. Items inside an **⚛ ATOMIC GROUP** land in one commit. Every requirement
in §1–§7 has an owner; §9.3 is the ownership matrix and it is the anti-orphan
device — Phase 2 shipped a spec whose notification layer no work item owned and it
was simply never built.

---

### P4-A · Route segments and reserved slugs

**Files** — `packages/shared/src/publicRoutes.ts` (`PublicRoutable` `:25-34`,
`PublicRouteParams` `:91-113`); `packages/shared/src/slugs.ts:9-26`.

**Change.** Add `'waiver'` to `PublicRoutable` with a `TokenParams`-shaped params
type carrying `{ doc?: string; token?: string }`. Add `waiver` **and** the four
missing segments — `documents`, `waitlist`, `forms`, `kiosk` (W-B9) — to
`RESERVED_SLUGS`.

**Failure mode prevented.** A team slug shadowing a literal route; and the
functions/web URL drift the `publicRoutes.ts` header records as having already
happened once.

**Verify.** `isReservedSlug('waitlist')` is true; `publicUrl(host, slug, 'waiver',
{ doc, token })` type-checks and round-trips.

---

### P4-B · Types, predicates, paths, caps

**Files** — new `packages/shared/src/types/waiver.ts`;
`packages/shared/src/types/document.ts` (`DocumentKind`, `StudioDocument`,
`DocumentPublicProfile`, and the W-B4 comment); `packages/shared/src/paths.ts`;
`packages/shared/src/index.ts`; new
`packages/functions/src/waivers/waiverState.test.ts`.

**Change.** Everything in §1.3, §1.4 and §1.7. No behaviour. Specifically owns:
`waiverAcceptanceState` with its fixed decision order; the shared
`contactIdentityKey` (taking a hasher, browser-safe, as `promoIdentityKey` does);
`MAX_WAIVER_BODY_CHARS` as the ONE definition with both former sites delegating
(W-B8); a header note that no `tenantData.ts` registration is needed, and why.

**The fixture matrix is part of this item, not a follow-up.** Every
`WaiverAcceptanceState` × every `PublishOutcome` × every `GuardianRequirement`,
one whole-object assertion per row, in the shape
`paymentOptions.test.ts` uses.

**Verify.** `pnpm typecheck`; the new test file passes; `git diff` shows no edit
to `paymentOptions.ts` (W21).

---

### P4-C · De-gating Documents ⚛ *internally atomic*

**Files** — the §6.2 census (regenerate it), **including its items 13
(`firestore.rules`) and 14 (`packages/shared/src/types/team.ts`)**; new
`scripts/audit-document-visibility.ts`; new
`scripts/backfill-document-mirrors.ts`.

**Change.** §6.2, §6.3 and **§6.5**. **The config move, the dual read, the write
switch and the `settings` rule are one commit** — splitting them opens a silent
no-op-save window (`docs/fareharbor-analysis.md:592-595`), and omitting the rule
turns that window into an outright permission error on the studio's first save
(W-B14). `documentsActive` gains its mirror requirement (§6.3, W30). Delete the
teardown arm and `deleteAllDocumentPublicProfiles` with it (W-B10). Correct the
three `team.ts` comments, especially `:453-458`, which names the config location
this item moves. **And it owns D2's indexability requirement (§6.5, census item
15)** — `publicPagesIndexable`, the denormalised flag, and the server
`generateMetadata` on both public document routes.

**The dual read lives in ONE shared helper** (`resolveSignupDocumentIds` in
`types/team.ts`), called by both readers — the panel that edits the selection and
the sync that denormalises it. Two hand-written "new ?? old" reads is how the two
locations start disagreeing about which one wins, mid-migration, invisibly. An
**empty** new selection is authoritative: clearing the list must not resurrect
the retired one.

**Failure mode prevented.** A required waiver's public copy deleted by a
downgrade; `signup_documents` blinking empty; a save that fails or silently
no-ops; Population B's dark documents going live unaudited; and a downgraded
team's Documents surface flipping live over an empty page.

**Verify.** Uninstall/downgrade a seeded team → its document mirrors **survive**.
A studio's signup-consent selection **saves and is read back in the same session**
(this is the W-B14 check — it fails with a permission error without the rule).
`signup_documents` is non-empty throughout the migration. The audit script runs
read-only and names the flip-live set; the backfill refuses without a typed
confirmation. A downgraded team with no mirrors and a touched team document still
reads `active_public_surfaces.documents === false` (W30).
`grep -rn "documents plugin" packages/shared/src` is empty.
**A Free team's public document page serves `<meta name="robots"
content="noindex, nofollow">`; the same page on a paid, ACTIVE team serves no
robots tag; a team on a studio TRIAL serves `noindex`** (§6.5). Check it in the
served HTML, not in the React tree.

---

### ⚛ ATOMIC GROUP A — versioning becomes real

*Splitting leaves the client status-flip and the publish callable both able to
publish: two writers of the same state, one of which cannot mint a snapshot. And
the version backfill must land with the mirror-source flip that depends on it.*

#### P4-D · `publishDocumentVersion`, the version snapshot, the policy doc

**Files** — new `packages/functions/src/waivers/publish.ts`;
`packages/functions/src/index.ts`; `firestore.rules`;
`packages/functions/src/sync/syncDocumentPublicProfile.ts`;
`packages/functions/src/sync/syncTeamPublicProfile.ts` (the
`required_waivers` summary); new `scripts/backfill-document-versions.ts`.

**Change.** §2.1, §2.1.1 and §2.2 — the callable, the immutable snapshot, the
three outcomes' effects, `min_valid_version` as the lazy supersession mechanism,
the in-transaction policy-document patch (§1.5), and §1.6's rules including
W-B1's **two** narrowings (`status != 'published'` **and**
`current_version == null`). The sanitize call moves to publish and the mirror
reads the frozen body (§2.1's ordering argument).

**All five callables of §1.6's table, not three.** `createWaiver`,
**`updateWaiver`**, `publishDocumentVersion`, `setWaiverRequirement` (with §6.4's
asymmetry) and **`archiveWaiver`**. The draft named three, which would have frozen
every waiver at its empty creation state: W3 denies client create, update *and*
delete on `kind: 'waiver'`, while the editor's save is a direct client write
(`plugins/documents/hooks.ts` — `setDoc` `:86`, `updateDoc` `:108`, `deleteDoc`
`:115`). A studio could have minted "Liability release", typed the text, hit Save,
and been denied, with no callable behind the button and therefore no way to author
a v1 — let alone a v2 after a lawyer sends corrected wording. §6.4's promise that
a downgraded team can still archive was unreachable for the same reason.

**Every policy write also stamps the team document in the same transaction**
(§1.5) — as built, by `writePolicyAndTouchTeam` doing both, not by a call to
`touchTeamForSurfaceRecompute` (which is standalone and cannot join a
transaction). Without it `TeamPublicProfile.required_waivers` is stale by
construction: the sync is triggered by team-document writes and the policy lives
in a subcollection.

**The version backfill (§2.1.1) is part of this item and is ordered before the
mirror-source flip is deployed.**

**Verify.** Publishing twice produces two version documents and never mutates the
first. `require_resign` writes **zero** signer rows and moves one number. A
manager cannot delete a published document — **including one published before this
phase, which has `current_version == null`** — or write a waiver document, from
the rules emulator. `body_hash === sha256(bodyHtml)` for every version. **A
waiver's body can be edited and republished as v2.** Archiving a required waiver
removes its policy entry **in the same write**. After the backfill,
`status == 'published' && current_version == null` is empty (W29). Flipping
Required on at 09:00 makes the step appear on the very next booking, on every
surface (the team touch).

#### P4-E · The admin publish flow replaces the status switch

**Files** — `apps/web/src/app/[locale]/(auth)/plugins/documents/[documentId]/page.tsx`;
`apps/web/src/plugins/documents/hooks.ts`.

**Change.** The status tri-state's `published` arm routes through the callable;
the chooser of §7.2; the version-history list; the waiver settings block of §7.1.
The client can no longer write `status: 'published'`.

**Verify.** The old client flip is gone — `grep` shows no `status: 'published'`
write outside the callable, **and the rules refuse one**: a manager updating a
document from `draft` to `published` from the client is denied, while editing an
already-published document and unpublishing it back to `draft` both still work.
The chooser offers **two** options, each with its evidential line, defaults to
`require_resign` on a waiver and `silent` elsewhere, and shows the image /
external-link warnings on the right documents. Publishing after an unsaved edit
freezes **the text on screen**. Every named server refusal renders its own
message, not a generic one. The version-history list shows outcome and publisher
per version and labels a backfilled v1 as retroactive.

---

### ⚛ ATOMIC GROUP B — the requirement callable and the gate

*The gate needs the callable's contract; a gate whose refusal no surface can act
on is a dead end. The pair is safe to land **before** the public steps because the
feature ships dark: `WaiverConfig.required` is off by default, so a team with no
required waiver is unaffected on every rail.*

#### P4-F · `resolveWaiverRequirement`

**Files** — new `packages/functions/src/waivers/requirement.ts`;
`packages/functions/src/connect/checkout.ts` (the `'waiver-check'` bucket only —
no waiver logic, W21).

**Change.** §3.1. **Caller resolution through the extracted email+name helper the
rails share** (W9) — the shared predicate is part of this item, not an assumption
about one; the age resolution of §4.5 including the signup rail's in-flight
birthdate; `intentId` minting; the guardian branch's `action` values and its
resume-by-identity lookup (§4.3 step 6a). Writes nothing.

**Verify.** An anonymous caller, a guest by email+name, and a contact session each
get the state the gate computes for them. **Two contacts on one shared email, one
signed and one not: the unsigned one is asked, and an email-only call returns the
conservative answer rather than either contact's state.** 31 calls from one IP →
the 31st is rate-limited while `createDropInCheckout` from the same IP still
succeeds.

#### P4-G · The gate and the acceptance write, on every rail

**Files** — `packages/functions/src/booking/index.ts` (`bookSession`);
`booking/dropIn.ts`; `booking/waitlist/claim.ts`; `appointments/window.ts`;
`appointments/booking.ts`; `appointments/checkout.ts`;
**`sessions/index.ts` (`selfCheckIn`, §3.10)**; new
`packages/functions/src/waivers/accept.ts`.
**Not `rebookSession`** — its gate is removed (§0.5(c)).

**Change.** §3.2's table, §3.3's write placement, §3.5's refusal vocabulary,
§3.6's mid-checkout rule, §3.10's `selfCheckIn` refusal (refuse only, no
acceptance), and the denormalised `booking.waiver_state` §7.4 needs.
`accept.ts` owns the single acceptance-writing helper every rail calls, so three
things exist exactly once: the event id derivation, **the read-then-skip of the
acceptance ref** (W28), and **the conditional signer-row write** under §1.4.1's
precedence rule (W8).

**Verify.** Every row of §3.2. A refusal on each rail leaves no contact created
(W7). On `bookSession` the acceptance and the seat are in one transaction, and
forcing the acceptance write to throw leaves **no booking** (W8). **Submitting the
same `intentId` twice writes one event and does not abort the second booking**
(W28). **A stale acceptance landing after a stronger one does not downgrade the
signer row, and a revocation is never undone by a late acceptance** (§1.4.1). An
unsigned member scanning the kiosk QR is refused (§3.10). A team with no required
waiver takes exactly one extra document read per booking, and a `git diff` of the
transaction shows no added query.

---

### ⚛ ATOMIC GROUP C — the notice layer and its audit

*This is the Phase-2 anti-pattern's foreclosure. A `notify` publish that sends
mail nobody can audit is the "decorative" outcome Decision 5 rejects by name, so
the send and the read-back ship together or neither ships.*

#### P4-H · The notify fan-out and the webhook linkage

**Files** — new `packages/functions/src/waivers/notify.ts` (the job worker);
**`packages/functions/src/mail/mailService.ts`** (the `ledgerMeta` field on
`OutboundMessage`, spread into the existing `ledgerRef.set` at `:197-212`);
`packages/functions/src/mail/handleBrevoWebhook.ts`;
`packages/functions/src/index.ts` (the worker export).

**Change.** §2.3 in full: the **`notify_jobs` document plus an
`onDocumentCreated` worker at `timeoutSeconds: 540`** that drains
`WAIVER_NOTICE_CHUNK` signers and **re-enqueues on a cursor** (§0.5(g)); one send
per signer; the event-keyed idempotency key with its attempt suffix; **append-only
`notices/{id}` rows created BEFORE the send at `not_attempted`**; the explicit
`isSuppressed` check recorded on the row; the once-per-pass `isMailEnabled()` read
splitting `not_sent_env` from `blocked_by_policy`; the `offerWasDelivered` split;
and the webhook fan-out with **its own event map** — `soft_bounce` → `deferred`
and `unsubscribed` → `suppressed`, neither of which `LEDGER_STATUS` provides
(W-B11, W-B13). The guardian-link send writes a notice row through the same
helper.

**`mailService.ts` is in this list because the linkage cannot be a second write.**
Stamping before the send trips `dispatch`'s idempotency guard (`:136-144`) and
kills the send permanently; stamping after it loses the race to the webhook for
exactly the events that matter. §2.3 works this through.

**Verify.** A `notify` publish over N signers writes N ledger rows with distinct
keys and N **notice rows**, and **N greater than one chunk still completes** —
the worker re-enqueues rather than truncating. A suppressed address records
`suppressed` and never reaches Brevo. **Delivering the webhook BEFORE the ledger
write is even possible still classifies the recipient correctly**, because the
linkage rides the send. Replaying a `delivered` webhook is idempotent. An
`unsubscribed` event moves the notice state. A resend actually sends. On a
`silent` policy tenant every notice records `blocked_by_policy`; with
`MAIL_ENABLED=false` every notice records `not_sent_env`; nothing throws in
either.

#### P4-I · `getWaiverNoticeReport`

**Files** — new `packages/functions/src/waivers/report.ts`.

**Change.** §2.4 — the **four** buckets, the signers-first enumeration, the
read-time re-derivation from `mail_sends/{noticeId}` and `isSuppressed`, the sort,
and the per-row resend action. A callable, because both mail collections are
rules-denied.

**Verify.** The four buckets partition the **signer** set exactly, including a
signer the worker never reached and a signer who signed **after** the publish — the
draft's three buckets left both in no bucket at all. A `sent` row with no webhook
lands in "Not confirmed", never in "No valid notice". A hard bounce lands in "No
valid notice"; a soft bounce does not; a policy drop and a kill-switch pass land in
"Not sent by us". **After two `notify` publishes the older version's report is
still reachable and still correct** (W18).

---

### P4-J · The guardian link, end to end — **SHIPPED, THEN REMOVED**

**Shipped 2026-08-15; removed 2026-08-16.** See §4 above for why, and
`docs/waivers.md` → "Minors" for what stands in its place. Every file this item
created is deleted (`waivers/guardian.ts`, `waivers/guardianRequests.ts`,
`waivers/guardian.test.ts`, the `/public/{slug}/waiver` page) and every file it
edited has had the arm taken back out. `caller.ts` survives without
`subjectClaimFor`: the email+name caller resolution is still what keeps the
public answer and the gate from disagreeing.

**What replaced it, as one work item.** `WaiverConfig.mayIncludeMinors` on the
waiver editor (a switch, inline, never behind a disclosure); a second required
radio on `WaiverStep` and on the Space card with an optional name field;
`declarationFor` in `waivers/gate.ts` — the ONE place a declaration is honoured,
and only for a waiver the studio actually flagged, so a client cannot stamp "a
parent signed" onto an adults-only studio's ledger; `signer_role` / `signer_name`
on the acceptance, already there; `bookingWaiverStateFor` for the denormalised
stamp; `WaiverDoorCheckChip` on the roster and the printed manifest, with
`useWaiverRoster` returning the live per-contact answer off the signer rows.

**Verify.** A studio that never sets the flag sees no extra question and no chip
anywhere. With the flag set, the Confirm stays dead until the radio is answered —
there is no default, because a default would answer on the visitor's behalf a
question the record then attributes to them. A `signingAsGuardian` sent for an
UNFLAGGED waiver is dropped, not recorded. The signers tab prints *self-declared
— not verified* beside a guardian row, and the export's honest paragraph says the
same. No waiver path sends mail, on any rail, at any moment.

---

### P4-K · Revocation — **SHIPPED**

**Files** — new `packages/functions/src/waivers/revoke.ts`;
`packages/functions/src/index.ts`; `apps/web/src/hooks/useWaiverStates.ts`
(`useWaiverSignersForContact`);
`apps/web/src/components/contacts/ConsentHistoryPanel.tsx`;
`apps/web/messages/{en,de,fr,it}.json`.

> **CORRECTION, made while implementing: the callable is a SIBLING FILE, not a
> sibling export in `accept.ts`.** `accept.ts` is the ledger writer, imported by
> every public rail, and it deliberately exports no `onCall` at all. Putting a
> manager-only callable there would also put ADMIN refusal codes (`not_signed`,
> `already_revoked`, `ledger_unreadable`) into the file that
> `waivers/waiverReasons.test.ts` reads as the census of refusals a VISITOR can
> be shown in four languages — two vocabularies with different audiences in one
> module, which is how one ends up rendered to the wrong one. The single-writer
> property is untouched: `revoke.ts` computes no state and writes no row itself.
> It builds an event and hands it to `recordWaiverEvent`, so `rounds`, the
> precedence rule and the read-then-skip all still live in exactly one place.
>
> Two details the draft did not specify and that decide whether the row is
> honest. The revocation's immutable fields are **copied from the acceptance it
> revokes** rather than re-derived from today's contact — re-deriving
> `subject_name` would file a revocation against a name the signature was never
> taken under. And `intentId` is `rev_{acceptance_id}`, so revoking twice writes
> ONE row (the read-then-skip turns the replay into a no-op) while a later
> re-sign and a second revocation get their own, because the re-sign minted a new
> acceptance id.

**Change.** `revokeWaiverAcceptance({ documentId, contactId, reason })` — manager
only, appends a `kind: 'revoked'` event naming the acceptance it revokes and flips
the signer row's `status`. The original acceptance row is **untouched**. Surfaced
on the contact detail page beside the consent history.

**Verify.** Revoking leaves the accepted event byte-identical. A revoked signer
is refused at the gate, re-signs successfully, and `rounds` increments once. The
event log shows accepted → revoked → accepted.

---

### P4-L · The export

**Files** — new `packages/functions/src/waivers/export.ts`; new
`scripts/verify-waiver-ledger.ts`; `firestore.index.json`.

**Change.** §5.3 and §5.4 — the callable, the JSON and HTML renderings, the §5.2
paragraph in the header, the hash-match verdict **with its repair sentence**, the
`backfilled_at` marker on retroactive versions, and **both** collection-group
indexes (`acceptances`: `contactId ASC, accepted_at DESC` **and**
`identity_key ASC, accepted_at DESC` — the second is mandatory, not optional). The
identity-key rows render as a separate, labelled *"other records for this email
address"* section, never merged. The same callable, scoped to
`request.auth.token.contactId`, serves the member's own download **without** that
section. `verify-waiver-ledger.ts` implements §5.4's five checks with an exit
code.

**Verify.** A member with a revocation, a re-sign, a guardian signature and two
`silent` versions exports a document in which all of that is legible and the
`silent` versions are visibly marked. **A member with two contact ids under one
email gets both histories, in two clearly separated sections.** **A household
mailbox does not merge a mother's and a child's records into one narrative.**
Tampering with a version document (via the Admin SDK) produces a printed mismatch
**and a stated next step**, and `verify-waiver-ledger` exits non-zero on the same
data.

---

### P4-M · The public consent steps

**Files** — `apps/web/src/app/[locale]/(public)/public/[slug]/booking/BookingForm.tsx`;
`…/appointments/AppointmentPicker.tsx`; `…/waitlist/page.tsx`;
`…/kiosk/WalkIn.tsx`; `…/signup/SignupForm.tsx`; new shared
`apps/web/src/components/booking/WaiverStep.tsx`; `apps/mobile` refusal mapping.

**Change.** §7.3 in full, including **both** silent-miss paths — the
`BookingForm` returning-member interposition (`BookingForm.tsx:1067-1112`, which
never renders `details`) **and the `AppointmentPicker` `autobooking` screen**
(`:428-500`, which today books automatically on verification with only a spinner
and no confirm control at all). The `showConfirm` / `stepQuery` / restore wiring;
the non-terminal step; the date-of-birth ask with its stated reason **reading the
signup form's in-flight value on that rail** (§4.5); the guardian branch's states
(`sign_guardian` → `guardian_pending` → `guardian_undeliverable` →
`guardianSignatureReady`), all four of which `resolveWaiverRequirement` now
reports directly — **no `localStorage`, no token in the tab** (§4.2, §4.3 step
6a). Mobile gets the
mapped `details.reason` message and a deep link, not a step (§3.9) —
**including `selfCheckIn`'s refusal on the check-in screen** (§3.10).

**Verify.** Enumerate the terminal submits **per file** and check each, rather
than one per surface:

- `BookingForm.tsx` — all **three** paths present the step; a gated class booked
  by a returning member shows it before `bookSession` is called.
- `AppointmentPicker.tsx` — `onSubmitGuest`, `onMemberPay` **and
  `onVerifiedAppointment`/`autobooking`** each present it. The autobooking path
  must never reach `book()` with an unmet requirement, because
  `resolveAppointmentCaller` has already marked the code used
  (`appointments/booking.ts:258-262`) and `:477` funnels the refusal into
  "something went wrong".
- `waitlist/page.tsx`, `WalkIn.tsx`, `SignupForm.tsx` — same count-the-submits
  check.

Back into the step is safe, **and booking a second class from the same mounted
flow with the same `intentId` succeeds** (W28). The paid claim does not re-prompt
after the hop. The priced-trial door and the queue join show no step. A decline
costs at most one re-verification, never a dead end (§3.2).

---

### P4-N · Roster and manifest

**Files** — `apps/web/src/app/[locale]/(auth)/sessions/[id]/page.tsx`;
`…/manifest/page.tsx`; `apps/web/src/hooks/useDaySheet.ts`.

**Change.** §7.4 — the chip from the denormalised `booking.waiver_state` on the
sheet, the live signer read on the session page, **the chip on
participant-without-booking rows** (the manifest's `walkIns` list at
`manifest/page.tsx:299+` / `useDaySheet.ts:127-137`, and the session page's
participants), and the add-participant warning plus "email them the waiver" for
the unclosable staff path (§3.8).

**Verify.** The chip prints legibly in black and white (glyph, not fill). No
full-contacts query is added to either page. Unknown renders nothing. **A
staff-added participant with no valid acceptance shows the chip on the printed
sheet** — that row has no booking document, so it must read the signer row, and
the draft left exactly this person unmarked.

---

### P4-O · Space

**Files** — `…/public/[slug]/space/SpaceHome.tsx`; `…/space/account/AccountHome.tsx`.

**Change.** §7.5 — the re-sign banner, the "Signed documents" card, the member's
own export. **No fifth nav tab, and no second date-of-birth prompt.**

**Verify.** A `require_resign` publish makes the banner appear for a signed-in
member without them booking anything. `AccountHome` still has exactly one
birthdate control, in the profile form.

---

### P4-P · Admin authoring surface

**Files** — `…/(auth)/plugins/documents/page.tsx` (or `/documents` after P4-C);
`apps/web/src/plugins/documents/*`; `…/(auth)/layout.tsx`.

**Change.** §7.1 — the waiver kind offered **visible and locked** below Studio, the
waiver settings block (whose `guardianRequired` control is where §10 Q17's answer
lands), the signers tab embedding P4-I's report **with its version selector**, the
version-history rows **linking their `notify` outcome to that version's report**,
**§5.2's standing evidence-quality line**, the read-only waiver line on the
activity form, and the `WAIVER_MIN_PLAN` client mirror. The document editor's Save
routes through `updateWaiver` when `kind === 'waiver'` and keeps its direct client
write for every other kind (§1.6).

**Verify.** A Coach team sees the waiver option locked with the upgrade modal, not
hidden. A downgraded Studio team can still turn a requirement off, edit settings
and archive a waiver (§6.4's table), and cannot publish a new version, edit the
text, or turn a requirement **on**. **After two `notify` publishes, the older
version's report is still reachable from its history row and still correct.** The
standing line reports both numbers (signatures predating a change, notices that
did not arrive) and matches what the report and the ledger say.

---

### P4-Q · `completeSignup` writes real acceptances — **SHIPPED**

> **AS SHIPPED**, with two shapes the draft left open and one it could not have
> had:
>
> - **`TeamPublicProfile.signup_documents` gains `documentId` and `version`.**
>   The draft says "real ledger rows against real versions" and the mirror
>   carried neither, so there was nothing to write a row *against*: the form knew
>   only slugs. The id is what lets the server find the document without trusting
>   a client-supplied slug, and the version is the one the visitor was ACTUALLY
>   SHOWN — recording against `current_version` instead would file a signature
>   for text published a minute later.
> - **The server intersects the client's echo with its OWN configured list**
>   (`resolveSignupDocumentIds`), and takes the hash from the immutable snapshot,
>   never from the payload. A document echoed with no version, or whose snapshot
>   cannot be read, is **skipped** — that is the known state of a document
>   published before versioning existed and not yet backfilled, and inventing a
>   row for it would be W-B3's `version: ''` in a new spelling.
> - **This rail RECORDS and never REFUSES**, which §3.2's table already implies
>   (`completeSignup` — Gate? *n/a*) but nothing said out loud. Signup is not
>   attendance; the requirement binds at the first booking. A guardian
>   requirement therefore produces no row and no refusal here either.
> - `signer_email_verified_by` is **`verified_code` on the OTP path** and
>   `session` on the session path — the two are not equally strong and the record
>   says which. The work lives in `packages/functions/src/waivers/signup.ts`
>   (`recordSignupConsent`), named in `gate.ts`'s census under "not an attendance
>   rail", and it is called ABOVE `completeSignup`'s best-effort blocks: an
>   evidential record must not sit in the zone where failures are logged and
>   swallowed.

**Files** — `packages/functions/src/auth/completeSignup.ts`;
`…/public/[slug]/signup/SignupForm.tsx`; `packages/shared/src/types/contact.ts`.

**Change.** The signup consent path writes real ledger rows against real versions
through P4-G's shared helper — **which requires §2.1.1's backfill to have run**,
or every legacy terms document has no version to reference (§0.5(h)).
`SignupForm` stops sending `version: ''`. `Contact.consent` is declared on the type
**for the first time**, marked deprecated on the line with a pointer to the ledger,
and keeps being written for one release. W-B3 closes.

**Also owns the signup rail's date-of-birth reconciliation** (§4.5, §0.4(d)):
`SignupForm` already collects an optional birthdate (`:41`, `:229`, `:452`) which
`completeSignup` writes (`:161`, `:207`), so the waiver step on this rail reads the
**in-flight form value** rather than a contact that does not exist yet. Without
this a parent signing up a 14-year-old answers the same question twice on
consecutive screens — the exact friction Decision 6 exists to prevent.

**Verify.** A signup with two attached documents writes two acceptance events with
real version numbers and `source: 'signup'`. The old blob is still written and is
labelled. **A signup that fills the birthdate on the details step is not asked
again by the waiver step.**

---

### P4-R · i18n

**Files** — `apps/web/messages/{en,de,fr,it}.json`.

**Change.** §7.6. Every `details.reason` in §3.5 gets a mapped string; every
publish outcome gets its evidential line; the date-of-birth ask carries its
reason.

**Verify.** W25's lockstep check. No visitor-facing surface renders
`requirePlan`'s message.

---

### P4-S · Documentation

**Files** — new `docs/waivers.md`; `docs/fareharbor-analysis.md` §7;
`docs/product-strategy.md:313-314`; `CLAUDE.md`.

**Change.** `docs/waivers.md` as the shipped-behaviour document, in the shape of
`docs/waitlist.md` and `docs/promo-codes.md`: the ledger's two halves and why,
the three outcomes with §5.2's honest paragraph, the guardian model and exactly
what it proves, the gate's placement per rail, and **an explicit "what the gate
does NOT cover" section** — staff class booking (§3.8), **event attendance
(§3.10)**, and the waitlist claim's committed-but-outstanding guardian bookings
(§3.4). Update `fareharbor-analysis.md` §7.4/§7.6/§7.7 with what actually
shipped, including §0.4(b)'s narrowing of the `Guardian` type. Amend
`product-strategy.md:313-314`, which §7.6 already flagged as conflating guardian
with emergency info. Add a CLAUDE.md section for waivers beside "Appointments (1:1)
vs classes".

**Verify.** A reader who has never seen this spec can answer, from
`docs/waivers.md` alone: *what does a signature here prove*, *what does a silent
publish cost me*, and — the one a studio will get wrong by inference —
**"which ways into my room are not gated"**.

---

### 9.1 Ships dark

`WaiverConfig.required` defaults to **off**, and `teams/{t}/waiver_policy/current`
starts with an empty `required` array. Until a studio flips a switch, every rail
behaves exactly as it does today, at the cost of one document read per booking.
That property is what lets Groups A, B and C land as separate commits without an
intermediate state that is broken for anybody.

### 9.2 Atomic groups

| Group | Contents | Why splitting breaks |
|---|---|---|
| **P4-C** (internally) | config move + dual read + write switch + the `settings` rule (W-B14) + the `documentsActive` mirror requirement | Split, a studio's signup-consent save silently does nothing (`fareharbor-analysis.md:592-595`) — or, without the rule, fails outright |
| **A** | P4-D + P4-E, **version backfill first** | Two writers able to publish, one of which cannot mint a snapshot. And the mirror-source flip reads a version that the backfill is what creates (§2.1.1) |
| **B** | P4-F + P4-G | The gate needs the callable's contract; a refusal no surface can act on is a dead end |
| **C** | P4-H + P4-I | A notice nobody can audit is the outcome Decision 5 rejects by name (W23) |

### 9.3 Ordered work list, with the ownership matrix

| # | Item | Group | Owns (§) | Blocks |
|---|---|---|---|---|
| 1 | **P4-A** routes + reserved slugs (W-B9) | — | §7.3 route, §4.3 link | P4-J |
| 2 | **P4-B** types, predicates, paths, caps (W-B4, W-B8) | — | §1.3, §1.4, §1.7, §8.1 shape 1 | everything below |
| 3 | **P4-C** de-gating Documents (W-B5, W-B10, W-B14) + **public-page indexability (D2)** | ⚛ self | §6 entire incl. §6.5, W30 | P4-D |
| 4 | **P4-D** publish + **five** callables, versions, **version backfill**, policy, rules, team touch (W-B1) | **A** | §1.5, §1.6, §2.1, §2.1.1, §2.2, W29 | P4-F, P4-H |
| 5 | **P4-E** admin publish flow | **A** | §7.2 | — |
| 6 | **P4-F** `resolveWaiverRequirement` + the shared email+name resolver | **B** | §3.1, §4.5 age resolution, W9 | P4-G, P4-M |
| 7 | **P4-G** the gate + acceptance write, every rail incl. `selfCheckIn` | **B** | §3.2–§3.6, §3.7, §3.10, §7.4 denormalisation, W8, W28 | P4-M, P4-N |
| 8 | **P4-H** notify worker + `ledgerMeta` + webhook (W-B11, W-B13) | **C** | §2.3, W13's narrowing, W18, W19 | P4-I, P4-J |
| 9 | **P4-I** notice report, four buckets | **C** | §2.4, W20 | P4-P |
| 10 | ~~**P4-J** guardian link end to end~~ — **REMOVED 2026-08-16**, replaced by the `mayIncludeMinors` self-declaration | — | §4 (the amendment) | P4-M |
| 11 | **P4-K** revocation | — | §1.4.1 revoke row | P4-L |
| 12 | **P4-L** export + **two** indexes + ledger verifier | — | §5.3, §5.4, W22 | P4-O |
| 13 | **P4-M** public consent steps, all terminal submits | — | §7.3, §3.9, §3.10 surfacing | — |
| 14 | **P4-N** roster + manifest incl. walk-in rows, staff warning | — | §7.4, §3.8 | — |
| 15 | **P4-O** Space | — | §7.5 | — |
| 16 | **P4-P** admin authoring + plan mirror + signers-tab version selector | — | §7.1, §6.4 client half, §5.2's standing line | — |
| 17 | **P4-Q** `completeSignup` + signup birthdate reconciliation (W-B3) | — | §0.3 W-B3, §0.4(d), §4.5 signup rail | — |
| 18 | **P4-R** i18n, all four locales | — | §7.6, §3.5 copy, W25 | — |
| 19 | **P4-S** docs | — | §5.2 in `docs/waivers.md`, §0.4(b) amendment, §3.10's events exemption | — |

> **Three things this table promised and nobody carried, found while building
> the surfaces — each now owned:**
>
> | What | Was owned by | Now |
> |---|---|---|
> | A callable that records a signature from **Space**. P4-O lists two components and no server; every gate composed into a booking rail REFUSES rather than records. | nobody | `signWaiverInSpace` (`waivers/space.ts`), §7.5 |
> | **Q4's "admit with the chip"** on the kiosk. P4-M owns the surface, P4-G owned the rail, and `bookSession` refused a guardian requirement on every source — so the decision was unimplementable from the surface alone. | nobody | `guardianPolicy` keyed on `parseBookingSource(...) === 'kiosk'` + the deferred mint, §7.3 |
> | The claim page's **`activityId`** (and the claimant's own name/address). Without them an activity-scoped waiver is invisible on the page and enforced by the server. | nobody | `getWaitlistEntry` returns all three, §7.3 |

**Named, not owned** (deliberately, each with its reason in §0.3): W-B6 (public
draft images), W-B7 (client-only document cap), W-B12 (`Math.random` slugs).
**Deliberately exempted rather than unowned**: event attendance (§3.10, §10 Q14)
and staff class booking (§3.8, §10 Q6) — both decided in the text, both listed in
§11. **Nothing else in §1–§7 is unowned** — that is what this table is for, and
this pass added owners for four things the first draft asked for and nobody
carried: `updateWaiver`/`archiveWaiver` (P4-D), the version backfill (P4-D),
`mailService.ts`'s `ledgerMeta` (P4-H), and the ledger verifier (P4-L).

---

## 10. Open questions — these need Franco

> **RESOLVED 2026-08-15.** Franco answered the three that decide the phase's
> scope and shape. The remaining sixteen proceed on the recommendation recorded
> under each. **Two of the three went against the recommendation** — both are his
> call, and both carry a consequence that is now a design requirement rather than
> an accepted risk.
>
> ### D1 — Notify is DEFERRED to v2. Ship `silent` + `require_resign` only.
>
> The publish chooser offers two outcomes, not three. Everything that exists only
> to serve `notify` leaves this phase: the `notify_jobs` queue, the
> `onDocumentCreated` worker and its resumable cursor, the `mailService.ts`
> `ledgerMeta` linkage, the four-bucket deliverability report, and
> `getWaiverNoticeReport`. **Q19 (batching) is moot and closed.**
>
> What must NOT be cut, because removing it would make notify a migration rather
> than an addition: the `notices/{id}` **subcollection stays in the model** as
> append-only, and nothing is keyed in a way that assumes a signer row can hold
> notice state. §1.2's shape is unchanged; it simply has no writer yet.
> Restate this in §2 so a future reader does not "simplify" the empty
> subcollection away.
>
> ### D2 — De-gate Documents COMPLETELY, public pages included.
>
> Against the recommendation (which was to de-gate internally and keep the public
> page gated). Accepted: one feature with no split is simpler to explain and to
> build, and public document pages are **indexable content**, which serves the
> same findability goal as §6.1 of the analysis doc. Pre-launch, the
> "can never withdraw it" risk is at its smallest — it only grows from here.
>
> **Consequence that is now a REQUIREMENT, not a risk.** Every Free-tier signup
> gains a public publishing surface on a Linyup domain. That is an SEO-spam and
> reputation vector: sign up free, publish keyword pages, borrow the domain's
> standing. The cheap mitigation preserves the decision completely — **gate
> INDEXABILITY, not existence**: public document pages on Free emit `noindex`,
> and become indexable on any paid tier. The page works for everyone, the abuse
> incentive disappears, and nothing has to be withdrawn later. A work item in §9
> must own this; it is not optional.
>
> ### D3 — `guardianRequired` defaults to `never`. **SUPERSEDED 2026-08-16 (§4).**
>
> **Outcome: the setting it defaulted does not exist.** `guardianRequired` was
> withdrawn entirely with the guardian machinery, so there is no `never` /
> `if_minor` / `always` axis left to default. What survived is the *reasoning*,
> and it is the reason the replacement has the shape it does: the common case is
> an adults-only studio, and a date-of-birth field on the acquisition path is a
> real conversion cost for a guard most tenants never need. Hence
> `WaiverConfig.mayIncludeMinors`, **off by default**, which asks for no date of
> birth at all. **Q17 is closed, and closed harder than D3 closed it** — no age
> is asked, computed or stored anywhere in the feature.
>
> **The visibility requirement below was KEPT and HONOURED**, because its failure
> mode survives the redesign exactly: a kids' club that never opens the setting
> collects adult-style signatures for minors and nobody finds out until it
> matters. `mayIncludeMinors` renders **inline** in `WaiverSettings.tsx` — not
> behind "advanced", not collapsed — with one line stating what leaving it off
> means, and that file's header argues why it must not move behind a disclosure.
>
> ---
>
> *The decision as originally written, kept for its reasoning:*
>
> Against the recommendation (`if_minor`). Accepted: the common case is an
> adults-only studio, and a date-of-birth field on the acquisition path is a real
> conversion cost for a guard most tenants never need. **Q17 is closed.**
>
> **Consequence that is now a REQUIREMENT.** The failure mode is silent and it is
> the exact scenario the guardian model exists for: a kids' club that never opens
> the setting collects adult-style signatures for minors, and nobody finds out
> until it matters. Since a forced choice was rejected, the guard moves to
> **visibility**: the guardian setting renders inline in the waiver editor — not
> behind "advanced", not collapsed — with one line stating what `never` means.
> A studio may still choose wrong, but not without having read it. §7's authoring
> UI owns this.
>
> The sixteen remaining questions proceed on their recorded recommendations,
> including: Q7's option 3 is **superseded by D2**; Q13 (export before teardown)
> **adopted** — a ledger destroyed with a tenant is the one record a departing
> studio most needs; Q16 (ledger verifier) **adopted**, matching the
> finance-journal precedent; Q4 (kiosk minor) admit-with-chip; Q3's publish
> default is `require_resign`.

Each is a decision this design pass could not make alone, with my recommendation
and the cost of the alternative. None is tidied away.

> **Q1, Q4, Q5, Q8 and Q17 — SUPERSEDED 2026-08-16 (§4).** All five asked how the
> guardian machinery should behave. It was removed in full, so each is recorded
> below with the outcome it actually reached rather than left reading as an open
> question about live code. Q1 was **narrowed out and stayed narrowed out**; the
> other four are moot in their own terms and are answered instead by
> `mayIncludeMinors` — an unverified self-declaration plus a door-check chip.

**Q1 — the `Guardian[]` type on the contact: narrowed out, or built?**
**OUTCOME: narrowed out, and doubly so.** No `Guardian[]` type was built. With
the machinery that would have populated it gone, the ledger's signer snapshot is
the only record of who signed, and there is nothing to keep a second source of
truth in sync with. Nothing pre-fills a repeat guardian's name — they type it, or
leave it blank, which is ordinary and not an error.

`docs/fareharbor-analysis.md:544-555` settled a distinct `Guardian` type (required
email, cap 2) embedded on the contact. §0.4(b) narrows it out: with the ledger
snapshotting the signer, a freely-editable array would be a second source of truth
for a question the ledger already answers, and the pre-fill it was going to
provide comes from the contact's most recent guardian acceptance instead. **My
recommendation: narrow it out.** The cost if Franco disagrees is one type plus an
editor plus a rule about which one wins when they disagree — and that last part is
exactly the shape-1 defect. **This edits a settled decision, so it needs a yes or
a no.**

**Q2 — the acceptance inside the commit transaction rather than after it.** The
stated prerequisite says "write *after* the booking commits"
(`fareharbor-analysis.md:516-517`). §3.3 writes it *inside* the commit instead,
because post-commit on `bookSession` is the zone where the partner ledger and the
contact alert swallow their own failures, and an acceptance that can fail while
the seat commits is an evidence hole in a compliance feature. It costs one
extra single-document read in the transaction and no contention. **My reading is
that this satisfies the rule's intent more strictly, not less. Confirm.**

**Q3 — the publish chooser's default.** §7.2 defaults a waiver to
`require_resign` and every other kind to `silent`. That puts friction on the
booking path by default, which is the opposite of every other default in this
product — and it is deliberate, because the default is the option most studios
will never change and §5.2 says which one is defensible. **The alternative** is no
preselection at all, forcing a deliberate click every time. **My recommendation:
`require_resign` preselected with the "recommended" label**, because a studio that
does not read the options should land on the safe one.

**Q4 — the kiosk, and specifically: what does the doorway tablet do when the
walk-in is a MINOR?**
**OUTCOME: the question dissolved.** All three of its candidate answers existed
only because a guardian's signature was something the tablet could not obtain on
the spot — it had to wait for an emailed link, on a device with an idle timer.
The tablet now takes the **whole** signature, so the kiosk refuses like every
other rail and the admit-with-chip exception is withdrawn along with
`waiver_state: 'outstanding'`. Nothing is left outstanding anywhere. The
`mayIncludeMinors` chip still prompts the desk to check in person, which is the
part of "admit with the chip" that was actually worth keeping.

*The question as originally written:* §3.7 presents the waiver inline for the ordinary case and
that part is easy — inline and emailed-link are nearly equivalent for an adult
ticking a box at a desk. They are not equivalent for a child. `if_minor` at the
door means the tablet collects a date of birth, then a parent's email address, and
then **waits**, on a device with an idle timer (`useIdleTimer.ts`) that returns to
standby, in a flow (`WalkIn.tsx`) that today collects name/email/phone and funnels
every error into one generic string (`:143-145`). Three coherent answers: refuse
the walk-in and send the parent a link; admit them with an outstanding chip (the
§3.4 claim-rail posture); or require staff to complete it on another device.
**My recommendation: admit with the chip**, consistent with §3.4 and §3.8 — the
kiosk is supervised, and refusing a child at the door over a document is the worst
version of this feature. **This is the question; inline-versus-link for adults is
not.**

**Q5 — age of majority.**
**OUTCOME: withdrawn — there is no age in this feature.** No
`AGE_OF_MAJORITY_YEARS` constant exists, no date of birth is collected by any
waiver path, no age is computed and no verdict is stored. The studio decides who
is a minor, at the door, prompted by the chip. This is the cleanest consequence
of the removal: the hardest question in the original design (whose 18? which
jurisdiction? what about a birthday between booking and class?) turned out to be
one the product should never have been answering.

*The question as originally written:* `AGE_OF_MAJORITY_YEARS = 18`, hardcoded for
Switzerland. A per-team override is one field and one read, and retrofitting it
later is harmless (nothing stored depends on it — the acceptance snapshots the
declared date, not the verdict). **My recommendation: hardcode 18 in v1.**

**Q6 — staff-initiated attendance: close the hole or accept it?** §3.8 cannot gate
the add-participant dialog — the studio writes `participants` directly from the
browser. Closing it means one `bookParticipant` callable and a rules narrowing on
`sessions/{id}/participants`, which is a real change to a path coaches use daily
(and which currently works offline-ish and instantly). **My recommendation: accept
it in v1**, surface it loudly on the roster, and record it in `docs/waivers.md` as
a known hole — but this is the one item where "we have a waiver gate" is not
literally true, so it deserves an explicit answer. **The question is now bigger
than the dialog**: `checkInContact` (§3.10) is a second staff-initiated
attendance path, it *is* a callable, and it is exempted by the same "an override
a human chose" reasoning rather than by impossibility. Whatever is decided here
applies to both, and if a `bookParticipant` callable is ever built the honest
version gates that scanner too.

**Q7 — de-gating Documents hands every Free and Coach tenant a public CMS. Does
that ship as-is?** The individual defects are each named in §0.3; nobody had asked
the compound question, and it is a content-abuse and hosting-cost question rather
than a waiver question. After P4-C, an unverified self-service-signup team with no
payment method can publish world-readable HTML pages under its own slug at
`/public/{slug}/documents/{slug}`, with **no server-side cap** (W-B7:
`maxDocumentsPerTeam: 20` lives in `apps/web/src/plugins/documents/limits.ts` and
is checked client-side; the rule is `hasTeamRole(teamId,'manager')` with no plan
and no count condition), **slugs from `Math.random()` with no collision check**
(W-B12), and **uploaded images world-readable regardless of draft status** (W-B6).
Today's plugin gate is the only reason none of that is reachable.

Three options, and the third was not in the draft's set:

1. **Ship as drafted**, fix later. Cheapest diff, largest exposure.
2. **One `createDocument` callable** with a server-side per-plan cap (e.g. Free 3
   / Coach 5 / Studio 20) and a collision-checked slug — fixes W-B7 and W-B12
   together.
3. **De-gate Documents for INTERNAL use on every plan** — the signup-consent and
   waiver paths, which is all waivers actually need — **and keep the
   `isPublic`/public-page toggle at Coach or Studio.** No public surface widens at
   all, §6.3's Population B problem shrinks to nothing, and W30 becomes
   unnecessary.

**My recommendation: option 3**, because waivers need the *feature* de-gated and
not the *public page*, and it is the only option that lands §6 without widening
anything. **And a one-way-door warning that belongs with the answer:** once Free
tenants have authored documents, the plugin gate cannot be reinstated without
deleting or orphaning their content. Pre-launch, with only seed data, is the last
cheap moment to choose.

**Q8 — should the guardian link be able to complete the booking?**
**OUTCOME: moot — there is no link and no second signature to wait for.** The
person at the keyboard completes the consent step and declares who they are, so
the booking never splits into "ticked" and "completed" and the deferred-booking
machine this question was circling was never built. The conversion cost it named
went to zero rather than being engineered around. What replaced it is weaker as
evidence and the docs say so plainly: the declaration is unverified.

*The question as originally written:* Today (§4.3) the
parent must open their mail *before* the booking completes, and the booking is not
held. Carrying the booking intent on the guardian link would let the tick finish
the booking — a much better parent experience and a genuinely new machine
(a deferred booking with its own deadline, which is the thing §0's governing rule
and Phase 2's single-deadline rule both push back on). **My recommendation: not in
v1**, with the conversion cost named rather than engineered around. **This is the
question most likely to come back from a kids' club.**

**Q9 — should images be forbidden in a waiver body?** A version snapshot freezes
the HTML, not the images it references (§5.2), and W-B6 makes those objects
world-readable regardless of draft status. Forbidding `<img>` in a `kind: 'waiver'`
body is one validation and removes a whole class of "the text changed and the hash
did not". **My recommendation: warn in v1** (as §7.2 specifies), forbid if the
warning turns out to be ignored — but forbidding now is cheaper than forbidding
after studios have images in their waivers.

**Q10 — the Documents route move.** §6.2 item 12 moves `/plugins/documents` to
`/documents` with a redirect shim. It is cosmetic, costs `typedRoutes` casts and
i18n `Nav` churn, and is the kind of change that is much cheaper now than after
studios have bookmarked the page. **My recommendation: move it**, since a default
feature under `/plugins/` reads as a bug.

**Q11 — should a member be able to revoke their own signature?** §9 P4-K makes
revocation manager-only. A member revoking their own waiver is coherent (it is
their consent) and immediately blocks their own bookings, which is either honest
or a support ticket depending on how it is framed. **My recommendation: manager
only in v1**, with the member's Space showing the state and a "contact the studio"
line.

**Q12 — `validityMonths`: is time-limited consent a launch feature at all?** The
ledger expresses expiry because the brief requires it to, and the config field is
one number. No studio has asked for it. **My recommendation: ship the field,
default null, and leave the admin control out of v1** — the mechanism is what was
required; the UI can wait for the first request. **One constraint the field now
carries**, because §1.4 changed under it: the validity in force is **frozen onto
each signature** (`validity_months_at_signing`, `valid_until`), so changing the
number governs future signatures only. If a studio must ever re-date *existing*
ones, that has to be a publish outcome with its own version and its own line in
§7.2's chooser — never a field edit. Confirm that is the intended semantics before
any admin control is built on top of it.

**Q13 — what happens to the acceptance ledger when a studio leaves?**
`TENANT_DATA_COLLECTIONS` sweeps `documents` by `teamId` and per-team teardown
uses `recursiveDelete`, so deleting a team destroys **every signature it ever
collected**, with no export step anywhere in the teardown path. §1.2 originally
deferred this as "production teardown is a separate operation", which is true and
is not an answer: a liability release is the one artefact a studio needs *after*
the relationship ends, and the window over which it is needed is measured in
years, not in account lifetime. Options: an **export-before-delete gate** in the
teardown path; a **retention carve-out** that preserves `acceptances` and
`versions` under a separate lifecycle; or an explicit "you are deleting your
evidence" confirmation and nothing more. **My recommendation: the export gate** —
it reuses P4-L verbatim and costs one step. **This is much cheaper to decide while
the only data is seed data than the first time a churned studio asks for its
waivers.**

**Q14 — do EVENTS want a waiver, and when?** §3.10 exempts
`handleEventInvitationResponse` and `addEventCheckin` with a stated reason (an
Event is a different primitive: no `Session`, no `Activity`, and `WaiverApplies`
has no arm that can name one). But events are the seminars, competitions and open
days a release is *most* often demanded for, so the exemption is uncomfortable. It
is a third `scope` arm plus an events surface, chip and report — a phase, not a
row. **My recommendation: exempt in v1 and say so in `docs/waivers.md` in the
studio's own words**, so no one infers coverage from "every booking entry point".
**Confirm that is acceptable for launch**, because a studio running a Saturday
open-mat will hit it immediately.

**Q15 — should `SignupForm`'s birthdate field just be deleted?** §4.5 reconciles
the double-ask by having the signup rail's waiver step read the in-flight form
value. Deleting the field instead would make the waiver step the single ask on
that rail too, matching Decision 6's shape exactly rather than working around an
exception. **My recommendation: keep it and reconcile** — it is an existing
optional profile field studios may rely on, and removing it is a data decision
rather than a waiver one. **One line either way.**

**Q16 — who runs the ledger verifier, and on what schedule?** §5.4 adds
`scripts/verify-waiver-ledger.ts` (hash integrity, signer↔event backing,
policy↔document agreement, the no-unversioned-published-document invariant),
because the finance journal's precedent has a checker and an alarm and this phase
inherited only the convention. The open part is cadence: **scheduled** for one
document per team (cheap, turns silent corruption into an alarm, but adds the
first scheduled entry this phase has) versus **pre-release only** (no scheduled
entry, no alarm). **My recommendation: pre-release plus on-demand in v1**,
because W13's spirit is worth keeping and there is no corruption vector until
somebody runs an Admin-SDK migration.

**Q17 — should `guardianRequired` be a REQUIRED, unpreselected choice in the
waiver create dialog?**
**OUTCOME: closed by D3, then emptied by §4.** The setting is gone, so there is
nothing to make a required choice OF. The tax this question was written about —
a date-of-birth field on every first-time guest booking — is now zero for
everybody, because no waiver path collects a birthdate at all.

Two things it argued for **did** survive, in the place that still has a choice
worth making. The **self-declaration** on the consent step is required and has
**no preselection** (`WaiverStep.tsx`: two radios, neither checked; the Confirm
is gated behind `waiverSatisfiedLocally`, which returns false until one is
picked) — exactly the "unpreselected, each with its consequence" shape
recommended here, applied to the visitor's choice rather than the studio's. And
the studio-side flag renders **inline** rather than behind a disclosure, which
was D3's answer to the same worry.

*The question as originally written:* With `if_minor` as the default and no booking rail
collecting a birthdate (§4.5), the **default-configured studio adds a date-of-birth
question to every first-time guest booking** — a full field, on the acquisition
path, for every studio that never finds the setting. §4.5's table promises "an
adults-only studio pays zero age questions" against `never`, but nothing makes
that studio choose it: the tax is opt-out. This is the same argument §7.2 Q3 makes
for the publish chooser, applied to the setting that actually sits on the
conversion path. **My recommendation: make it a required choice at creation**,
three radios, no preselection, each with its one-line consequence — a studio that
does not read them cannot proceed, which is the correct outcome for the only
setting here that taxes every visitor.

**Q18 — is three required waivers a coherent product, and what does the step look
like at the cap?** `MAX_REQUIRED_WAIVERS_PER_TEAM = 3` × `MAX_WAIVER_BODY_CHARS =
50000` is the real worst case: three 50k-character documents rendered inline on a
phone between "details" and "confirm". The gate's **read** cost is bounded and
stated; the **reader's** cost is not, and §7.3 specifies only "a step of its own".
Whether three required waivers is even coherent — versus one document with three
sections — changes whether the step is one scroll-and-tick or a sub-flow with its
own progress. **My recommendation: keep the cap at 3 but build the step for ONE**,
rendering additional waivers as sequential sub-steps with a "1 of 3" affordance,
and revisit if any studio ever needs the second. **Worth deciding before the step
is built, not after.**

**Q19 — should the notice worker's per-signer send be batched by Brevo template
rather than serial?** §2.5 costs a 400-signer `notify` at 400 serial provider
calls across several worker invocations, which is unavoidable **given constraint 3
of §2.3** (one message to N recipients is one `mail_sends` row and one
`provider_message_id`, so a batch makes per-recipient deliverability structurally
impossible). Brevo's batch endpoint with per-recipient message ids would change
that arithmetic, at the cost of a second send path in `mailService`. **My
recommendation: serial in v1** — it is correct, it is the shape the rest of the
system uses, and the worker's cursor makes the duration irrelevant. Recorded
because "why does publishing take four minutes" will be asked.

---

## 11. Explicitly out of scope

| Item | Reason |
|---|---|
| A `Guardian[]` type on the contact | §0.4(b), §10 Q1. The ledger's signer snapshot is the record |
| Any waiver arm in `resolvePaymentOptions` | A waiver has no price. W21 makes the absence checkable |
| A reserve → commit → release lifecycle | §0's governing rule. A signature is not a scarce resource |
| Any counter of signatures beyond `rounds` | §8.1 shape 2 |
| A sweep job for expiry, supersession or guardian requests | Lazy, as gift-card holds and promo reservations already are. W13 |
| Blocking staff class bookings | §3.8, §10 Q6. No server seam exists; surfaced, not blocked |
| **A waiver on EVENT attendance** (`handleEventInvitationResponse`, `addEventCheckin`) | §3.10, §10 Q14. An Event is a different primitive with no `Session` and no `Activity`, and `WaiverApplies` has no arm that can name one. **Exempted with the reason stated, and `docs/waivers.md` tells the studio so** — the exemption is as explicit as the inclusions (§8.1 shape 5) |
| A gate on `rebookSession` | §0.5(c). A rebook moves an existing seat and creates no new attendance relationship; gating it was stricter on the reversible operation than on the irreversible one |
| A booking held while a guardian signs on the **waitlist-claim** rail | §3.4, §0.5(e). The claim completes and the link is emailed after; the booking carries `waiver_state: 'outstanding'` and the roster shows it. **The one rail that produces a committed booking with an outstanding waiver without a staff member choosing it** |
| Retention of acceptances after a team is deleted | §1.2, §10 Q13. Teardown destroys them today and this phase does not change it |
| A mobile waiver step | §3.9. `apps/mobile` mirrors shapes locally rather than depending on `@linyup/shared`, so it is a port, not a call-site edit. The refusal is made legible; the step is not built |
| A waiver on shop purchases | §7.3. Buying is not attendance; the waiver is taken at the first booking |
| Sweeping orphan signer rows left by purged provisional contacts | §3.3. Small, bounded, and sweeping risks deleting live rows |
| Drawn or typed signatures, second factors, ID checks | Decision 4: click-wrap, chosen for the lowest conversion cost. §5.2 states what that is worth |
| Verifying a declared date of birth | §5.2. It is a declaration and the field name says so |
| Freezing images referenced by a waiver body | §5.2, §10 Q9. Warned, not solved |
| Per-jurisdiction age of majority | §10 Q5 |
| Member self-revocation | §10 Q11 |
| A `validityMonths` admin control | §10 Q12. The field ships; the UI does not |
| A booking held while a guardian signs | §4.3, §10 Q8. It would be a new deadline on a seat |
| Retiring `Contact.consent` | P4-Q deprecates it in place; removal is a follow-up once no reader remains |
| Fixing W-B6, W-B7, W-B12 | §0.3. Named, on lines this phase does not rewrite |
| A PDF renderer for the export | HTML + JSON in v1; PDF is a dependency decision, not a waiver decision |
| Notifying a studio that someone's waiver expired | No email, SMS or push on any waiver event except the `notify` publish and the guardian link. §8.1 shape 4's rule, applied narrowly |

---

## 12. Whole-phase verification checklist

Every line is a gate.

- [ ] `pnpm typecheck` · `pnpm lint` (0 errors) · `pnpm build`.
- [ ] `pnpm --filter @linyup/functions test` — at least the baseline measured at
      `129a8c9` before the first commit, 0 failing, and the new
      `waiverState.test.ts` matrix green.
- [ ] **The price pipeline is untouched (W21):** `git diff` on
      `packages/shared/src/utils/paymentOptions.ts` and
      `packages/functions/src/booking/paymentOptions.test.ts` is **empty**, and
      `grep -rn "waiver" packages/functions/src/connect/checkout.ts` returns only
      the two rate-limit bucket constants.
- [ ] **No reservation machinery (W1):** no `reserve`, `release` or `hold`
      **identifier** appears in `packages/functions/src/waivers/`. Asserted in
      `waivers/gate.test.ts`, which strips comments and string literals first.
      **The earlier form of this line — a bare
      `grep -rniE "reserve|release|hold"` — was already false the day it was
      written**, because the area's prose is full of "liability *release*", "the
      row *holds* the answer" and "a *household* mailbox"; W1's own wording in
      §8.2 says *identifier* and is the correct claim. A check that cries wolf on
      the first run is a check nobody runs twice.
- [ ] **One writer of `rounds` (W1, shape 2):**
      `grep -rn "rounds" packages/functions/src apps/web/src` shows exactly one
      write site, and `grep -rn "rounds: FieldValue.increment"` is empty.
- [ ] **One predicate (W10):** `grep -rn "min_valid_version" packages apps` shows
      it read only by `waiverAcceptanceState`, the publish callable and the policy
      write.
- [ ] **The version is immutable (W4):** publish twice; the first version document
      is byte-identical afterwards. `body_hash === sha256(bodyHtml)` for every
      version, by script. From the Admin SDK, mutate a version and confirm the
      export prints a mismatch (W22).
- [ ] **Deletion is closed (W2, W3):** in the rules emulator, as owner AND as
      manager — delete a published document (denied), delete an unpublished draft
      (allowed), update a `kind: 'waiver'` document (denied), write
      `current_version` on any document (denied), write
      `teams/{t}/waiver_policy/current` (denied), write any of
      `versions`/`acceptances`/`signers`/`guardian_requests` (denied).
- [ ] **There is exactly one publisher (§2.1, P4-E):** in the rules emulator, as
      owner AND as manager, update a `draft` document to `status: 'published'` —
      **denied**; edit the title of an already-published document — allowed;
      unpublish it back to `draft` — allowed. The admin surface has no control
      that writes `status: 'published'`, and the publish chooser offers **two**
      outcomes, not three (§10 D1).
- [ ] **`require_resign` is O(1) (W13, §2.2a):** publish it over a document with
      many signers → **zero** signer-row writes, one document field moves, and
      every signer's state reads `superseded` immediately and consistently.
- [ ] **The re-signing round trip (§1.4.1):** accept → revoke → accept → a
      `require_resign` publish → accept. Four accepted events plus one revoked
      event exist, all immutable; the signer row's `rounds` is 3 and its status is
      `active`; the gate refuses at exactly the two points it should and nowhere
      else.
- [ ] **The precedence rule (§1.4.1, W8):** mint a guardian request for v4;
      publish v5 `require_resign`; re-sign v5 from the member's own account; then
      redeem the v4 request. The **event row exists** and the signer row still
      reads `accepted_version 5` — the late acceptance did not downgrade it.
      Separately: revoke at T, land an acceptance that read the row before T →
      the revocation survives. **Every signer write is inside a transaction on
      every rail, including the paid ones.**
- [ ] **Idempotent submit inside a transaction (W28):** call `bookSession` twice
      with the identical `{documentId, version, contactId, intentId}` → one
      acceptance event, **two successful responses**, no aborted commit. Then book
      a second class from the same mounted flow without re-resolving → it
      succeeds. `grep` shows no gRPC-6 catch inside any `runTransaction` in
      `packages/functions/src/waivers/`.
- [ ] **Every published document has a version (W29):** after Group A,
      `documents where status == 'published' && current_version == null` is
      **empty**; a legacy terms document's public page still renders after its
      next write; and a backfilled v1 is labelled retroactive in the export.
- [ ] **A client cannot CREATE its way past W3 or W29:** as a manager, `setDoc` a
      new `documents/{id}` carrying `status: 'published'` → **denied**; carrying
      `current_version: 1` → **denied**; carrying `min_valid_version: 1` →
      **denied**. The editor's own create (status `draft`, neither pointer) still
      succeeds. This is the create half of the same rule the update clause
      enforces, and it was missing.
- [ ] **A documentId is not an oracle:** call `updateWaiver`, `setWaiverRequirement`
      and `archiveWaiver` **unauthenticated** against a real waiver id → each is
      refused `unauthenticated` **before** any document read, so no caller learns
      that the id exists or that it is a waiver. Then call them as a manager of a
      DIFFERENT team → `permission-denied`, never `not_a_waiver`.
- [ ] **Expiry (§1.4):** with `validityMonths: 12`, an acceptance 13 months old
      reads `expired`, is refused, and re-signs cleanly. **No job ran.**
- [ ] **The gate refuses before any contact write (W7):** on each rail in §3.2,
      force `waiver_required` → no contact created, no funnel stamp, no
      `trial_used_at`, no acceptance. On `createDropInCheckout` specifically,
      confirm the check runs above `dropIn.ts:411`.
- [ ] **The acceptance is atomic with the seat (W8):** force the acceptance write
      to throw inside `bookSession`'s transaction → **no booking exists** and
      `bookings_count` is unchanged.
- [ ] **The two auto-submit paths (§7.3, P4-M) — the phase's most likely silent
      misses.** (a) As a **member on a gated class** in `BookingForm`, the waiver
      step renders **before** `bookSession` is called — the path that never renders
      `details`. (b) As a **covered member on an appointment**, the
      `autobooking` screen presents the step instead of calling `book()` on
      verification. Test the cost correctly: a decline must not force the caller
      back to the email step, because `verifyBookingCode` refuses a used code
      (`booking/index.ts:222-223`) and re-requesting is capped at 3 per hour
      (`:116`). **Do not test it by re-calling `bookSession` with the same
      `codeId` — that succeeds today** (the callable never re-checks `used`), and
      concluding from it that the hazard is imaginary is exactly how this step gets
      skipped (§3.2).
- [ ] **Mid-checkout publish (§3.6):** open the step, publish `silent`, submit →
      recorded against the version shown, valid. Repeat with `require_resign` →
      refused `waiver_version_changed`, the surface re-presents, the second submit
      **completes**. A refusal that cannot be acted on is a failed test.
- [ ] **The claim (§3.4):** a queued member with a required waiver claiming an
      offer sees the waiver **inside** the claim window, ticks, and claims. The
      claim deadline is byte-identical to a claim with no waiver (W14). The
      payable claim does **not** re-prompt after the drop-in hop.
- [ ] **The claim's GUARDIAN case (§3.4, §0.5(e)):** a queued **minor** claiming
      an offer on an `always` waiver — the claim **completes**, the seat is taken
      inside its own single deadline, the booking reads
      `waiver_state: 'outstanding'`, the roster and the printed sheet show the
      chip, and the guardian link is minted after the commit with 72 hours and no
      seat behind it — **to the address the claim page collected, and to no other:
      with none collected, nothing is sent and the chip carries it.** A link
      mailed to the child's own address would stamp `emailed_link` on a claim of
      *guardian* mailbox control. **The entry's one offer is not consumed by a
      document nobody could sign in time**, and a failure to mail cannot undo the
      committed seat.
- [ ] **`joinWaitlist` asks for nothing.**
- [ ] **The gate's coverage, per §3.2 and §3.10:** an unsigned member scanning the
      kiosk QR is refused by `selfCheckIn` with a legible message on both the
      mobile and kiosk surfaces. `rebookSession` is **not** gated. **A coach
      scanning that same unsigned member's QR with `checkInContact` succeeds**,
      and the roster shows the chip. Event attendance is **not** gated, and
      `docs/waivers.md` says so.
- [ ] **The census cannot silently go stale (§3.10):** `waivers/gate.test.ts`
      re-derives the caller set from the source, so a new rail that wires the
      gate in correctly and is never added to the list **fails the build** —
      which is the failure that cost Phase 3 three rounds, in its exact shape.
- [ ] **The guardian binding (W11, W12, W26, W27):** the address the mail was sent
      to is what lands in `signer_email`; typing a different address on the
      signing page changes nothing. **A mother using her own address for her
      9-year-old books successfully**, and the acceptance carries
      `guardian_address_same_as_subject: true`. **Minting a request for A and
      redeeming it against a booking for B is refused**
      (`waiver_guardian_subject_mismatch`) and writes nothing. **One tick produces
      exactly one acceptance event** on both the contact-exists and
      contact-created paths. `grep -rn "token.email" packages/functions/src/waivers/`
      is empty. **The signing page has no name or address field at all** — one
      control, and it is the tick — and the tick callable's payload carries no
      identity of any kind. **The tick writes its request document exactly once
      per transaction**: Firestore refuses a second write to the same document in
      one commit, and the failure would take the signature with it.
- [ ] **Guardian single-use, ambiguity and RESUME (W15, §4.3 step 6a):** click the
      link twice → the second is refused with the same message an expired link
      produces. Let one expire → identical message. Give a DIFFERENT address and
      then click the first link → identical message again (it was voided, and
      that must not be distinguishable either). **Close the booking tab, clear
      every trace of it, return the next day and re-enter the flow → the same
      request resumes rather than a second one being minted and a second mail
      sent** — there is no `poll_token` to lose, which is the point of §4.2's
      narrowing. Hit the per-subject daily cap → the refusal names when it
      resets.
- [ ] **Guardian bounce, every moment (§4.6):** (a) a suppressed address is
      refused at mint, before anything is written; (b) a `silent`-policy tenant
      marks the request `undeliverable` immediately, not after a timeout; (c)
      with `MAIL_ENABLED=false` the reason recorded is `not_sent_env`, an
      operator fact, and never a bounce; (d) a provider failure records
      `send_failed`, so the surface offers *send again* rather than *use another
      address*; (e) a hard-bounce webhook flips a **pending** request to
      `undeliverable` and the polling step shows it, while a **soft** bounce and
      an already-**signed** request are both left alone — and the request keeps
      its token, so a guardian holding the link can still tick.
- [ ] **The date of birth is asked once (§4.5):** an `if_minor` waiver on a guest
      booking asks inside the step, with the reason visible; the answer is written
      to the contact by the same call that records the acceptance; a second
      booking never asks again; `AccountHome` still has exactly one birthdate
      control. **The member's Space asks it too**, because Space is where the
      door-side refusals send people: an `ask_birthdate` row there renders the
      date question and NOT "a parent or guardian must sign this one" — that
      sentence is untrue before the age is known and leaves the member with no
      control to press.
- [ ] **The declared date comes from a submission the gate CONSUMED:** send
      `bookSession` a waiver payload carrying a real, ticked submission for the
      required document plus one extra row naming a `documentId` this team does
      not require and carrying a different birthdate → the booking's acceptance
      and the contact both record the date from the **required** document's row,
      and the decoy's date appears nowhere. Driven as fixtures over
      `declaredBirthdateFrom` in `waivers/deadEnds.test.ts`; the same helper is
      the only reader on both `enforceWaiverGate` and `signWaiverInSpace`.
- [ ] **An empty requirement list is never mistaken for "nothing required":**
      make `resolveWaiverRequirement` fail (throw, or refuse `rate_limited`) on a
      tenant that DOES require a waiver → the step renders its error state, the
      surrounding **Confirm / Claim / Register is disabled**, and pressing it
      books nothing. The error state carries a **Retry** that re-resolves and,
      on success, hands the visitor the real step. This covers the deferring
      rails too, which used `waiverDeferredReady(items, ticks)` directly —
      `true` over an empty list.
- [ ] **A stale-empty mirror is recoverable, on every public surface:** with the
      policy live and `TeamPublicProfile.required_waivers` emptied by hand, book
      from `BookingForm` (guest **and** returning member), `AppointmentPicker`
      (guest, autobooking, member-pay), the waitlist claim, the kiosk walk-in and
      signup → each is refused **once** by the server and then **presents the
      step**, rather than printing a sentence with nothing behind it. The gate is
      forced live for the tenant from that point, and `reset()` does not undo it.
- [ ] **The walk-in banner is true when it is read (§3.7):** on an **unpaired**
      tablet, reach a guardian requirement with no address typed → the desk copy
      asks for the parent's details and does **not** claim a link was emailed.
      Type an address and send → it then reads "we have emailed them". On a
      **paired** tablet the register-now promise is unchanged.
- [ ] **Mobile refuses legibly on every rail it can be refused on (§3.9):** an
      unsigned member booking a class from the agenda card **and** from the
      attendance calendar gets a sentence naming the document, not "Failed to
      book session. Please try again." The verb matches the rail — "book" there,
      "check in" on the scanner.
- [ ] **`never` costs nothing, and it is the DEFAULT (D3):** a freshly created
      waiver asks zero age questions, and `defaultWaiverConfig()` says so.
      **`always` asks none either.** The guardian control renders **inline** in
      the waiver editor with the line stating what `never` means — D3's required
      consequence, and the only guard against a kids' club collecting adult-style
      signatures for minors.
- [ ] **Notice deliverability, per recipient (W18, W19, W20):** a `notify` publish
      over a mixed cohort — one delivered, one hard-bounced, one soft-bounced, one
      suppressed, one unsubscribed, one with no address, one with no webhook, and
      **one who signs the day after the publish** — produces distinct notice
      states, and the report's **four** buckets partition the **signer set**
      exactly as §2.4's table says, with nobody unbucketed. **A `sent` row must not
      appear in "No valid notice"**, and **a policy drop or `MAIL_ENABLED=false`
      must not either** — they belong to "Not sent by us".
- [ ] **The notify worker completes past one chunk (§2.3, §0.5(g)):** publish
      `notify` over **more signers than `WAIVER_NOTICE_CHUNK`** → every signer ends
      with a notice row, the job reads `done`, and no signer is silently dropped
      at a ceiling.
- [ ] **The webhook cannot lose the race (§2.3):** deliver a `hard_bounce` webhook
      for a notice **before** its ledger write would have been stamped by a second
      write → the report still classifies that recipient under "No valid notice".
      Then break the fan-out entirely and confirm the report **still** classifies
      correctly, from `mail_sends/{noticeId}` and `isSuppressed` at read time.
- [ ] **Notices survive the next publish (W18, §1.2):** publish v4 `notify`, record
      a bounce; publish v5 `notify`; **v4's report is unchanged and still names the
      bounced member**, and the version-history row for v4 links to it.
- [ ] **The resend actually sends (W18):** resend to the delivered recipient →
      a new notice row at `attempt + 1` and a new `mail_sends` row with a distinct
      key, not an idempotent skip. The first attempt's row is **unchanged**.
- [ ] **The webhook stays a good citizen:** replay a `delivered` event → idempotent;
      make the fan-out throw → the webhook still returns 200.
- [ ] **De-gating (§6):** uninstall/downgrade a seeded team → its document mirrors
      **survive**, `signup_documents` stays populated, and the booking gate keeps
      resolving. `grep -rn "deleteAllDocumentPublicProfiles" packages/` is empty,
      and `grep -rn "documents plugin" packages/shared/src` is empty (§6.2 item 14).
- [ ] **The config move (§6.3):** save a signup-consent selection and read it back
      in the same session, on a team migrated and a team not yet migrated. **This
      is the W-B14 check** — without `match /settings/{settingId}` it fails with a
      permission error, not silently.
- [ ] **Free tiers cannot borrow the domain's search standing (§6.5, D2):**
      fetch `/public/{slug}/documents` and `/public/{slug}/documents/{doc}` **as
      a crawler would** (curl the HTML, do not inspect the React tree) for a Free
      team, a studio team on TRIAL, and a paid ACTIVE team. The first two carry
      `<meta name="robots" content="noindex, nofollow">`; only the third omits
      it. **The trial case is the one that decides whether the mitigation works
      at all** — every self-service signup starts there, and a page only has to
      be crawled once. Then delete `public_pages_indexable` from a paid team's
      mirror and confirm the page falls back to `noindex`, not to indexable.
- [ ] **The surface stays dark until content exists (W30):** take a downgraded
      team with published documents and no mirrors, touch its team document → and
      `active_public_surfaces.documents` is still **false**, so `/public-page`
      neither advertises Documents nor offers it as a default landing surface.
      Run the mirror backfill for that team → it goes live in the same sync.
- [ ] **The audit and the backfill (§6.3):** the audit runs read-only and names
      the flip-live set including downgraded teams; the backfill refuses without a
      typed confirmation and is scoped to named teams.
- [ ] **Plan gate, creation and requiring (W17):** downgrade a Studio team with a
      live required waiver → the gate still blocks, visitors still sign, guardians
      still sign, the report and export still work, the requirement can still be
      turned **off** and the waiver archived, and its settings can still be edited;
      `createWaiver`, `publishDocumentVersion`, `updateWaiver`'s content arm **and
      `setWaiverRequirement({ required: true })`** are refused with
      `reason: 'plan_required'`, and **no visitor-facing surface ever renders that
      message**. Specifically: a Free team that had a waiver published-but-not-
      required **cannot turn it on**.
- [ ] **Fail closed, and unreachable (§1.5):** with the Admin SDK, point the policy
      at a missing version → the booking is refused `waiver_unavailable` (not
      booked) and the Documents page shows the banner. Then confirm no client path
      can produce that state (W2, W3, W5).
- [ ] **Cost of the gate on a team with no waivers:** exactly one extra document
      read per booking, and no added query inside the commit transaction.
- [ ] **The export (W22):** a member with a revocation, a re-sign, a guardian
      signature and two `silent` versions exports an artefact in which the full
      text of each accepted version is present, the hashes verify, and the
      `silent` versions are visibly marked as changes they were never asked about.
      The member's own Space download returns their history and **nobody else's**,
      and omits the identity-key section.
- [ ] **The export is complete across duplicate contacts (§5.3):** the same human
      under two contact ids (a name-spelling variant defeats the email+name guest
      match) exports **both** histories, in **two clearly separated sections**.
      Then: a mother and child on one household mailbox — their records appear in
      the labelled "other records for this email address" section with
      `contactId`, `subject_name` and `signer_role` on every row, **never merged
      into one person's narrative**.
- [ ] **The ledger verifier (§5.4):** `verify-waiver-ledger` passes on clean
      seeded data; then, via the Admin SDK, break one version's `body_hash`, one
      signer row's `acceptance_id`, and one policy entry's `current_version` — it
      exits non-zero and names all three, and the export prints the mismatch
      **together with the stated next step**.
- [ ] **The manifest prints (§7.4):** print to PDF in a browser with background
      graphics off → the waiver chip is legible, sessions do not split
      mid-roster, and no extra column appeared.
- [ ] **No full-contacts query was added** to `/sessions/[id]` or `/manifest`.
- [ ] **Space (§7.5):** a `require_resign` publish makes the banner appear for a
      signed-in member who is not booking. No fifth nav tab.
- [ ] **`completeSignup` (P4-Q):** a signup with two attached documents writes two
      acceptance events with real version numbers and `source: 'signup'`; the old
      `Contact.consent` blob is still written and is labelled deprecated on the
      type.
- [ ] **Abuse limits — one model, `packages/functions/src/waivers/limits.ts`.**
      The line this checklist used to carry ("the 31st `resolveWaiverRequirement`
      call from one IP is refused") described a limiter that had to be removed:
      it is the doorway lockout, and a 30/hour ceiling on the one read a booking
      is a precondition of meant a gym, a school or a kiosk running an evening of
      walk-ins could not book anything. Check the model instead, in four parts:
      - a mint flood from one IP to one address → **3 messages**, then refused;
        spread across a thousand addresses at one team → **60**; varying the
        claimed child's name changes nothing, because the counters are keyed on
        the address being mailed and on the team, not on the subject;
      - 200 walk-ins in an hour from ONE address, two identity calls each, all
        succeed; the studio's **paired** tablet and every signed-in member spend
        no counter at all, and `createDropInCheckout` from that IP still works;
      - a caller supplying **no** identity is never charged, and one supplying an
        address gets the **identical** answer whether it addresses a whole family
        here or nobody — there is no `ambiguousCaller` field on either side of
        the wire;
      - the mint charges its attempt on **every** arm, the successful one
        included; the signing link's read and tick still peek-then-charge, on a
        different bucket, so spending the mint's hour cannot cost a parent the
        link they were already sent.
- [ ] **i18n (W25):** identical key sets across all four `messages/*.json` in
      `Waivers`, `Waiver`, `Documents` and `Nav`; every §3.5 reason has a string.
- [ ] **Reserved slugs (W-B9):** `waiver`, `documents`, `waitlist`, `forms` and
      `kiosk` are all reserved, and a team cannot claim one. The census owner for
      live segments is `PublicRouteParams`; `guardian.test.ts` asserts the
      reserved list against it, because that is the drift that made four live
      routes claimable.
- [ ] **Indexes: two COMPOSITE collection-group indexes and one
      COLLECTION_GROUP-scoped single-field override.** The composites are both on
      `acceptances` — `contactId ASC, accepted_at DESC` and
      `identity_key ASC, accepted_at DESC`. The second is **mandatory** (§5.3): the
      export is incomplete without it, and "optional" was how the first draft made
      an evidential artefact quietly lossy. No `public_profile` index is added,
      because §1.3 withdrew the `listed` flag that would have needed one.

      > **CORRECTION, found while finishing: the earlier form of this line said
      > "exactly TWO", and one query had no index at all.** The bounce fan-out
      > (`markGuardianRequestsUndeliverableFor`) runs
      > `collectionGroup('guardian_requests').where('guardian_email_hash','==',…)`
      > under a comment claiming "the automatic single-field index already serves
      > it". It does not: automatic indexing is **COLLECTION-scoped**, and a
      > FILTERED collection-group query needs a COLLECTION_GROUP-scoped index or
      > it fails at runtime. Only an unfiltered `collectionGroup(x).get()` is
      > free. This repo's every other collection-group token lookup carries a
      > `fieldOverrides` entry for exactly this reason — `waitlist.offer_token`,
      > `bookings.booking_token`, `participants.contact` — so the shape was
      > established and the new query simply missed it.
      >
      > The bug it would have caused is quiet in the worst way: the emulator
      > serves the query happily, so nothing fails locally, and in production it
      > throws inside a webhook that swallows its own errors — the address goes
      > dead, every pending guardian link for it stays `pending`, and a family
      > waits for a message that will never arrive. Added as a `fieldOverrides`
      > block on `guardian_requests.guardian_email_hash`; the comment now states
      > the rule rather than the wrong reassurance. The scoped-to-one-document
      > lookups (`sign_token`, `subject_identity_key`) are plain COLLECTION
      > queries and need nothing.
- [ ] **No count-assertion (W24):** review the diff for any comment or doc line
      asserting a count of an enumerable set; each must name a census owner
      instead.
