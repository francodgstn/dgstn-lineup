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
| `contacts` + subcollections | Copied; `rank → ranks.hmd`; `notes` dropped; `type` → acquisition axis (`acquisition_stage`/`entry` + milestone timestamps, `external` → `external` tag); `acquisition.channel` → `source` (+ `source_detail`), `acquisition.acknowledged` → `lead_acknowledged` |
| `sessions` + participants/bookings | Copied + activity name/type enriched |
| `events` + invitations/attendees | Copied as `scope='org', orgId='hmd', teamId=null` |
| Global `checkins` (event check-ins) | Migrated from the top-level `checkins` collection where `event.id == eventId`; doc IDs preserved; `completed_checkins_count` set on each event doc |
| `referrals` | Copied as-is |
| Team subcollections | Copied from source; **canonical subscription types are seeded** (see below) |
| `coach_availability` / `coach_slots` | **Skipped** — coaching was preview-only; configure fresh |
| Session-level `checkins` | **Skipped** — session-level checkins (docs without `event.id`) are not migrated; the new schema is event-level only |
| `saas_subscriptions` | **Not migrated** — create one per team manually after migration |
| `courses` (Online Courses) | **Not migrated** — net-new in Linyup; create courses in-app post-migration |

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

> **Online Courses / public Space:** courses don't exist in hmd-lineup, so there is nothing
> to migrate. The web Space + course gating only depend on already-migrated contact fields —
> `email`, `membership_active`, and `subscription_type_id` — so contacts can log in and unlock
> gated courses. The verify pass already spot-checks contacts; confirm migrated contacts have
> a non-empty `email` (required for the passwordless contact login).
