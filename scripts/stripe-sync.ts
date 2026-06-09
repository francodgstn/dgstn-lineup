/**
 * Declarative Stripe catalog sync.
 *
 * Source of truth lives IN THE REPO: the add-on catalog is `PLUGIN_ADDONS`
 * (packages/shared/src/plugin-addons.ts). This script idempotently provisions a
 * Stripe Product + recurring monthly Price (with a stable `lookup_key`) for each
 * add-on, so the same definition can be applied to test and prod.
 *
 * Idempotency: keyed by `lookup_key`.
 *   - missing            → create Product + Price
 *   - present, same price → no-op
 *   - present, different  → create a NEW Price and `transfer_lookup_key` (Stripe
 *                           Prices are immutable; this re-points the key)
 *
 * Plan prices (linyup_<plan>_monthly) are managed separately and NOT touched.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm tsx scripts/stripe-sync.ts          # dry-run
 *   STRIPE_SECRET_KEY=sk_test_... pnpm tsx scripts/stripe-sync.ts --apply  # write
 */
import Stripe from 'stripe'
import { PLUGIN_ADDONS } from '@linyup/shared'

const CURRENCY = 'chf'
const APPLY = process.argv.includes('--apply')

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY is required (use a test key unless syncing prod).')
  process.exit(1)
}
const stripe = new Stripe(secretKey)

function chfToRappen(chf: number): number {
  return Math.round(chf * 100)
}

async function syncAddon(pluginId: string, lookupKey: string, unitAmount: number) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, expand: ['data.product'] })
  const current = existing.data[0]

  if (!current) {
    console.log(`+ create  ${lookupKey}  (CHF ${unitAmount / 100})`)
    if (!APPLY) return
    const product = await stripe.products.create({ name: `Linyup add-on: ${pluginId}` })
    await stripe.prices.create({
      product: product.id,
      currency: CURRENCY,
      unit_amount: unitAmount,
      recurring: { interval: 'month' },
      lookup_key: lookupKey,
    })
    return
  }

  if (current.unit_amount === unitAmount && current.currency === CURRENCY) {
    console.log(`= ok      ${lookupKey}`)
    return
  }

  console.log(`~ reprice ${lookupKey}  ${current.unit_amount} → ${unitAmount}`)
  if (!APPLY) return
  const productId = typeof current.product === 'string' ? current.product : current.product.id
  await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: unitAmount,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  })
}

async function main() {
  console.log(`Stripe add-on sync (${APPLY ? 'APPLY' : 'dry-run'})\n`)
  for (const [pluginId, { coachPriceMonthly, stripeLookupKey }] of Object.entries(PLUGIN_ADDONS)) {
    await syncAddon(pluginId, stripeLookupKey, chfToRappen(coachPriceMonthly))
  }
  console.log(`\nDone.${APPLY ? '' : ' Re-run with --apply to write changes.'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
