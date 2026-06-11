/**
 * Declarative Stripe catalog sync.
 *
 * The whole catalogue lives IN THE REPO:
 *   - plan prices  → PLAN_PRICING   (packages/shared/src/types/plan.ts)
 *   - add-on prices → PLUGIN_ADDONS (packages/shared/src/types/plugin-addons.ts)
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
import { PLAN_PRICING, PLUGIN_ADDONS, EXTRA_CONTACT_MONTHLY, EXTRA_CONTACT_STRIPE_LOOKUP_KEY } from '@linyup/shared'

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

// Stripe Product names are customer-facing (Checkout, invoices, customer portal).
// Plan IDs are stable machine identifiers; marketing names can change.
// Keep this map in line with the `Plans` namespace in apps/web/messages/en.json.
const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: 'Free',
  coach: 'Coach',
  studio: 'Studio',
  organization: 'Organization',
}

const catalog: CatalogEntry[] = [
  // Plans without a lookup key (free) are never billed and have no Stripe price.
  ...Object.entries(PLAN_PRICING)
    .filter(([, p]) => p.stripeLookupKey != null)
    .map(([plan, p]): CatalogEntry => ({
      kind: 'plan',
      name: `Linyup ${PLAN_DISPLAY_NAMES[plan] ?? plan}`,
      lookupKey: p.stripeLookupKey!,
      chf: p.baseMonthly,
    })),
  ...Object.entries(PLUGIN_ADDONS).map(([id, a]): CatalogEntry => ({
    kind: 'addon',
    name: `Linyup add-on: ${id}`,
    lookupKey: a.stripeLookupKey,
    chf: a.coachPriceMonthly,
  })),
  // Per-student overage (quantity-based; billed per contact over the included count)
  {
    kind: 'plan',
    name: 'Linyup extra student',
    lookupKey: EXTRA_CONTACT_STRIPE_LOOKUP_KEY,
    chf: EXTRA_CONTACT_MONTHLY,
  },
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

  // Product names are mutable and customer-facing — unlike prices, drift here is
  // synced in place (covers plan renames).
  const product = typeof current.product === 'string' ? null : current.product
  if (product && !product.deleted && product.name !== entry.name) {
    console.log(`~ rename   ${entry.lookupKey}  "${product.name}" → "${entry.name}"`)
    if (APPLY) await stripe.products.update(product.id, { name: entry.name })
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
