# HMD Migration — Runbook

Migrates all historical data from `hmd-lineup` (Firebase) into `dgstn-lineup` (Lineup SaaS).

---

## Prerequisites

- Node 22 (`node --version` should print `v22.x`)
- Two Firebase service account JSON files:
  - `./keys/hmd-prod-sa.json` — hmd-lineup production project
  - `./keys/lineup-staging-sa.json` — lineup-staging target
- `keys/` is gitignored — never commit service account files

---

## Step 1 — Populate config.ts

Open `scripts/migration/config.ts` and fill in `TEAM_CONFIGS` with the 16 HMD team IDs. You can get them by running:

```bash
firebase --project hmd-lineup firestore:export gs://hmd-lineup.appspot.com/export
# or read them with the admin SDK from a one-off script
```

Set each team's `language` (`de` / `fr` / `it`) and optionally `sport_type`.

---

## Step 2 — Migrate Firebase Auth (manual, must run before the script)

Auth UIDs are used as document IDs in Firestore — they must exist in the target project before any Firestore data is written.

```bash
# Export users from hmd-lineup
firebase --project hmd-lineup auth:export hmd-users.json

# Import into lineup-staging
# Hash params (scrypt signer key, salt separator, rounds, mem cost) are shown in
# Firebase Console → Authentication → Users → Import users
firebase --project lineup-staging auth:import hmd-users.json \
  --hash-algo=SCRYPT \
  --hash-key=<signerKey> \
  --salt-separator=<saltSeparator> \
  --rounds=<rounds> \
  --mem-cost=<memCost>
```

---

## Step 3 — Dry run (safe — reads only)

Always run with `--dry-run` first to verify the script can connect and enumerate documents without errors:

```bash
tsx scripts/migrate-hmd.ts \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json \
  --dry-run
```

To test a single team end-to-end before migrating all 16:

```bash
tsx scripts/migrate-hmd.ts \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json \
  --dry-run \
  --from-team <teamId>
```

---

## Step 4 — Create the org doc (Phase 0 setup)

```bash
tsx scripts/migrate-hmd.ts \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json \
  --setup
```

This creates `organizations/hmd` in the target project. Idempotent — safe to run again.

---

## Step 5 — Run a single pass (optional, for incremental testing)

```bash
# Migrate only contacts for one team
tsx scripts/migrate-hmd.ts \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json \
  --only contacts \
  --from-team <teamId>
```

Available pass names: `users`, `teams`, `activities`, `session_series`, `contacts`, `sessions`, `referrals`, `team_subcollections`

---

## Step 6 — Full migration

```bash
tsx scripts/migrate-hmd.ts \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json
```

The script is **resumable** — completed passes are recorded in `_migration/hmd` in the target project. If the script is interrupted, re-run it and it will skip already-completed passes.

To force a pass to re-run, delete the corresponding key from `_migration/hmd` in the Firebase Console.

---

## Step 7 — Verify

```bash
tsx scripts/migration/verify.ts \
  --source-creds ./keys/hmd-prod-sa.json \
  --target-creds ./keys/lineup-staging-sa.json
```

The script checks count parity, contact subcollections, session integrity, referential integrity, and confirms that skipped collections are absent. Exits with code 1 if any check fails.

---

## Step 8 — Smoke test

1. Point the web app at `lineup-staging` (update `.env.local` with staging credentials)
2. `pnpm --filter @lineup/web dev`
3. Log in with a migrated user account
4. Verify `/contacts`, `/sessions`, `/events` pages load without errors
5. Spot-check a contact — confirm ranks, subscription history, goals are visible

---

## Rollback

The migration script only writes to the target project. The source (`hmd-lineup`) is never modified.

To roll back a staging run, delete all data from the target project:

```bash
# Delete all Firestore data in lineup-staging
gcloud firestore operations list --project lineup-staging
gcloud alpha firestore bulk-delete --project lineup-staging --all-namespaces
```

Or use the Firebase Console → Firestore → Delete database.

---

## What is NOT migrated

| Collection | Reason |
|------------|--------|
| `coach_availability` | Coaching was preview-only; configure fresh per team |
| `coach_slots` | Same as above |
| `events` | Org-level events architecture not yet finalised; separate phase |
| `checkins` | Old session check-ins; already captured in `sessions/{id}/participants` |
| `verification_codes` | Ephemeral OTPs |
| `auth_tokens` | Ephemeral session tokens |
| `booking_verification_codes` | Ephemeral |
| `referral_codes` | Regenerated from `referrals` |
| `categories` | Sport-specific; reimport manually |
| `projects` | Deprecated |
| `teams/{id}/rebuild_jobs` | Runtime-only; regenerated automatically |
| `users/{id}/sessions_tags` | Regenerated via Cloud Functions |
| `users/{id}/user_places` | Deprecated |
| `contact_notes` | Old Lexical JSON; stale; new app uses fresh notes subcollection |
