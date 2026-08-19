# HMD → Linyup SaaS Migration

Migrates all data from `hmd-lineup` (Firebase prod) into `dgstn-lineup` (Linyup SaaS).

---

## Preliminary steps (manual, do once before running the script)

**1. Get the source service account key** and place it at:

```
keys/hmd-prod-sa.json        ← hmd-lineup production service account
```

To generate the key: Firebase Console → select the `hmd-lineup` project → Project Settings → Service accounts → Generate new private key. Download the JSON and save it as `keys/hmd-prod-sa.json`.

> `keys/` is gitignored. Never commit service account files.

**2. Confirm ranking system IDs** in `scripts/migration/config.ts` (`RANKING_HMD`, `RANKING_KD`).
These map the old single `rank` field on contacts to the new `ranks` map.

The organisation document, org_admin member entry, and Firebase Auth users are all migrated automatically. The **auth-users pass** calls the Firebase Identity Toolkit API directly using the source service account, downloads all user records including password hashes and the SCRYPT hash config, then imports them into the target with `importUsers()` — so users log in with the same password they had in the source project. No manual export step needed.

---

## Migrating into the local emulator (recommended first step)

Start the emulators first:

```bash
pnpm emulators:start
```
It will start all needed emulators, project `demo-linyup`.

Then run against the emulator target — no target credentials needed:

```bash
pnpm migrate:hmd \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-emulator \
  --dry-run
```

Remove `--dry-run` to actually write:

```bash
pnpm migrate:hmd \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-emulator
```

Inspect the result in the emulator UI at http://localhost:4000, then start the dev server and open `/contacts`, `/sessions`, and `/events` to confirm no rendering errors.

**Save the migrated state as a reusable snapshot** (while the emulators are still running):

```bash
pnpm emulators:export:hmd
```

From then on, use `pnpm emulators:hmd` to reload this snapshot instead of re-running the migration.

---

## Migrating into staging / production

**Always dry-run first:**

```bash
pnpm migrate:hmd \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/linyup-staging-sa.json \
  --dry-run
```

**Full migration:**

```bash
pnpm migrate:hmd \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/linyup-staging-sa.json
```

---

## Options

| Flag | Description |
|---|---|
| `--source-creds <path>` | Service account JSON for hmd-lineup source (required) |
| `--target-creds <path>` | Service account JSON for target project |
| `--target-emulator` | Write to local Firestore emulator instead of a real project |
| `--org-admin-email <email>` | Email of the org creator + org_admin (default: `franco.dgstn@gmail.com`) |
| `--dry-run` | Log writes without committing |
| `--only <pass>` | Run a single pass (see pass names below) |
| `--from-team <teamId>` | Resume contacts/sessions passes from a specific team |
| `--verify` | Run verification after migration |

Pass names: `setup` · `auth-users` · `users` · `teams` · `activities` · `session-series` · `contacts` · `sessions` · `events` · `referrals` · `team-subcollections` · `places` · `verify`

**Run a single pass** (e.g. after a failure mid-way):

```bash
pnpm migrate:hmd --source-creds ./keys/hmd-prod-sa.json --target-emulator --only contacts
```

**Resume from a specific team:**

```bash
pnpm migrate:hmd ... --only contacts --from-team <teamId>
```

---

## Verification

Runs automatically at the end of a full migration. To run standalone:

```bash
pnpm migrate:hmd --source-creds ./keys/hmd-prod-sa.json --target-emulator --only verify
```

Checks doc counts (source vs target) for all top-level collections, plus spot-checks 3 contacts per team (goals + subscription_history subcollections).

---

## What is and isn't migrated

| Collection | Action |
|---|---|
| `users` | Copied as-is (Auth UIDs must match — step 4 above) |
| `teams` | Copied + `plan: 'studio'`, `organizationId: 'hmd'` added |
| `activities` | Copied + new fields (`slug`, `type`, `isActive`, `level`) |
| `session_series` | Copied + recurrence field names normalised |
| `contacts` + subcollections | Copied; `rank → ranks.hmd`; `notes` dropped; `type` → acquisition axis (`acquisition_stage`/`entry` + milestone timestamps, `external` → `external` tag); `acquisition.channel` → `source` (+ `source_detail`), `acquisition.acknowledged` → `lead_acknowledged`; membership fields → **affiliations** (see below) |
| `sessions` + participants/bookings | Copied + activity name/type enriched |
| `events` + invitations/attendees | Copied as `scope='org', orgId='hmd', teamId=null` |
| Global `checkins` (event check-ins) | Migrated from the top-level `checkins` collection where `event.id == eventId`; doc IDs preserved; `completed_checkins_count` set on each event doc |
| `referrals` | Copied as-is |
| Team subcollections | Copied from source; **canonical subscription types are seeded** (see below) |
| `coach_availability` / `coach_slots` | **Skipped** — appointments were preview-only; configure fresh |
| Session-level `checkins` | **Skipped** — session-level checkins (docs without `event.id`) are not migrated; the new schema is event-level only |
| `saas_subscriptions` | **Not migrated** — create one per team manually after migration |
| `courses` (Online Courses) | **Not migrated** — net-new in Linyup; create courses in-app post-migration |
| `documents` / `waiver_policy` (Documents & Waivers) | **Not migrated** — hmd-lineup has no equivalent collection (see `firebasePaths.js`); every migrated team starts with zero documents and no waiver policy. This is a safe default, not a gap to fill: the booking gate (`packages/functions/src/waivers/gate.ts`) fails CLOSED on an absent policy, so a migrated team behaves as "no waiver required" until the studio authors one. Studio authors documents/waivers post-migration via `/plugins/documents`; `scripts/backfill-document-versions.ts` only matters once a document exists to backfill, so migration has nothing to run it against. |

---

## Canonical subscription types (pass 11)

Pass 11 (`team-subcollections`) seeds five canonical subscription types into every team's
`subscription_types` subcollection. These are written with `set()` (no skip-if-exists) on
each run, so running `--only team-subcollections` again will refresh them to the latest
prices without touching other existing subscription types.

Seeded types (source: HMD Basel published pricing, confirmed from
`hmdbasel-website-astro/src/content/pricing-plans/en/`):

| id | Name | Prices |
|---|---|---|
| `essential` | Essential | CHF 60/month, CHF 600/year |
| `students` | Students | CHF 70/month, CHF 660/year |
| `unlimited` | Unlimited | CHF 85/month, CHF 840/year |
| `intro_offer` | Intro Offer | CHF 100 one-time (2 months included) |
| `one_time_class` | One-time Class | CHF 25 one-time (1 month included) |

## Subscription contact matching (pass 05, HEURISTIC — validate after run)

During pass 05 (`contacts`), each contact's `subscription_type_name` from the source is
matched to a canonical type by case-insensitive keyword:

- Contains "intro" → `intro_offer`
- Contains "one", "single", or "drop" → `one_time_class`
- Contains "unlimited" → `unlimited`
- Contains "student(s)" → `students`
- Contains "essential" → `essential`

On match, `subscription_type_id`, `subscription_type_name`, `subscription_price_id`,
`subscription_amount`, and `subscription_recurrence` are rewritten to canonical values.
If the source `subscription_recurrence` contains "annual" or "year", the annual price is
used; otherwise monthly. One-time types always use their single price.

If no keyword matches, the contact's subscription fields pass through unchanged.

**The matching is heuristic.** Pass 05 logs matched vs. unmatched counts per team.
Review those counts against the real source data and adjust `KEYWORD_MAP` in
`scripts/migration/transforms/subscriptions.ts` if needed before migrating to staging.

---

## Team subcollections pass-through (pass 11) — verified vs UNVERIFIED

Pass 11 copies `team_members`, `public_profile`, `subscription_types`,
`subscription_transitions`, `outreach_templates`, `automation_rules`,
`team_invitations`, `contact_requests`, `team_alerts`, `alert_presets`,
`leaderboard`, `activity_log`, `team_weekly_reports` (list:
`scripts/migration/passes/11-team-subcollections.ts`); everything except
`team_members`, `team_weekly_reports` and `automation_rules` is written with
**no transform at all**, so it carries whatever shape hmd-lineup's app wrote.

Checked against the hmd-lineup source (`C:\git\hmd\hmd-lineup`) for this pass:

- **`subscription_types` — SAFE, verified.** HMD writes `{name, description,
  source: 'internal'|'aggregator', active, created_at, updated_at}`
  (`hmd-lineup/src/routes/TeamSettings/components/SubscriptionTypesTab/SubscriptionTypesTab.js`).
  Every one of those fields still exists on Linyup's `SubscriptionType`
  (`packages/shared/src/types/contact.ts`), and every field Linyup added since
  (`public`, `order`, `prices`, `checkout_contact_mode`, `limits`,
  `payoutPerVisit`, `introOffer`) is optional with a documented "absent ⇒ …"
  default — `prices` absent literally means "the simple 'just a container'
  flow" per its own doc comment, which is exactly hmd-lineup's shape. No
  reader trusts a stored `id` field either (every read site does
  `{ ...d.data(), id: d.id }`), so the Firestore-assigned doc id round-trips
  correctly. The one soft gap: an `'aggregator'` type migrates with no
  `payoutPerVisit`, so the partner-visit payout ledger has no rate until the
  studio sets one — an absent default, not a wrong one.
- **`automation_rules` — one confirmed break, fixed; one confirmed gap,
  flagged, not fixed.** See below.

**Left `UNVERIFIED`** (matches `docs/seed-truth-2026-08.md`'s own verdict —
confirming these needs the same source-vs-target read this session gave the
two above, which ran out of scope for this pass): `outreach_templates`,
`subscription_transitions`, `team_invitations`, `contact_requests`,
`team_alerts`, `alert_presets`, `leaderboard`, `activity_log`, `public_profile`.
None of these were found broken — they were simply not checked field-by-field
against a current Linyup reader in this session.

## Automation rules (pass 11) — one confirmed fix, one confirmed manual-review item

`automation_rules` gets one targeted fix
(`scripts/migration/transforms/automation-rules.ts`), because it was checked
against the source app and the failure mode is silent:

- **Renamed**: HMD's `{ type: 'portal_booking_no_show', delay_days }` condition
  → `bio_link_booking_no_show`. Without this, the rule is dispatched down the
  wrong path in `automationEngine.ts` (`hasBookingCondition` never matches) and
  then fails the evaluator's fail-closed default case — the rule migrates,
  looks normal in the UI, and never fires again. Confirmed against
  `hmd-lineup/src/routes/TeamSettings/components/OutreachTab/{OutreachTab,systemDefaults}.js`.
- **Flagged, not fixed**: `contact_type` and `membership_status` conditions
  (both retired from Linyup along with `Contact.type` / `membership_*`) have no
  safe automatic mapping and are left in place — the rule keeps failing closed
  rather than firing to a guessed audience, matching `automationEngine.ts`'s
  own documented reasoning for that default. The pass logs a `WARN` naming
  every rule this affects; **HMD's own `SYSTEM_RULES` (`sys_rule_noshow_1d`,
  `sys_rule_noshow_5d`, …) ship `contact_type` alongside the no-show condition**,
  so expect this warning on real data. Rebuild the flagged rules by hand with
  today's condition types (`acquisition_stage`, `has_affiliation`,
  `affiliation_type`) after migration.

---

## Affiliations (pass 00 + pass 05)

Phase 2 replaced the single-valued membership fields on the contact doc with a
multi-valued **affiliation** set (`contacts/{id}/affiliations`). The migration no
longer writes any of the removed fields (`membership_status`, `membership_active`,
`membership_expiration`, `org_membership_status`, `org_membership_active`,
`org_membership_expiration`).

Mapping (`scripts/migration/transforms/contacts.ts`):

| Source field (non-`guest`) | → Affiliation |
|---|---|
| `org_membership_status` | `issuer: 'org'` (HMD org `hmd`), type `club`, `status_id` = the value, `active` = (`active`-status), `valid_until` ← `org_membership_expiration` |
| `membership_status` | `issuer: 'team'`, type `club`, `status_id` = the value, `active` = (`active`-status), `valid_until` ← `membership_expiration` |
| `guest` / none | no affiliation |

Soft-deleted contacts (`deleted_at != null`) are coerced to `status_id: 'expired'`
so they never count as active. The transform derives the affiliation docs and
attaches them under the reserved `__affiliations` key; **pass 05** peels that off
and writes each into `contacts/{id}/affiliations/{id}-aff-N`, then persists the
contact doc without the key. A best-effort `affiliation_summary` is set on the
contact (the live `onAffiliationWrite` trigger recomputes it).

Catalog + statuses: **pass 00** seeds the org-level `club` affiliation type and
the reused `membership_statuses` (`DEFAULT_ORG_MEMBERSHIP_STATUSES`) under
`organizations/hmd`. **Pass 05** seeds a team-local `club` affiliation type per
team and flags each team `affiliations_enabled: true` (the `org_id` /
`organization_ids: ['hmd']` link is set in pass 02).

---

> **Online Courses / public Space:** courses don't exist in hmd-lineup, so there is nothing
> to migrate. The web Space + course gating only depend on already-migrated contact fields —
> `email` and `subscription_type_id` — so contacts can log in and unlock gated courses. The
> verify pass already spot-checks contacts; confirm migrated contacts have a non-empty
> `email` (required for the passwordless contact login).

> **Documents / Waivers:** hmd-lineup has no `documents` collection and no waiver
> concept at all, so the migration writes none — this is the correct, honest state
> for a tenant whose source never had it, not a pass waiting to be written. Do
> **not** "fix" this by fabricating placeholder documents (a real customer's
> liability waiver is not something a script should author) or by adding
> `waiver_policy` to pass 11's `TEAM_SUBCOLLECTIONS` (there is nothing in the
> source to copy from). It is also inert rather than broken: `enforceWaiverGate`
> fails CLOSED only on a policy that *requires* a document, so an absent policy
> means "nothing required," never a silently-skipped requirement. The studio
> authors their first document (and, if desired, a waiver policy) from
> `/plugins/documents` after migration; `scripts/backfill-document-versions.ts`
> is a precondition for *that* publish, not for this migration.
