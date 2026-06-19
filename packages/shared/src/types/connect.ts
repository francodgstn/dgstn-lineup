// Stripe Connect — member → studio payments.
//
// This is the THIRD, distinct payment concern in Linyup; keep it separate from:
//   1. Linyup SaaS billing  (Linyup charges studios — saas-billing/, getPlatformStripeAdapter)
//   2. BYO team gateways    (studio charges members on an INDEPENDENT account, no platform fee —
//                            integration.ts / handlePayrexxWebhook)
//   3. THIS: Connect        (studio charges members; money settles on the STUDIO's Stripe
//                            balance; Linyup takes a configurable application fee)
//
// Architecture (locked — see the implementation brief):
//   • Accounts v2 API + controller properties (NOT legacy Standard/Express/Custom).
//   • Direct charges on the connected (studio) account with application_fee_amount.
//     Member funds NEVER pass through or settle into Linyup's own Stripe balance.
//   • controller.fees.payer = account on BOTH models (studio bears Stripe processing fees;
//     the application fee is clean platform margin).
//   • CHF only in Phase 1. All monetary amounts are INTEGER minor units (Rappen) — never floats.

import type { Timestamp } from './common'
import type { SaasPlan } from './team'

// ─── Onboarding model ───────────────────────────────────────────────────────────
// Studio picks one. Both create an Accounts-v2 connected account with
// controller properties; they differ in dashboard access and loss liability.
//
//   byo     — "link my existing Stripe account": full Stripe dashboard, studio
//             collects requirements via Stripe, studio bears negative-balance /
//             chargeback liability (controller.losses.payments = account).
//   managed — embedded ~2-min setup: platform-branded onboarding, Stripe-handled
//             KYC, loss liability assigned to Stripe (controller.losses.payments
//             = stripe), recommended for direct charges.
export type ConnectOnboardingModel = 'byo' | 'managed'

// ─── Take-rate (platform application fee) ────────────────────────────────────────
// Per Linyup plan tier. Configurable — NEVER hardcode a fee anywhere else; always
// go through computePlatformFee(). Stored in basis points (1% = 100 bps) so every
// value is an integer and the fee math stays in integer Rappen.
//
// NOTE: these are PLACEHOLDER values surfaced for sign-off (Free 5 / Coach 3 /
// Studio 2 / Org 1 %). "Studio" is the tier the brief calls "Club" (renamed
// pre-launch; the id `studio` is the stable machine identifier).
export interface ConnectTakeRate {
  /** Platform application fee in basis points (integer). 100 bps = 1%. */
  bps: number
  /**
   * Minimum platform fee in Rappen, applied when the percentage rounds below it.
   * 0 = no minimum. The fee is always clamped to never exceed the charge amount.
   */
  minFeeRappen: number
}

export const CONNECT_TAKE_RATE: Record<SaasPlan, ConnectTakeRate> = {
  free: { bps: 500, minFeeRappen: 0 }, // 5%
  coach: { bps: 300, minFeeRappen: 0 }, // 3%
  studio: { bps: 200, minFeeRappen: 0 }, // 2%
  organization: { bps: 100, minFeeRappen: 0 }, // 1%
}

export interface PlatformFeeInput {
  /** The studio's Linyup plan tier — selects the take-rate. */
  tier: SaasPlan
  /** Gross charge amount in Rappen (integer minor units). */
  amount: number
  /**
   * Onboarding model. Reserved: both models currently use the same take-rate and
   * fee-payer (account), but the fee function takes the model so per-model
   * adjustments can be added without touching call sites. See the brief §6.
   */
  model?: ConnectOnboardingModel
}

/**
 * Pure take-rate math against an explicit rate. Kept separate from
 * computePlatformFee so the rounding / min-fee / clamp branches are unit-testable
 * with synthetic rates (the live config currently has minFeeRappen = 0).
 *
 * Returns the fee in INTEGER Rappen:
 *   • amount <= 0   → 0                       (zero-fee handling)
 *   • otherwise     → floor(amount * bps / 10000), raised to minFeeRappen, then
 *                     clamped to never exceed `amount`.
 *
 * Throws if `amount` is not an integer — guards against accidental float Rappen.
 */
export function applyTakeRate(amount: number, rate: ConnectTakeRate): number {
  if (!Number.isInteger(amount)) {
    throw new Error(`applyTakeRate: amount must be an integer (Rappen), got ${amount}`)
  }
  if (amount <= 0) return 0

  // Integer math only: floor(amount * bps / 10000).
  let fee = Math.floor((amount * rate.bps) / 10000)

  // Minimum-fee handling (e.g. cover fixed costs on tiny charges).
  if (rate.minFeeRappen > 0) fee = Math.max(fee, rate.minFeeRappen)

  // The platform fee can never exceed the charge itself (Stripe rejects it, and
  // a min-fee on a sub-min charge would otherwise over-charge).
  return Math.min(fee, amount)
}

/**
 * THE central platform-fee calculation. One function, config-driven, used by both
 * the Cloud Functions (to set application_fee_amount) and the web UI (to display
 * the take-rate). No magic numbers anywhere else. Unknown tier falls back to the
 * highest (free) rate, never zero — so a misconfiguration never silently ships a
 * free transaction.
 */
export function computePlatformFee({ tier, amount }: PlatformFeeInput): number {
  const rate = CONNECT_TAKE_RATE[tier] ?? CONNECT_TAKE_RATE.free
  return applyTakeRate(amount, rate)
}

/**
 * The take-rate as a PERCENT, for recurring subscriptions where Stripe applies
 * the platform fee per invoice via `application_fee_percent` (a percentage, not a
 * fixed Rappen amount). 200 bps → 2. Min-fee does not apply to the percent path.
 * Same central config as computePlatformFee — never hardcode a percentage.
 */
export function takeRatePercent(tier: SaasPlan): number {
  return (CONNECT_TAKE_RATE[tier] ?? CONNECT_TAKE_RATE.free).bps / 100
}

// ─── Connected-account state ────────────────────────────────────────────────────
// Persisted at connect_accounts/{stripeAccountId} (TOP-LEVEL, keyed by the Stripe
// account id) so the Connect webhook can resolve event.account → teamId with a
// single direct doc read — no reverse query, no composite index. A pointer
// (teams/{teamId}.payments.connectAccountId) is mirrored for the dashboard.
export type ConnectAccountStatus =
  | 'pending' // account created, onboarding not yet complete
  | 'restricted' // requirements due or a capability disabled — needs attention
  | 'enabled' // charges_enabled && payouts_enabled
  | 'rejected' // Stripe rejected the account

export interface ConnectAccount {
  teamId: string
  /** Stripe connected account id (acct_...). Also the Firestore doc id. */
  stripeAccountId: string
  model: ConnectOnboardingModel
  status: ConnectAccountStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  /**
   * Capability → state map (e.g. { card_payments: 'active', twint_payments: 'pending' }).
   * Phase 1 requires card_payments + twint_payments active before charging.
   */
  capabilities: Record<string, string>
  /** Requirements Stripe needs now, for the "finish setup" UX. Never contains PII values. */
  requirements_currently_due: string[]
  /** Set when a capability is disabled (e.g. 'requirements.past_due'). */
  requirements_disabled_reason?: string | null
  default_currency: string // 'chf' in Phase 1
  /** Idempotency: last processed account.updated / capability.updated event id. */
  last_event_id?: string
  created_at: Timestamp
  updated_at: Timestamp
}

// ─── One-off payments (direct charge) ────────────────────────────────────────────
// Persisted at teams/{teamId}/member_payments/{paymentIntentId}. Function-written
// only; never trusted from the client. Reconciled from webhook events.
export type MemberPaymentStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded' // fully refunded
  | 'partially_refunded'

export interface MemberPaymentRefund {
  refundId: string // re_...
  amount: number // Rappen refunded
  /** Application fee reversed for this refund (Rappen) — proportional to the refund. */
  feeReversed: number
  reason?: string
  created_at: Timestamp
}

export interface MemberPayment {
  teamId: string
  /** Stripe PaymentIntent id (pi_...). Also the Firestore doc id. */
  paymentIntentId: string
  chargeId?: string // ch_... (populated on success)
  /** Linyup contact this payment is for, when known. */
  contactId?: string | null
  /** Free-form purpose tag, e.g. 'drop_in' | 'belt_test' | 'shop'. */
  purpose: string
  description?: string
  amount: number // gross Rappen
  currency: string // 'chf'
  /** Platform application fee taken (Rappen) — from computePlatformFee. */
  application_fee_amount: number
  status: MemberPaymentStatus
  amount_refunded: number // cumulative Rappen refunded
  refunds: MemberPaymentRefund[]
  // Dispute / chargeback (set by charge.dispute.* events). Liability depends on
  // the onboarding model: BYO → studio; Managed → Stripe.
  dispute_status?: string
  dispute_reason?: string | null
  dispute_amount?: number | null
  /** Idempotency: last processed payment_intent/charge event id for this doc. */
  last_event_id?: string
  created_at: Timestamp
  updated_at: Timestamp
}

// ─── Recurring memberships (subscription on the connected account) ────────────────
// Persisted at teams/{teamId}/member_subscriptions/{subscriptionId}.
export type MemberSubscriptionStatus =
  | 'incomplete'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'

export interface MemberSubscription {
  teamId: string
  /** Stripe Subscription id (sub_...), on the connected account. Also the doc id. */
  subscriptionId: string
  /** Stripe Customer id (cus_...) on the connected account. */
  customerId: string
  contactId?: string | null
  priceId: string
  amount: number // per-period Rappen
  currency: string // 'chf'
  /** Platform fee taken per invoice, as a percent (Stripe application_fee_percent). */
  application_fee_percent?: number
  status: MemberSubscriptionStatus
  current_period_end: Timestamp | null
  cancel_at_period_end: boolean
  /**
   * Payment method used, e.g. 'card' | 'twint'. TWINT recurring has a hard
   * constraint: only ONE active TWINT mandate per studio↔member pair.
   */
  payment_method_kind?: string
  // Latest invoice outcome (set by invoice.paid / invoice.payment_failed).
  last_invoice_id?: string
  last_payment_status?: 'paid' | 'failed'
  /** Idempotency: last processed subscription/invoice event id for this doc. */
  last_event_id?: string
  created_at: Timestamp
  updated_at: Timestamp
}
