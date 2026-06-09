/**
 * Declarative Stripe catalog sync.
 *
 * The whole catalogue lives IN THE REPO:
 *   - plan prices  → PLAN_PRICING   (packages/shared/src/types/plan.ts)
 *   - add-on prices → PLUGIN_ADDONS (packages/shared/src/plugin-addons.ts)
 *
 * This script idempotently provisions a Stripe Product + recurring monthly Price
 * (with a stable `lookup_key`) for each entry, so the same definition can be
 * applied to test and prod.
 *
 * Idempotency: keyed by `lookup_key`.
 *   - missing             → create Product + Price            (with --apply)
 *   - present, same price → no-op
 *   - present, different  → drift WARNING only, unless --reprice is also passed,
 *                           which creates a NEW Price + `transfer_lookup_key`
 *                           (Stripe Prices are immutable). Repricing affects only
 *                           NEW checkouts; existing subscriptions keep their price.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync                     # dry-run
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync --apply             # create missing
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync --apply --reprice   # also reprice drift
 */
import Stripe from 'stripe'
import { PLAN_PRICING, PLUGIN_ADDONS } from '@linyup/shared'

const CURRENCY = 'chf'
const APPLY = process.argv.includes('--apply')
const REPRICE = process.argv.includes('--reprice')

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY is required (use a test key unless syncing prod).')
  process.exit(1)
}
const stripe = new Stripe(secretKey)

interface CatalogEntry { kind: 'plan' | 'addon'; name: string; lookupKey: string; chf: number }

const catalog: CatalogEntry[] = [
  ...Object.entries(PLAN_PRICING).map(([plan, p]): CatalogEntry => ({
    kind: 'plan',
    name: `Linyup ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`,
    lookupKey: p.stripeLookupKey,
    chf: p.baseMonthly,
  })),
  ...Object.entries(PLUGIN_ADDONS).map(([id, a]): CatalogEntry => ({
    kind: 'addon',
    name: `Linyup add-on: ${id}`,
    lookupKey: a.stripeLookupKey,
    chf: a.coachPriceMonthly,
  })),
]

function chfToRappen(chf: number): number {
  return Math.round(chf * 100)
}

async function syncEntry(entry: CatalogEntry) {
  const unitAmount = chfToRappen(entry.chf)
  const existing = await stripe.prices.list({
    lookup_keys: [entry.lookupKey],
    limit: 1,
    expand: ['data.product'],
  })
  const current = existing.data[0]

  if (!current) {
    console.log(`+ create   ${entry.lookupKey}  (CHF ${entry.chf})`)
    if (!APPLY) return
    const product = await stripe.products.create({ name: entry.name })
    await stripe.prices.create({
      product: product.id,
      currency: CURRENCY,
      unit_amount: unitAmount,
      recurring: { interval: 'month' },
      lookup_key: entry.lookupKey,
    })
    return
  }

  if (current.unit_amount === unitAmount && current.currency === CURRENCY) {
    console.log(`= ok       ${entry.lookupKey}`)
    return
  }

  if (!REPRICE) {
    console.log(`! drift    ${entry.lookupKey}  live=${current.unit_amount} repo=${unitAmount}  (kept — pass --reprice to change)`)
    return
  }

  console.log(`~ reprice  ${entry.lookupKey}  ${current.unit_amount} → ${unitAmount}`)
  if (!APPLY) return
  const productId = typeof current.product === 'string' ? current.product : current.product.id
  await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: unitAmount,
    recurring: { interval: 'month' },
    lookup_key: entry.lookupKey,
    transfer_lookup_key: true,
  })
}

async function main() {
  console.log(`Stripe catalog sync (${APPLY ? 'APPLY' : 'dry-run'}${REPRICE ? ', reprice ON' : ''})\n`)
  for (const entry of catalog) {
    await syncEntry(entry)
  }
  console.log(`\nDone.${APPLY ? '' : ' Re-run with --apply to write changes.'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
