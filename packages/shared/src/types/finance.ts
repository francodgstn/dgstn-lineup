// Finance journal — the normalized, immutable, per-team transaction log that all
// financial reporting (and the future double-entry accounting plugin) derives from.
//
// One row per MONEY EVENT, across every rail:
//   • Stripe Connect  (member → studio; charges, refunds, disputes, payouts)
//   • BYO Stripe      (studio's own Stripe account; charges only — fee-blind)
//   • Payrexx         (studio's own Payrexx account; charges only — fee-blind)
//   • Manual          (cash / bank transfer / TWINT recorded by hand)
//
// Stored at teams/{teamId}/finance_transactions/{txnId} (FINANCE_TRANSACTIONS_
// SUBCOLLECTION). Doc id is DETERMINISTIC (financeTxnId) so webhook retries,
// duplicate event delivery, and backfill re-runs all converge on one row —
// writers use create() and swallow ALREADY_EXISTS.
//
// Dedupe rule (which sources feed the journal):
//   • Connect      → teams/{id}/member_payments (+ payout events, no Firestore mirror)
//   • BYO/manual   → teams/{id}/payment_events
//   • courses/{id}/purchases and contacts/{id}/credit_grants are NEVER read —
//     they duplicate the member_payments PaymentIntent rows.
//
// Sign convention (LOCKED): every amount is a SIGNED INTEGER in minor units
// (Rappen/cents), from the STUDIO's point of view. `net` is what actually moved
// on the studio's gateway balance (or till). Fees are negative when a cost.
// Invariant, enforced by every builder:  gross + stripe_fee + platform_fee === net
// EXCEPTION: 'payout' rows are pure balance movements (gross and fees are 0 by
// design; net = -payout.amount) — the invariant deliberately does not apply.
//
//   charge   gross +5000, stripe_fee  -145, platform_fee  -35 → net +4820
//   refund   gross -2000, stripe_fee     0, platform_fee  +14 → net -1986
//   dispute  gross -5000, stripe_fee -1500, platform_fee    0 → net -6500
//   payout   gross     0, stripe_fee     0, platform_fee    0 → net -12000
//
// Immutability: financial fields (type/gross/fees/net/currency/occurred_at) are
// NEVER mutated after create. The only permitted post-create mutations:
//   • payout_id / contact_id — linkage metadata, not money
//   • fee upgrade — fee fields + fee_source only, and only while
//     fee_source !== 'balance_transaction' (backfill improving a degraded row)
//   • status → 'corrected' + a compensating 'adjustment' row (`corrects`)
// Errors are fixed by new rows, never edits — this is what makes the journal
// replayable into double-entry postings.
//
// ─── Double-entry posting map (consumed by the accounting plugin) ─────────────
// Account codes are the ch_kmu template defaults; the posting engine reads codes
// exclusively from AccountingSettings.mapping, never these literals.
//
// | type              | Debit                                          | Credit                          |
// |-------------------|------------------------------------------------|---------------------------------|
// | charge (gateway)  | clearing[source] net · 6940 -stripe_fee ·      | revenue[category] gross         |
// |                   | 6941 -platform_fee                             |                                 |
// | charge (manual)   | 1000 Cash gross                                | revenue[category] gross         |
// | refund            | revenue[category] -gross                       | clearing[source] -net ·         |
// |                   |                                                | 6941 platform_fee (fee return)  |
// | dispute           | 3901 chargebacks -gross · 6940 -stripe_fee     | clearing[source] -net           |
// | dispute_reversal  | clearing[source] net                           | 3901 gross · 6940 fee return    |
// | payout            | 1020 Bank -net                                 | clearing[source] -net           |
// | adjustment        | free-form balanced pair                        |                                 |

import type { Timestamp } from './common'

// ─── Core enums ───────────────────────────────────────────────────────────────

export type FinanceTxnSource = 'connect' | 'byo_stripe' | 'payrexx' | 'manual'

export type FinanceTxnType =
  | 'charge'
  | 'refund'
  | 'dispute'
  | 'dispute_reversal'
  | 'payout'
  | 'adjustment'

export type FinanceCategory = 'membership' | 'drop_in' | 'course' | 'product' | 'other'

/**
 * Where the fee breakdown came from:
 *   balance_transaction — fetched from Stripe (authoritative gross/fee/net split)
 *   recorded            — from our own record only (platform fee known, Stripe fee 0);
 *                         the backfill can later upgrade these to balance_transaction
 *   none                — BYO/manual rails: fees unknown by design, recorded as 0
 */
export type FinanceFeeSource = 'balance_transaction' | 'recorded' | 'none'

// ─── Row shape ────────────────────────────────────────────────────────────────

/**
 * Builder output — the pure, SDK-agnostic shape. The functions layer converts
 * `occurred_at_ms` to a Firestore Timestamp and stamps `recorded_at` server-side.
 */
export interface FinanceTransactionInput {
  id: string
  teamId: string
  type: FinanceTxnType
  source: FinanceTxnSource
  /** Rail-native reference: pi_/re_/dp_/po_ id, or the payment_events gatewayRef. */
  source_ref: string
  /** Firestore path of the origin doc (member_payments/... or payment_events/...). */
  source_doc?: string | null
  occurred_at_ms: number
  /** 'YYYY-MM' in the finance timezone — precomputed query key. */
  month: string
  /** Uppercase ISO 4217 — normalized on build (Connect events carry 'chf'). */
  currency: string
  gross: number
  stripe_fee: number
  platform_fee: number
  net: number
  fee_source: FinanceFeeSource
  balance_txn_id?: string | null
  /** Payout linkage (set by the payout handler / backfill) — mutable metadata. */
  payout_id?: string | null
  contact_id?: string | null
  category: FinanceCategory
  description?: string | null
  /**
   * VAT readiness ONLY — nothing computes or reports VAT yet, but DE (§19 UStG)
   * and IT (regime forfettario) thresholds are low, so the field exists from day
   * one. Journal writers currently store null; a future VAT module derives codes
   * from `category` (also stored) for history and stamps codes going forward.
   */
  tax_code?: string | null
  /** Provenance: Stripe event id, or 'backfill'. */
  last_event_id?: string | null
  // Payout rows only.
  payout_arrival_date_ms?: number | null
  payout_status?: 'paid' | 'failed'
}

/** Stored shape (Firestore document). */
export interface FinanceTransaction
  extends Omit<FinanceTransactionInput, 'occurred_at_ms' | 'payout_arrival_date_ms'> {
  occurred_at: Timestamp
  recorded_at: Timestamp
  status: 'recorded' | 'corrected'
  /** Adjustment rows: the txn id being corrected. */
  corrects?: string | null
  payout_arrival_date?: Timestamp | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Business timezone for period bucketing. CH/DE/IT all share CET/CEST today;
 * monthKey is parameterized so expanding beyond CET never touches call sites. */
export const FINANCE_TIMEZONE = 'Europe/Zurich'

/**
 * 'YYYY-MM' period key for a date in the given timezone. Uses the en-CA locale
 * (ISO-style formatting) — same idiom as analytics/platformMetrics.
 */
export function monthKey(date: Date | number, timeZone: string = FINANCE_TIMEZONE): string {
  const d = typeof date === 'number' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '00'
  return `${year}-${month}`
}

/** Uppercase ISO 4217 — fixes the 'chf' (Connect/Stripe) vs 'CHF' (BYO/manual)
 * inconsistency at the journal boundary. */
export function normalizeCurrency(currency?: string | null): string {
  return (currency ?? 'CHF').trim().toUpperCase() || 'CHF'
}

/** Sign flip that never produces JavaScript's -0. */
function neg(v: number): number {
  return v === 0 ? 0 : -v
}

/** Deterministic journal doc id — the idempotency key for every writer. */
export function financeTxnId(
  source: FinanceTxnSource,
  type: FinanceTxnType,
  sourceRef: string
): string {
  return `${source}:${type}:${sourceRef}`
}

/**
 * Map a rail-native sale kind to the journal category.
 * Connect rows carry MemberPayment.kind; BYO/manual rows carry line_item.kind
 * ('subscription' is the BYO spelling of a membership sale).
 */
export function mapCategory(kind?: string | null): FinanceCategory {
  switch (kind) {
    case 'membership':
    case 'subscription':
      return 'membership'
    case 'drop_in':
      return 'drop_in'
    case 'course':
      return 'course'
    case 'product':
      return 'product'
    default:
      return 'other'
  }
}

/** Throws unless all amounts are integers and gross + fees === net. Called by
 * every builder so a violating row can never be constructed. */
export function assertFinanceInvariant(txn: {
  id: string
  gross: number
  stripe_fee: number
  platform_fee: number
  net: number
}): void {
  for (const [field, v] of [
    ['gross', txn.gross],
    ['stripe_fee', txn.stripe_fee],
    ['platform_fee', txn.platform_fee],
    ['net', txn.net],
  ] as const) {
    if (!Number.isInteger(v)) {
      throw new Error(`finance txn ${txn.id}: ${field} must be an integer minor-unit amount, got ${v}`)
    }
  }
  if (txn.gross + txn.stripe_fee + txn.platform_fee !== txn.net) {
    throw new Error(
      `finance txn ${txn.id}: invariant violated — gross(${txn.gross}) + stripe_fee(${txn.stripe_fee}) + platform_fee(${txn.platform_fee}) !== net(${txn.net})`
    )
  }
}

// ─── Row builders (pure — shared by webhooks, backfill, and tests) ────────────

/** Fee breakdown fetched from a charge's balance transaction (all values are
 * POSITIVE magnitudes as Stripe reports them; builders apply signs). */
export interface ConnectChargeFees {
  /** Stripe processing fee (fee_details type 'stripe_fee'). */
  stripeFee: number
  /** Application fee per fee_details (type 'application_fee'); authoritative when
   * present — cross-checks MemberPayment.application_fee_amount. */
  applicationFee: number | null
  /** bt.net — what landed on the studio's Stripe balance. */
  net: number
  balanceTxnId: string
}

export function buildConnectChargeTxn(params: {
  teamId: string
  paymentIntentId: string
  amount: number // gross Rappen (pi.amount)
  currency?: string | null
  /** Our recorded platform fee (pi.application_fee_amount). */
  applicationFeeAmount: number
  /** Balance-transaction breakdown, or null when the fetch failed/skipped. */
  fees: ConnectChargeFees | null
  kind?: string | null // MemberPayment.kind
  contactId?: string | null
  description?: string | null
  occurredAtMs: number
  eventId?: string | null
}): FinanceTransactionInput {
  const gross = params.amount
  // fee_details is authoritative when fetched; our recorded fee otherwise.
  const platformFeeAbs = params.fees?.applicationFee ?? params.applicationFeeAmount
  const stripeFeeAbs = params.fees?.stripeFee ?? 0
  const net = params.fees ? params.fees.net : gross - platformFeeAbs
  const txn: FinanceTransactionInput = {
    id: financeTxnId('connect', 'charge', params.paymentIntentId),
    teamId: params.teamId,
    type: 'charge',
    source: 'connect',
    source_ref: params.paymentIntentId,
    source_doc: `teams/${params.teamId}/member_payments/${params.paymentIntentId}`,
    occurred_at_ms: params.occurredAtMs,
    month: monthKey(params.occurredAtMs),
    currency: normalizeCurrency(params.currency),
    gross,
    stripe_fee: neg(stripeFeeAbs),
    platform_fee: neg(platformFeeAbs),
    net,
    fee_source: params.fees ? 'balance_transaction' : 'recorded',
    balance_txn_id: params.fees?.balanceTxnId ?? null,
    contact_id: params.contactId ?? null,
    category: mapCategory(params.kind),
    description: params.description ?? null,
    tax_code: null,
    last_event_id: params.eventId ?? null,
  }
  assertFinanceInvariant(txn)
  return txn
}

export function buildConnectRefundTxn(params: {
  teamId: string
  refundId: string
  paymentIntentId: string
  amount: number // Rappen refunded (positive)
  feeReversed: number // platform fee returned for this refund (positive)
  currency?: string | null
  kind?: string | null
  contactId?: string | null
  description?: string | null
  occurredAtMs: number
  eventId?: string | null
}): FinanceTransactionInput {
  // Stripe keeps its processing fee on refunds — stripe_fee stays 0.
  const txn: FinanceTransactionInput = {
    id: financeTxnId('connect', 'refund', params.refundId),
    teamId: params.teamId,
    type: 'refund',
    source: 'connect',
    source_ref: params.refundId,
    source_doc: `teams/${params.teamId}/member_payments/${params.paymentIntentId}`,
    occurred_at_ms: params.occurredAtMs,
    month: monthKey(params.occurredAtMs),
    currency: normalizeCurrency(params.currency),
    gross: neg(params.amount),
    stripe_fee: 0,
    platform_fee: params.feeReversed,
    net: neg(params.amount - params.feeReversed),
    fee_source: 'recorded',
    contact_id: params.contactId ?? null,
    category: mapCategory(params.kind),
    description: params.description ?? null,
    tax_code: null,
    last_event_id: params.eventId ?? null,
  }
  assertFinanceInvariant(txn)
  return txn
}

export function buildDisputeTxn(params: {
  teamId: string
  disputeId: string
  paymentIntentId: string
  /** Disputed amount (positive Rappen). */
  amount: number
  /**
   * Net balance movement from the dispute's balance transactions (SIGNED):
   * negative on withdrawal, positive on a won reversal. The dispute fee is
   * derived as the residual so the row always ties to Stripe's actual movement.
   */
  balanceNet: number
  kind: 'dispute' | 'dispute_reversal'
  currency?: string | null
  contactId?: string | null
  category?: FinanceCategory
  description?: string | null
  occurredAtMs: number
  eventId?: string | null
}): FinanceTransactionInput {
  const gross = params.kind === 'dispute' ? neg(params.amount) : params.amount
  // Residual = the dispute fee (withdrawal) or its refund (won reversal).
  const stripeFee = params.balanceNet - gross
  const txn: FinanceTransactionInput = {
    id: financeTxnId('connect', params.kind, params.disputeId),
    teamId: params.teamId,
    type: params.kind,
    source: 'connect',
    source_ref: params.disputeId,
    source_doc: `teams/${params.teamId}/member_payments/${params.paymentIntentId}`,
    occurred_at_ms: params.occurredAtMs,
    month: monthKey(params.occurredAtMs),
    currency: normalizeCurrency(params.currency),
    gross,
    stripe_fee: stripeFee,
    platform_fee: 0,
    net: params.balanceNet,
    fee_source: 'balance_transaction',
    contact_id: params.contactId ?? null,
    category: params.category ?? 'other',
    description: params.description ?? null,
    tax_code: null,
    last_event_id: params.eventId ?? null,
  }
  assertFinanceInvariant(txn)
  return txn
}

export function buildPayoutTxn(params: {
  teamId: string
  payoutId: string
  /** payout.amount (positive Rappen). */
  amount: number
  kind: 'paid' | 'failed'
  currency?: string | null
  occurredAtMs: number
  arrivalDateMs?: number | null
  description?: string | null
  eventId?: string | null
}): FinanceTransactionInput {
  // paid  → money leaves the Stripe balance for the bank (net negative).
  // failed → the bank returned the payout; funds are back on the balance.
  const net = params.kind === 'paid' ? neg(params.amount) : params.amount
  const ref = params.kind === 'paid' ? params.payoutId : `${params.payoutId}:failed`
  const txn: FinanceTransactionInput = {
    id: financeTxnId('connect', 'payout', ref),
    teamId: params.teamId,
    type: 'payout',
    source: 'connect',
    source_ref: params.payoutId,
    occurred_at_ms: params.occurredAtMs,
    month: monthKey(params.occurredAtMs),
    currency: normalizeCurrency(params.currency),
    gross: 0,
    stripe_fee: 0,
    platform_fee: 0,
    net,
    fee_source: 'balance_transaction',
    category: 'other',
    description:
      params.description ?? (params.kind === 'failed' ? 'Payout failed — funds returned' : 'Payout to bank'),
    tax_code: null,
    last_event_id: params.eventId ?? null,
    payout_id: params.payoutId,
    payout_arrival_date_ms: params.arrivalDateMs ?? null,
    payout_status: params.kind,
  }
  // net = 0 + 0 + 0 would violate the invariant — payouts are the one type where
  // gross is 0 by design, so the generic assertion is replaced by integer checks.
  if (!Number.isInteger(net)) throw new Error(`finance txn ${txn.id}: net must be an integer`)
  return txn
}

export function buildExternalPaymentTxn(params: {
  teamId: string
  gateway: 'payrexx' | 'stripe' | 'manual'
  gatewayRef: string
  amount: number // gross minor units (positive)
  currency?: string | null
  contactId?: string | null
  lineItemKind?: string | null
  description?: string | null
  occurredAtMs: number
  eventId?: string | null
}): FinanceTransactionInput {
  const source: FinanceTxnSource = params.gateway === 'stripe' ? 'byo_stripe' : params.gateway
  const docId = `${params.gateway}:${params.gatewayRef}`
  const txn: FinanceTransactionInput = {
    id: financeTxnId(source, 'charge', params.gatewayRef),
    teamId: params.teamId,
    type: 'charge',
    source,
    source_ref: params.gatewayRef,
    source_doc: `teams/${params.teamId}/payment_events/${docId}`,
    occurred_at_ms: params.occurredAtMs,
    month: monthKey(params.occurredAtMs),
    currency: normalizeCurrency(params.currency),
    gross: params.amount,
    // BYO gateways report no fee data; manual payments have none. Documented
    // limitation: net overstates by the gateway's fee until a manual entry books it.
    stripe_fee: 0,
    platform_fee: 0,
    net: params.amount,
    fee_source: 'none',
    contact_id: params.contactId ?? null,
    category: mapCategory(params.lineItemKind),
    description: params.description ?? null,
    tax_code: null,
    last_event_id: params.eventId ?? null,
  }
  assertFinanceInvariant(txn)
  return txn
}
