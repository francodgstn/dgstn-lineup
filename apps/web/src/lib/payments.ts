// Shared helpers for the unified payments view (general /payments page + the
// per-contact Payments tab). Connect (member_payments) and BYO (payment_events)
// have different shapes; we normalize both into UnifiedPaymentRow so the UI treats
// them the same — amount, status, contact assignment, and the "what was paid"
// label (linked line item → explicit comment → derived gateway default).

import type { MemberPayment, ExternalPayment, PaymentLineItem } from '@linyup/shared'

export type PaymentSource = 'connect' | 'byo'

export interface UnifiedPaymentRow {
  /** Stable React key. */
  key: string
  source: PaymentSource
  /** PaymentIntent id (Connect) or payment_events doc id (BYO) — for updatePaymentRecord. */
  paymentId: string
  /** Human gateway label key suffix: 'connect' | 'payrexx' | 'stripe'. */
  gateway: string
  contactId: string | null
  assigned: boolean
  email: string | null
  amount: number // minor units (Rappen/cents)
  currency: string
  /** Raw status; Connect = MemberPaymentStatus, BYO = 'paid' | 'voided'. */
  status: string
  /** The record was un-recorded (manual rows only). The row is inert: it counts
   *  toward no total, offers no action, and renders struck through. */
  voided: boolean
  /** Can a manager void this row? Manual rows only, and only once — the BYO
   *  gateway rails carry money we do not control, so their ledger row may not be
   *  contradicted here (enforced server-side by voidManualPayment). */
  voidable: boolean
  /** Explicit free-text comment, if set. */
  comment: string | null
  /** Structured link (BYO/manual), for the assign dialog. Connect rows leave it null. */
  lineItem: PaymentLineItem | null
  /** The promo code this sale was discounted with, or null. Read off the line
   * item on BOTH rails — the Connect webhook stamps it from checkout metadata,
   * and a manual row can carry one only if a manager's row already had it (it is
   * never client-writable). This is the only place a discount is visible on the
   * money side: a promo writes no journal row and no CSV column. */
  promoCode: string | null
  /** Studio-configured mode for manual payments (Cash / TWINT / …); null otherwise. */
  paymentMode: string | null
  /** Derived "what was paid" label, used when comment is empty. */
  defaultLabel: string
  /** Timestamp-like (has .toDate()) for date formatting / sorting. */
  createdAt: { toDate?: () => Date } | null
  /** Platform application fee taken (Connect only; minor units). */
  feeAmount: number
  // Connect-only management affordances:
  refundable: boolean
  disputed: boolean
  amountRefunded: number
}

export function formatMoneyMinor(minor: number | null | undefined, currency: string): string {
  const cur = (currency || 'CHF').toUpperCase()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(
      (minor ?? 0) / 100
    )
  } catch {
    // Unknown currency code — fall back to a plain number + code.
    return `${((minor ?? 0) / 100).toFixed(2)} ${cur}`
  }
}

/** Same as formatMoneyMinor but for values already in major units (e.g. the
 * partner-visit payout ledger, entered in the studio's own currency). */
export function formatMoneyMajor(amount: number | null | undefined, currency: string): string {
  const cur = (currency || 'CHF').toUpperCase()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(
      amount ?? 0
    )
  } catch {
    return `${(amount ?? 0).toFixed(2)} ${cur}`
  }
}

export function formatPaymentDate(ts: { toDate?: () => Date } | null | undefined): string {
  const d = ts?.toDate?.()
  return d ? d.toLocaleDateString() : ''
}

/** Primary "what was paid" label: the linked line item (subscription / course /
 * product) wins, then the explicit comment, then the derived gateway default. */
export function paymentLabel(row: UnifiedPaymentRow): string {
  return (
    (row.lineItem?.label && row.lineItem.label.trim()) ||
    (row.comment && row.comment.trim()) ||
    row.defaultLabel
  )
}

/** Secondary note under the label: the comment, when the primary label already
 * shows the linked line item (avoids repeating identical text). */
export function paymentNote(row: UnifiedPaymentRow): string | null {
  const li = row.lineItem?.label?.trim()
  const c = row.comment?.trim()
  return li && c && c !== li ? c : null
}

function connectDefaultLabel(p: MemberPayment): string {
  if (p.kind === 'product') {
    return p.variantLabel
      ? `${p.productName ?? 'Product'} · ${p.variantLabel}`
      : (p.productName ?? 'Product')
  }
  if (p.kind === 'course') return p.courseName ?? 'Course'
  if (p.kind === 'membership') return p.subscriptionTypeName ?? 'Membership'
  return p.purpose || 'Payment'
}

/** Structured line item for a Connect row: the webhook-stamped one when
 * present, else a label-only fallback derived from kind/names (legacy rows) so
 * the assign/edit dialog's "What was paid" is never empty for a linked sale. */
function connectLineItem(p: MemberPayment): PaymentLineItem | null {
  if (p.line_item) return p.line_item
  if (p.kind === 'membership') {
    return { kind: 'subscription', label: p.subscriptionTypeName ?? 'Membership' }
  }
  if (p.kind === 'product') return { kind: 'product', label: connectDefaultLabel(p) }
  if (p.kind === 'course') return { kind: 'course', label: p.courseName ?? 'Course' }
  if (p.kind === 'drop_in') return { kind: 'drop_in', label: connectDefaultLabel(p) }
  return null
}

export function connectToUnified(payments: MemberPayment[]): UnifiedPaymentRow[] {
  return payments.map((p) => ({
    key: `connect:${p.paymentIntentId}`,
    source: 'connect' as const,
    paymentId: p.paymentIntentId,
    gateway: 'connect',
    contactId: p.contactId ?? null,
    assigned: !!p.contactId,
    email: null,
    amount: p.amount ?? 0,
    currency: p.currency ?? 'chf',
    status: p.status,
    // A Connect charge is never voided — its correction is a refund, which moves
    // real money and has its own row status.
    voided: false,
    voidable: false,
    comment: p.comment ?? null,
    lineItem: connectLineItem(p),
    // From the stored line item only — connectLineItem's legacy fallbacks are
    // synthesised from kind/names and can never carry a code.
    promoCode: p.line_item?.promoCode ?? null,
    paymentMode: null,
    defaultLabel: connectDefaultLabel(p),
    createdAt: (p.created_at as unknown as { toDate?: () => Date }) ?? null,
    feeAmount: p.application_fee_amount ?? 0,
    refundable: p.status === 'succeeded' || p.status === 'partially_refunded',
    disputed: !!p.dispute_status,
    amountRefunded: p.amount_refunded ?? 0,
  }))
}

export function byoToUnified(events: Array<ExternalPayment & { id: string }>): UnifiedPaymentRow[] {
  return events.map((e) => {
    // The rail's ONE status. It used to be hardcoded 'paid' because a BYO row
    // exists only because money arrived — true of the gateway rails still, and
    // no longer true of a manual row a manager has voided.
    const voided = !!e.voided_at
    return {
      key: `byo:${e.id}`,
      source: 'byo' as const,
      paymentId: e.id,
      gateway: e.gateway, // 'payrexx' | 'stripe' | 'manual'
      contactId: e.contact_id ?? null,
      assigned: (e.assignment_status ?? (e.contact_id ? 'assigned' : 'unassigned')) === 'assigned',
      email: e.email ?? null,
      amount: e.amount ?? 0,
      currency: e.currency ?? 'CHF',
      status: voided ? 'voided' : 'paid',
      voided,
      voidable: e.gateway === 'manual' && !voided,
      comment: e.comment ?? null,
      lineItem: e.line_item ?? null,
      promoCode: e.line_item?.promoCode ?? null,
      paymentMode: e.payment_mode ?? null,
      defaultLabel:
        e.gateway === 'payrexx'
          ? 'Payrexx payment'
          : e.gateway === 'manual'
            ? 'Manual payment'
            : 'Stripe payment',
      createdAt: (e.processed_at as unknown as { toDate?: () => Date }) ?? null,
      feeAmount: 0, // BYO has no platform fee — money never touches Linyup
      refundable: false, // BYO is record-only — refunds happen in the studio's own gateway
      disputed: false,
      amountRefunded: 0,
    }
  })
}

/** Merge + sort newest-first across both rails. */
export function mergePaymentRows(
  connect: UnifiedPaymentRow[],
  byo: UnifiedPaymentRow[]
): UnifiedPaymentRow[] {
  return [...connect, ...byo].sort((a, b) => {
    const ta = a.createdAt?.toDate?.()?.getTime() ?? 0
    const tb = b.createdAt?.toDate?.()?.getTime() ?? 0
    return tb - ta
  })
}
