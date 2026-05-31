# HMD → Lineup SaaS Migration

Migrates all data from `hmd-lineup` (Firebase prod) into `dgstn-lineup` (Lineup SaaS).

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

The organisation document and org_admin member entry are created automatically by the **setup pass**. The **auth-users pass** migrates Firebase Auth accounts. To preserve original passwords, provide the Firebase auth export file:

**Export users + hash params from the source project first:**

```bash
firebase --project hmd-lineup auth:export hmd-users.json
```

Hash params (signer key, salt separator, rounds, mem cost) are shown in Firebase Console → Authentication → Users → Export users, or in the `hmd-users.json` file itself.

**Then pass the export file to the migration script** (see Options below). If `--source-auth-export` is omitted, accounts are created without passwords — users would need to reset them.

---

## Migrating into the local emulator (recommended first step)

Start the emulators first:

```bash
pnpm emulators:start
```
It will start all needed emulators, project `demo-lineup`.

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

---

## Migrating into staging / production

**Always dry-run first:**

```bash
pnpm migrate:hmd \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json \
  --dry-run
```

**Full migration:**

```bash
pnpm migrate:hmd \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json
```

---

## Options

| Flag | Description |
|---|---|
| `--source-creds <path>` | Service account JSON for hmd-lineup source (required) |
| `--target-creds <path>` | Service account JSON for target project |
| `--target-emulator` | Write to local Firestore emulator instead of a real project |
| `--org-admin-email <email>` | Email of the org creator + org_admin (default: `franco.dgstn@gmail.com`) |
| `--source-auth-export <path>` | Path to `firebase auth:export` JSON — preserves original passwords |
| `--hash-key <base64>` | SCRYPT signer key (required with `--source-auth-export`) |
| `--hash-salt-separator <base64>` | SCRYPT salt separator |
| `--hash-rounds <n>` | SCRYPT rounds (default: 8) |
| `--hash-mem-cost <n>` | SCRYPT memory cost (default: 14) |
| `--dry-run` | Log writes without committing |
| `--only <pass>` | Run a single pass (see pass names below) |
| `--from-team <teamId>` | Resume contacts/sessions passes from a specific team |
| `--verify` | Run verification after migration |

Pass names: `setup` · `auth-users` · `users` · `teams` · `activities` · `session-series` · `contacts` · `sessions` · `events` · `referrals` · `team-subcollections` · `verify`

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
| `teams` | Copied + `plan: 'club'`, `organizationId: 'hmd'` added |
| `activities` | Copied + new fields (`slug`, `type`, `isActive`, `level`) |
| `session_series` | Copied + recurrence field names normalised |
| `contacts` + subcollections | Copied; `rank → ranks.hmd`; `notes`, `acquisition` dropped |
| `sessions` + participants/bookings | Copied + activity name/type enriched |
| `events` + invitations/attendees | Copied as `scope='org', orgId='hmd', teamId=null` |
| `referrals` | Copied as-is |
| Team subcollections | Copied as-is (subscription_types, outreach_templates, etc.) |
| `coach_availability` / `coach_slots` | **Skipped** — coaching was preview-only; configure fresh |
| `checkins` | **Skipped** — old checkins are session-level; new schema is event-level |
| `saas_subscriptions` | **Not migrated** — create one per team manually after migration |
