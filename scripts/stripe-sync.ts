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
 *
 * WEBHOOK ENDPOINTS (separate mode — pass --project):
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync --project linyup-sandbox
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:sync --project linyup-sandbox --apply
 *   ... --apply --store-secrets     # also write the signing secrets to Secret Manager
 *
 * The key decides the ACCOUNT and the MODE: sk_test_ for sandbox/staging,
 * sk_live_ for prod. There is no separate live flag.
 */
import Stripe from 'stripe'
import { execFileSync } from 'node:child_process'
import { PLAN_PRICING, PLUGIN_ADDONS, STUDIO_CONTACT_BLOCK, ORG_PER_STUDIO } from '@linyup/shared'

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
  // Studio contact add-on block — flat +N contacts, bought in blocks (no
  // per-head metering). Quantity = number of blocks the team has added.
  {
    kind: 'plan',
    name: `Linyup +${STUDIO_CONTACT_BLOCK.size} contacts`,
    lookupKey: STUDIO_CONTACT_BLOCK.stripeLookupKey,
    chf: STUDIO_CONTACT_BLOCK.monthly,
  },
  // Organisation per-studio price — billed alongside the org base price
  // (linyup_organization_monthly). Quantity = number of studios (2-studio
  // minimum). Org is sales-led, so these prices back the quote, not self-serve
  // checkout.
  {
    kind: 'plan',
    name: 'Linyup Organization · per studio',
    lookupKey: ORG_PER_STUDIO.stripeLookupKey,
    chf: ORG_PER_STUDIO.monthly,
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

// ─── Webhook endpoints ────────────────────────────────────────────────────────
// Same idea as the catalogue above: the desired state lives in the repo, and the
// script converges Stripe onto it. Idempotency is keyed by URL, which is
// deterministic per project.
//
// Why this is worth automating: the two endpoints are easy to get subtly wrong
// by hand and both fail SILENTLY. Register the Connect one without `connect:
// true` and it looks healthy while receiving nothing — payments take the money
// and bookings never confirm. Miss an event and only that one flow breaks.
//
// The signing secret is returned ONLY at creation. `--store-secrets` writes it
// straight to Secret Manager so it can't be lost between the two steps; without
// it the secret is printed for manual entry (ops console → Settings → Payments).

const FUNCTIONS_REGION = 'europe-west6'

// Derive the event union from the SDK instance rather than naming a types
// namespace — the namespace path moves between stripe major versions, this
// doesn't.
type CreateParams = Parameters<typeof stripe.webhookEndpoints.create>[0]
type EnabledEvent = NonNullable<CreateParams['enabled_events']>[number]

interface WebhookSpec {
  /** Cloud Function name = last path segment of the endpoint URL. */
  fn: string
  /** Secret Manager id holding this endpoint's signing secret. */
  secretId: string
  /** true = connected-account events; false = this account's own events. */
  connect: boolean
  description: string
  /** Kept in step with the handlers — see the referenced files. */
  events: EnabledEvent[]
}

const WEBHOOKS: WebhookSpec[] = [
  {
    fn: 'handleStripeWebhook',
    secretId: 'stripe-webhook-secret',
    connect: false,
    description: 'Linyup — platform / SaaS billing (studios paying Linyup)',
    // utils/gateway/stripe.ts normalises exactly these into the internal events
    // saas-billing/index.ts switches on.
    events: [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
    ],
  },
  {
    fn: 'handleConnectWebhook',
    secretId: 'stripe-connect-webhook-secret',
    connect: true,
    description: 'Linyup — Connect (members paying studios)',
    // Every event connect/webhook.ts acts on: the switch cases plus the
    // account/capability branch (isAccountEvent).
    events: [
      'account.updated',
      'capability.updated',
      'checkout.session.completed',
      'checkout.session.expired',
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'charge.refunded',
      'charge.updated',
      'charge.dispute.created',
      'charge.dispute.closed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
      'payout.paid',
      'payout.failed',
    ],
  },
]

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// Shells out to gcloud rather than pulling in @google-cloud/secret-manager: the
// scripts workspace doesn't depend on it, and gcloud is already the documented
// path for adding secret versions. The value goes in on stdin so it never
// appears in the process list.
function storeSecret(project: string, secretId: string, value: string) {
  execFileSync(
    'gcloud',
    ['secrets', 'versions', 'add', secretId, `--project=${project}`, '--data-file=-'],
    { input: value, stdio: ['pipe', 'ignore', 'inherit'] },
  )
}

async function syncWebhooks(project: string, secretProject: string | undefined) {
  const existing = await stripe.webhookEndpoints.list({ limit: 100 })

  for (const spec of WEBHOOKS) {
    const url = `https://${FUNCTIONS_REGION}-${project}.cloudfunctions.net/${spec.fn}`
    const live = existing.data.find((e) => e.url === url)
    const scope = spec.connect ? 'connect' : 'account'

    if (!live) {
      console.log(`+ create   ${spec.fn}  (${scope}, ${spec.events.length} events)`)
      console.log(`           ${url}`)
      if (!APPLY) continue
      const created = await stripe.webhookEndpoints.create({
        url,
        enabled_events: spec.events,
        connect: spec.connect,
        description: spec.description,
      })
      // Returned once, at creation, and never again.
      const secret = created.secret
      if (!secret) {
        console.log(`  ! no signing secret returned for ${spec.fn} — set it manually`)
        continue
      }
      if (secretProject) {
        storeSecret(secretProject, spec.secretId, secret)
        console.log(`  → stored in ${secretProject}/${spec.secretId}`)
      } else {
        console.log(`  → signing secret (store as ${spec.secretId}): ${secret}`)
      }
      continue
    }

    // Endpoint exists — report drift rather than mutating silently.
    if (live.status !== 'enabled') {
      console.log(`! disabled ${spec.fn}  (status=${live.status}) — enable it in Stripe`)
    }
    const liveEvents = new Set(live.enabled_events)
    const missing = spec.events.filter((e) => !liveEvents.has(e) && !liveEvents.has('*'))
    if (missing.length) {
      console.log(`~ events   ${spec.fn}  missing: ${missing.join(', ')}`)
      if (APPLY) {
        await stripe.webhookEndpoints.update(live.id, {
          enabled_events: [...new Set([...live.enabled_events, ...spec.events])] as EnabledEvent[],
        })
        console.log(`  → events updated`)
      }
    } else {
      console.log(`= ok       ${spec.fn}  (${scope})`)
    }
    // The secret of an existing endpoint cannot be re-read; only rotated.
    console.log(`           secret not re-readable — rotate in Stripe if ${spec.secretId} is unset`)
  }
}

async function main() {
  const project = argValue('--project')
  if (project) {
    const secretProject = process.argv.includes('--store-secrets') ? project : undefined
    console.log(
      `Stripe webhook sync for ${project} (${APPLY ? 'APPLY' : 'dry-run'}` +
        `${secretProject ? ', storing secrets' : ''})\n`,
    )
    await syncWebhooks(project, secretProject)
    console.log(`\nDone.${APPLY ? '' : ' Re-run with --apply to write changes.'}`)
    return
  }

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
