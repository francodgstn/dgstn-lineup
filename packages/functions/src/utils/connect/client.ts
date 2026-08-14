/* eslint-disable @typescript-eslint/no-explicit-any */
// Stripe Connect client — member → studio payments (the THIRD payment concern;
// see packages/shared/src/types/connect.ts for the full architecture note).
//
// This module is the ONLY place that talks to Stripe for Connect. It is kept
// separate from getPlatformStripeAdapter() / StripeAdapter (Linyup's own SaaS
// billing) on purpose: member funds settle on the STUDIO's balance via DIRECT
// charges, and Linyup only ever takes an application fee.
//
// Built on the Accounts v2 API (`stripe.v2.core.accounts` / `accountLinks`) with
// controller-property style responsibilities — NOT the legacy Standard/Express/
// Custom account types. The runtime Stripe SDK (stripe@22, OpenAPI v2252) pins an
// API version that already supports Accounts v2; we deliberately do NOT override
// `apiVersion` (a drifting string would diverge from the bundled types).

import Stripe from 'stripe'
import {
  resolveStripeCurrency,
  type ConnectAccountStatus,
  type ConnectOnboardingModel,
} from '@linyup/shared'
import { getSecret } from '../secrets'

// The rich `Stripe.X` type namespace is not merged onto the default import in this
// SDK build, so (matching the existing utils/gateway/stripe.ts) we type the
// instance via InstanceType and let the SDK methods type-check object literals
// passed to them directly.
type StripeInstance = InstanceType<typeof Stripe>

/**
 * Platform Stripe client for Connect operations. Authenticates as Linyup's
 * platform account; each call targets a connected account via the
 * `stripeAccount` request option. Reuses the platform `stripe-secret-key`
 * (the Connect platform IS Linyup's Stripe account). In production this should be
 * a RESTRICTED key with Connect write scope — see the Connect README.
 */
export async function getConnectStripe(): Promise<StripeInstance> {
  const key = await getSecret('stripe-secret-key')
  return new Stripe(key)
}

// Account configuration. Per §6, the studio is the fee payer (fees_collector
// 'stripe' = Stripe collects its processing fees from the connected account) and
// Linyup is never liable for losses (losses_collector 'stripe' = Stripe bears
// negative balances). Test-mode finding (2026-06): Stripe only allows
// "losses → Stripe" on the Standard profile, which requires the FULL dashboard —
// an express/embedded dashboard forces the platform to take fees + losses. So
// BOTH onboarding choices create the same Standard account (full dashboard); the
// byo vs managed distinction is UI framing only (connect an existing account vs
// create a new one — the hosted Account Link supports both). See
// docs/payment-contact-studio.md.
const MODEL_DASHBOARD: Record<ConnectOnboardingModel, 'full'> = {
  byo: 'full',
  managed: 'full',
}

// Account default currency at onboarding (an onboarding concern — per-charge
// currency comes from the caller, resolved via resolveStripeCurrency).
const PHASE1_CURRENCY = 'chf'

// ─── Onboarding ─────────────────────────────────────────────────────────────────

/**
 * Create a connected account (Accounts v2). Requests the merchant configuration
 * (direct charges → connected account is the merchant of record) with the
 * card_payments + twint_payments capabilities required for Phase 1 (CHF + TWINT).
 */
export async function createConnectedAccount(params: {
  model: ConnectOnboardingModel
  teamId: string
  email: string
  country?: string
  entityType?: 'company' | 'individual'
  displayName?: string
  /** Idempotency key — prevents a duplicate account if the call is retried. */
  idempotencyKey?: string
}): Promise<{ accountId: string }> {
  const stripe = await getConnectStripe()

  const account = await stripe.v2.core.accounts.create(
    {
      display_name: params.displayName ?? params.email,
      contact_email: params.email,
      dashboard: MODEL_DASHBOARD[params.model],
      defaults: {
        currency: PHASE1_CURRENCY,
        responsibilities: {
          fees_collector: 'stripe', // studio pays Stripe processing fees
          losses_collector: 'stripe', // Stripe bears negative balances (not Linyup)
        },
      },
      identity: {
        country: params.country ?? 'CH',
        ...(params.entityType ? { entity_type: params.entityType } : {}),
      } as any,
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
            twint_payments: { requested: true },
          },
        },
      },
      metadata: { teamId: params.teamId, model: params.model },
      include: ['configuration.merchant', 'requirements', 'identity'],
    },
    params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
  )
  return { accountId: account.id }
}

/**
 * Create a hosted onboarding Account Link (Accounts v2). Stripe collects the
 * studio's requirements; `merchant` is the configuration being onboarded. The
 * link is single-use and short-lived — generate a fresh one each time the studio
 * clicks "finish setup".
 */
export async function createAccountLink(params: {
  accountId: string
  refreshUrl: string
  returnUrl: string
}): Promise<{ url: string }> {
  const stripe = await getConnectStripe()
  const link = await stripe.v2.core.accountLinks.create({
    account: params.accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant'],
        refresh_url: params.refreshUrl,
        return_url: params.returnUrl,
      },
    },
  })
  return { url: link.url }
}

export interface NormalizedAccountStatus {
  status: ConnectAccountStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  /** Merchant capability → state, e.g. { card_payments: 'active', twint_payments: 'pending' }. */
  capabilities: Record<string, string>
  /** Machine-readable requirement descriptions the studio must still provide. */
  requirements_currently_due: string[]
  requirements_disabled_reason: string | null
}

// Minimal structural view of the bits of a v2 account we read (the full SDK
// Account type isn't reachable as `Stripe.X` from the default import).
interface RawV2Account {
  closed?: boolean
  configuration?: { merchant?: { capabilities?: Record<string, { status?: string } | undefined> } }
  requirements?: {
    entries?: Array<{
      awaiting_action_from?: string
      description?: string
      minimum_deadline?: { status?: string }
    }>
  }
}

/**
 * Derive a flat status from a v2 account. v2 has no top-level charges_enabled /
 * payouts_enabled booleans (those are v1) — they are derived from merchant
 * capability statuses + outstanding requirements. These derivations are validated
 * against Stripe test mode during integration testing (see the Connect README).
 */
export function normalizeAccount(accountRaw: unknown): NormalizedAccountStatus {
  const account = accountRaw as RawV2Account
  const merchantCaps = account.configuration?.merchant?.capabilities ?? {}
  const capabilities: Record<string, string> = {}
  for (const [name, cap] of Object.entries(merchantCaps)) {
    if (cap && typeof cap.status === 'string') capabilities[name] = cap.status
  }

  const entries = account.requirements?.entries ?? []
  // Requirements the studio (the "user") must act on now or is overdue on.
  const requirements_currently_due: string[] = []
  for (const e of entries) {
    const s = e.minimum_deadline?.status
    if (e.awaiting_action_from === 'user' && (s === 'currently_due' || s === 'past_due')) {
      if (e.description) requirements_currently_due.push(e.description)
    }
  }

  const cardActive = capabilities['card_payments'] === 'active'
  const charges_enabled = cardActive
  // Stripe holds payouts while user-actionable requirements are outstanding;
  // treat a fully-verified, charge-capable account as payout-capable.
  const payouts_enabled = cardActive && requirements_currently_due.length === 0
  const details_submitted = requirements_currently_due.length === 0

  let requirements_disabled_reason: string | null = null
  const restricted = Object.entries(capabilities).find(
    ([, s]) => s === 'restricted' || s === 'unsupported'
  )
  if (restricted) requirements_disabled_reason = `${restricted[0]}:${restricted[1]}`

  let status: ConnectAccountStatus
  if (account.closed === true) status = 'rejected'
  else if (charges_enabled && payouts_enabled) status = 'enabled'
  else if (requirements_disabled_reason || requirements_currently_due.length > 0) status = 'restricted'
  else status = 'pending'

  return {
    status,
    charges_enabled,
    payouts_enabled,
    details_submitted,
    capabilities,
    requirements_currently_due,
    requirements_disabled_reason,
  }
}

/** Retrieve a connected account and return its normalized status. */
export async function retrieveAccountStatus(accountId: string): Promise<NormalizedAccountStatus> {
  const stripe = await getConnectStripe()
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'requirements'],
  })
  return normalizeAccount(account)
}

// ─── Payments (direct charges via Checkout) ──────────────────────────────────────
// Checkout Sessions are the recommended one-time/subscription surface and support
// TWINT + Apple Pay / Google Pay via dynamic payment methods. We NEVER pass
// payment_method_types — the studio enables methods from its dashboard.

/** One-off direct charge (drop-in, belt test, shop). Fee → platform via
 * payment_intent_data.application_fee_amount; money settles on the studio. */
export async function createOneOffCheckoutSession(params: {
  accountId: string
  amount: number // gross Rappen
  currency?: string
  applicationFeeAmount: number // Rappen, from computePlatformFee
  productName: string
  successUrl: string
  cancelUrl: string
  customerEmail?: string
  metadata?: Record<string, string>
  idempotencyKey: string
  /** Unix seconds the Checkout Session itself expires at (Stripe minimum: 30 min
   *  from creation). Appointment holds pass now+31min — see checkout.ts for why
   *  not exactly 30 (clock-skew rejection risk). Omit for Stripe's default (24h). */
  expiresAtEpochSeconds?: number
}): Promise<{ url: string; sessionId: string }> {
  const stripe = await getConnectStripe()
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency ?? resolveStripeCurrency(undefined),
            unit_amount: params.amount,
            product_data: { name: params.productName },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: params.applicationFeeAmount,
        metadata: params.metadata,
      },
      customer_email: params.customerEmail,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
      ...(params.expiresAtEpochSeconds ? { expires_at: params.expiresAtEpochSeconds } : {}),
    },
    { stripeAccount: params.accountId, idempotencyKey: params.idempotencyKey }
  )
  if (!session.url) throw new Error('Connect checkout session URL missing')
  return { url: session.url, sessionId: session.id }
}

/**
 * What became of a Checkout Session we asked Stripe to close.
 *
 *  • `closed` — it can no longer take money (we expired it, or it was already
 *    expired/cancelled). SAFE to hand whatever it was guarding to somebody else.
 *  • `paid`   — it is `complete`: the money already moved on that session, and a
 *    caller that treats this as `closed` double-charges or double-issues.
 *  • `failed` — Stripe could not tell us. NOT the same as `closed`, and the
 *    difference is the whole point of the three-valued return: a caller must be
 *    able to refuse rather than assume.
 */
export type CheckoutSessionCloseOutcome = 'closed' | 'paid' | 'failed'

/**
 * Close a Checkout Session on a connected account so it can never take money
 * again — the ONE Stripe-side half of "a finite thing is backed by at most one
 * payable session at a time".
 *
 * `expire` only accepts a session in status `open`, so its failure is ambiguous
 * on its own: an already-expired session (nothing to do) and an already-PAID one
 * (everything to do) both throw. A `retrieve` is what tells them apart, and
 * guessing in the paid direction is a double charge — so the error path costs a
 * second call rather than an assumption.
 */
export async function closeCheckoutSession(params: {
  sessionId: string
  accountId: string
}): Promise<CheckoutSessionCloseOutcome> {
  const stripe = await getConnectStripe()
  const opts = { stripeAccount: params.accountId }
  try {
    const session = await stripe.checkout.sessions.expire(params.sessionId, {}, opts)
    // A race: `expire` can succeed on a session that Stripe has meanwhile
    // completed. Read the status back rather than assuming what we asked for.
    return classifyCheckoutSession(session)
  } catch {
    try {
      const session = await stripe.checkout.sessions.retrieve(params.sessionId, {}, opts)
      const outcome = classifyCheckoutSession(session)
      // `open` here means expire failed for some other reason and the session is
      // STILL payable — the one case a caller must not be told "closed".
      return outcome
    } catch {
      return 'failed'
    }
  }
}

function classifyCheckoutSession(session: {
  status?: string | null
  payment_status?: string | null
}): CheckoutSessionCloseOutcome {
  if (session.status === 'complete') return 'paid'
  // Belt and braces: a session that has taken money is `paid`/`no_payment_required`
  // here well before `status` settles to `complete`.
  if (session.payment_status && session.payment_status !== 'unpaid') return 'paid'
  if (session.status === 'expired') return 'closed'
  return 'failed'
}

/** Recurring membership as a subscription on the connected account. Fee → platform
 * per invoice via subscription_data.application_fee_percent. Inline price_data
 * avoids pre-creating Stripe Price objects per studio. */
export async function createSubscriptionCheckoutSession(params: {
  accountId: string
  amount: number // per-period Rappen
  currency?: string
  interval: 'day' | 'week' | 'month' | 'year'
  intervalCount?: number // e.g. 2 for biweekly, 3 for quarterly
  applicationFeePercent: number // from takeRatePercent(tier)
  productName: string
  successUrl: string
  cancelUrl: string
  customerEmail?: string
  metadata?: Record<string, string>
  idempotencyKey: string
}): Promise<{ url: string; sessionId: string }> {
  const stripe = await getConnectStripe()
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency ?? resolveStripeCurrency(undefined),
            unit_amount: params.amount,
            recurring: { interval: params.interval, interval_count: params.intervalCount ?? 1 },
            product_data: { name: params.productName },
          },
        },
      ],
      subscription_data: {
        application_fee_percent: params.applicationFeePercent,
        metadata: params.metadata,
      },
      customer_email: params.customerEmail,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    },
    { stripeAccount: params.accountId, idempotencyKey: params.idempotencyKey }
  )
  if (!session.url) throw new Error('Connect subscription session URL missing')
  return { url: session.url, sessionId: session.id }
}

// ─── Refunds ─────────────────────────────────────────────────────────────────────

/**
 * Refund a direct charge, reversing the platform application fee in proportion to
 * the refunded amount (`refund_application_fee: true`). Omit `amount` for a full
 * refund. Runs on the connected account (stripeAccount).
 */
export async function refundDirectCharge(params: {
  accountId: string
  paymentIntentId: string
  amount?: number // partial refund in Rappen; omit for full
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  idempotencyKey: string
}) {
  const stripe = await getConnectStripe()
  return stripe.refunds.create(
    {
      payment_intent: params.paymentIntentId,
      ...(params.amount !== undefined ? { amount: params.amount } : {}),
      ...(params.reason ? { reason: params.reason } : {}),
      refund_application_fee: true,
    },
    { stripeAccount: params.accountId, idempotencyKey: params.idempotencyKey }
  )
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────────

/**
 * Verify + parse a Connect webhook event. Connect events carry `event.account`
 * (the connected account id) which the handler maps back to a team. Signature is
 * verified against the CONNECT endpoint's own signing secret (separate from the
 * platform SaaS-billing webhook secret).
 */
export async function constructConnectWebhookEvent(params: {
  payload: string | Buffer
  signature: string
  secret: string
}) {
  const stripe = await getConnectStripe()
  return stripe.webhooks.constructEventAsync(params.payload, params.signature, params.secret)
}
