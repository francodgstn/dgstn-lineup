# Stripe catalog — declarative add-on prices

Plugin **add-on** products/prices are defined **in the repo** and applied to
Stripe idempotently, so test and prod stay reproducible.

## Source of truth
`packages/shared/src/plugin-addons.ts` → `PLUGIN_ADDONS` (plugin id →
`{ coachPriceMonthly, stripeLookupKey }`). This same map drives the web UI, the
billing Cloud Functions, and the sync script — one definition, no drift.

## Sync
`scripts/stripe-sync.ts` (run via `pnpm stripe:sync`) provisions a Stripe
Product + recurring monthly Price for each add-on, keyed by `lookup_key`:

| State | Action |
|---|---|
| lookup key missing | create Product + Price |
| present, same amount | no-op |
| present, different amount | create a new Price + `transfer_lookup_key` (Prices are immutable) |

```bash
# dry-run (prints planned changes)
STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync
# apply
STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync --apply
```

Run once per environment (test, then prod) whenever the catalog changes.

## Not managed here
Plan prices (`linyup_<plan>_monthly`) are provisioned separately and are **not**
touched by this script. (They could be folded in later if desired.)

## Alternatives considered
- **Terraform Stripe provider** — fits the existing `infra/` Terraform, but the
  community provider lags Stripe features.
- **Stripe CLI `fixtures`** — good for test-mode seeding, weaker for prod lifecycle.

The script approach was chosen for full in-house control and reuse of the
existing `lookup_key` convention.
