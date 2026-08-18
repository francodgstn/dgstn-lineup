# Seed alignment — the Phase 1 audit

Four seeders (`scripts/seed-{emulator,lead,sandbox,staging}.ts`, ~430 KB total)
plus the HMD migration passes all answer the same question — "what does current,
correct tenant data look like?" — and have drifted apart independently, because
they share almost nothing but `scripts/lib/roles.ts`.

**The expensive part is not writing seed code. It is establishing the schema
truth ONCE.** Do it inside four sessions and you get four interpretations, which
is the drift you set out to remove. So Phase 1 produces a document, not code.

What follows is the prompt for that audit, written to be pasted into a fresh
session. It leads with `ultracode` because the fan-out is the point.

Parked 2026-08-19 while the go-live readiness work ran
(`docs/launch/readiness-2026-08.md`). Nothing here has been started.

---

# Phase 1 — seed coverage audit (paste into a fresh session)

ultracode

Audit how far our five data-authoring surfaces have drifted from the current schema.
**Analysis only — write no seed code, fix nothing, run no seeder and start no emulator**
(another session may hold the emulator ports). The single deliverable is
`docs/seed-truth-2026-08.md`.

## The five surfaces

| Surface | Entry point |
|---|---|
| emulator | `scripts/seed-emulator.ts` |
| sandbox | `scripts/seed-sandbox.ts` |
| staging | `scripts/seed-staging.ts` |
| lead | `scripts/seed-lead.ts` + `scripts/leads/types.ts` (+ gitignored `scripts/leads/*/profile.ts` if present) |
| migration | `scripts/migration/passes/*` + `scripts/migration/transforms/*` |

They share almost nothing (`scripts/lib/roles.ts`, and `lib/storefront|connect|exportConsentLedger`
in the lead seeder only), so they have drifted independently against one schema. Finding
*where* is the entire job.

## The spine

`packages/shared/src/paths.ts` exports ~110 `*_COLLECTION` / `*_SUBCOLLECTION` constants.
That list — derived programmatically from the file, not from memory — is the row set.
`packages/shared/src/tenantData.ts` classifies only the top-level ones (tenant / platform /
retired); use it to mark rows as tenant-scoped vs platform, but do **not** use it as the row
set: it deliberately omits subcollections, which is where most recent work landed.

Partition those constants into coherent domains (roughly: contacts & affiliations; sessions,
bookings & waitlist; activities, availability & appointments; courses & purchases; documents,
versions & waivers; payments, promo codes & gift cards; finance & accounting; team config,
plugins, integrations & messaging; events; org & platform). One agent per domain. **The union
of the partitions must be all ~110 constants — assert that, and log any constant no agent
owned.**

## Per row, answer

1. **Present in each of the five surfaces?** `PRESENT` / `MISSING` / `PARTIAL` / `N-A`.
   Every non-missing verdict needs a `file:line`. Grep for both the imported constant *and*
   the raw string literal — do not read 100 KB seeders end to end.
2. **Field-level gaps** for `PARTIAL`: which fields the app reads but the surface never writes.
   Ground each against the type in `packages/shared/src/types/` and a real reader
   (component, callable, or rule), with `file:line`.
3. **The screen that proves it** — the one admin or public surface that visibly breaks, or
   silently renders empty, when this row is absent. This column becomes the Phase 2
   acceptance checklist, so name a route, not a feeling.

## Also produce

- **Semantic invariants** that aren't collection-shaped. Check seeded data against the
  documented rules in `CLAUDE.md` and `docs/`, at minimum: the waitlist single-deadline rule;
  `bookings_count` written absolute, never incremented; subscription docs carrying the whole
  cancellation record (`cancel_at` / `canceled_at` / `cancellation_details`); contact status on
  the three axes rather than the retired `Contact.type` / `membership_*`; published documents
  having a `v0001` version to copy from; dynamic contact groups holding a rule and never
  materialised membership; appointment activities carrying `durations` + at most one
  `memberBenefit`.
- **Duplication register** — fixtures that appear in three or more surfaces in copy-pasted
  form, with the line ranges. This scopes a later `scripts/lib/fixtures/` extraction; do not
  propose or start that extraction here.
- **Ranked worklist per surface** — ordered by "how visibly broken is the demo", since these
  seeds exist to be shown to people. This is what the Phase 2 sessions will consume.

## Verification

Fan out an adversarial pass over the findings, in both directions, because they fail
differently: a false `MISSING` invents Phase 2 work, a false `PRESENT` ships a broken demo.
For each `MISSING`, hunt for counter-evidence that something does write it. For each
`PRESENT`, confirm the write is reachable — not dead code, not behind an unset flag, not in a
branch the default seed run skips. Drop or downgrade anything that does not survive.

## Constraints

- The working tree has an in-flight waiver-request feature that is **untracked**
  (`packages/functions/src/waivers/request.ts`, `requestEmail.ts`, `trackAcceptances.ts`,
  `consentLedger.ts`, `apps/web/src/components/contacts/AskToSignDialog.tsx`). Mark anything
  depending on it `PENDING`, not `MISSING`.
- `scripts/leads/*/profile.ts` is gitignored. If absent, audit the lead surface against
  `scripts/leads/types.ts` and say so explicitly rather than guessing.
- Follow the repo's own rule on censuses: name members, never assert a count of code sites in
  prose. The matrix is the census — everything else points at it.
- Mark anything you could not verify `UNVERIFIED` rather than inferring it. An honest gap is
  useful; a confident wrong row costs a Phase 2 session.
