# Stripe catalog — declarative

The **whole catalogue** (subscription plans **and** plugin add-ons) is defined
**in the repo** and applied to Stripe idempotently, so test and prod stay
reproducible.

## Source of truth
- Plans → `PLAN_PRICING` in `packages/shared/src/types/plan.ts`
  (`{ baseMonthly, stripeLookupKey }`).
- Add-ons → `PLUGIN_ADDONS` in `packages/shared/src/types/plugin-addons.ts`
  (`{ coachPriceMonthly, stripeLookupKey }`).

These same maps drive the web UI, the billing Cloud Functions, and the sync
script — one definition, no drift. Lookup-key convention: `linyup_<plan>_monthly`
and `linyup_addon_<pluginId>_monthly`.

## Sync
`scripts/stripe-sync.ts` (`pnpm stripe:sync`) provisions a Stripe Product +
recurring monthly Price for each entry, keyed by `lookup_key`:

| State | Default action | With `--reprice` |
|---|---|---|
| lookup key missing | create Product + Price | create |
| present, same amount | no-op | no-op |
| present, **different** amount | **drift warning only — left unchanged** | new Price + `transfer_lookup_key` |

Repricing is opt-in so a routine sync can never silently change a live price.
`transfer_lookup_key` only affects **new** checkouts; existing subscriptions keep
their current price until changed explicitly.

```bash
# dry-run (prints planned changes, no writes)
STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync
# create any missing products/prices
STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync --apply
# also re-point lookup keys where the repo amount differs from live
STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync --apply --reprice

# (PowerShell) pull the key from Secret Manager instead of typing it
$env:STRIPE_SECRET_KEY = gcloud secrets versions access latest --secret=stripe-secret-key --project=linyup-staging
pnpm stripe:sync --apply
```

Run once per environment (test, then prod) whenever the catalog changes.

> The base plan amounts in `PLAN_PRICING` are **indicative placeholders**. If your
> live plan prices already exist with real amounts, the default sync leaves them
> untouched (you'll just see `! drift` lines). Set the repo values to match live,
> or pass `--reprice` deliberately when you actually want to change a price.

## Alternatives considered
- **Terraform Stripe provider** — fits the existing `infra/` Terraform, but the
  community provider lags Stripe features.
- **Stripe CLI `fixtures`** — good for test-mode seeding, weaker for prod lifecycle.

The script approach was chosen for full in-house control and reuse of the
existing `lookup_key` convention.
