# Founder onboarding runbook (first 5)

The day-to-day playbook for onboarding a founder studio under the
**sandbox → promote** model. Run it **once per founder**. White-glove throughout.

Prereqs (one-time, before any founder): the
[provider-wiring checklist](./provider-wiring-checklist.md) sandbox sweep is green,
and the [data-safety checklist](./data-safety-checklist.md) §1 (backups) is done.

---

## Capabilities this runbook depends on

| Capability | Status |
|---|---|
| Tenant-data manifest + per-team `purgeTeam` reset | ✅ built (`packages/shared/src/tenantData.ts`, `saas-billing/index.ts`) |
| `linyup-sandbox` project + guarded reset script | ✅ exists (`.firebaserc`, `scripts/reset-sandbox-db.ts`) |
| Migration framework (dry-run / `--verify` / `--from-team`) | ✅ exists (`scripts/migration/*`, `scripts/migrate-hmd.ts`) |
| **`Team.flags.internal/pilot`** (exclude from metrics + exempt from trial auto-downgrade) | ⏳ **TODO** — add to `Team` type + gate in `handleTrialLifecycle` and `platform_metrics` |
| **Per-team promote tool** (sandbox → prod, idempotent + verified) | ⏳ **TODO** — build on the migration framework |
| External provider teardown in `purgeTeam` (Stripe cancel/disconnect) | ⏳ **TODO** — do manually for now |

> Until the two TODO tools land, the **promote** step is run manually with the
> migration framework, and the **pilot flag** is approximated by setting the
> team's `plan` directly (so it doesn't lapse on the 14-day trial) and excluding
> the internal/test studio from metrics by hand.

---

## Phase A — Validate in sandbox (`linyup-sandbox`, Stripe TEST mode)

1. **Create the sandbox team.** Flag it `pilot` (once the flag exists; for now set
   `plan` directly to avoid the 14-day trial auto-downgrade mid-validation).
2. **Load data.**
   - *Migrating founder (HMD/CSV):* import **into sandbox first** using the
     migration framework — `--dry-run` then real, then `--verify` (counts +
     spot-checks). Keep the **source immutable** so it can be re-imported.
   - *Fresh founder:* set up from scratch in the admin.
3. **White-glove config:** Connect **test** account onboarding, email sender
   (managed or BYO), subscription types / products / courses, bio-link + shop.
4. **Founder review + test purchase.** The founder reviews **their own** data and
   config, and completes a **Stripe test-mode** purchase end-to-end.
5. **Written sign-off** (template below).

## Phase B — Promote to prod (`linyup-prod`, LIVE providers)

6. **Promote the team** sandbox → prod (idempotent + verified; source kept
   immutable so it's re-runnable). Gate the prod write on a counts + spot-check
   **verify pass** and a diff report.
7. **Founder completes LIVE Connect onboarding** + the **controlled first real
   charge** (small, then refund) per the
   [provider-wiring checklist](./provider-wiring-checklist.md) §4.
8. **Go live.** Keep the sandbox copy until the founder confirms prod is good.

---

## Per-founder sign-off checklist (template)

Copy per founder.

```
Founder: ____________________   Date: __________   Env: linyup-sandbox

Data
[ ] Contacts present & correct (count: ____ ; matches source: ____)
[ ] Subscriptions / memberships configured
[ ] Products / courses configured (if selling)
[ ] Sessions / activities / events set up
[ ] No obvious migration artefacts or duplicates

Config
[ ] Connect (test) onboarding complete — charges_enabled
[ ] Email sender (managed or BYO verified) sends correctly
[ ] Bio-link + shop look right; links resolve

Validation
[ ] Founder completed a test-mode purchase end-to-end
[ ] Founder reviewed their own data and approves

Sign-off: founder ____________   operator ____________
Approved to promote to prod:  YES / NO
```

---

## Rollback

- **Bad data discovered after promote:** restore from PITR / managed export
  (data-safety §1), or re-run the idempotent **promote** from the immutable sandbox
  source.
- **Need to wipe and restart a team:** `purgeTeam(teamId, dryRun=true)` to preview,
  then real run (data-safety §3) — **plus** manual Stripe Connect / subscription
  teardown until automated.

---

## Blast-radius controls

- Small cohort, onboarded **one at a time**, white-glove.
- Set the expectation with founders that **data may be adjusted** during the pilot.
- Use per-team plan/feature gating to disable risky features for a founder if needed.

---

## Done when

The founder has signed off in sandbox, been promoted to prod with a clean verify
pass, completed live Connect onboarding + the controlled first charge, and is live —
with the sandbox copy retained until prod is confirmed.
