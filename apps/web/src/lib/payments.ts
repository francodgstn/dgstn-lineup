// Shared helpers for the unified payments view (general /payments page + the
// per-contact Payments tab). Connect (member_payments) and BYO (payment_events)
// have different shapes; we normalize both into UnifiedPaymentRow so the UI treats
// them the same — amount, status, contact assignment, and the "what was paid"
// comment (explicit comment, falling back to a derived label).

import type { MemberPayment, ExternalPayment } from '@linyup/shared'

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
  /** Raw status; Connect = MemberPaymentStatus, BYO = 'paid'. */
  status: string
  /** Explicit free-text comment, if set. */
  comment: string | null
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

export function formatPaymentDate(ts: { toDate?: () => Date } | null | undefined): string {
  const d = ts?.toDate?.()
  return d ? d.toLocaleDateString() : ''
}

/** The label to show for "what was paid": explicit comment, else derived default. */
export function paymentLabel(row: UnifiedPaymentRow): string {
  return (row.comment && row.comment.trim()) || row.defaultLabel
}

function connectDefaultLabel(p: MemberPayment): string {
  const anyP = p as MemberPayment & {
    kind?: string
    productName?: string | null
    variantLabel?: string | null
    courseName?: string | null
  }
  if (anyP.kind === 'product') {
    return anyP.variantLabel
      ? `${anyP.productName ?? 'Product'} · ${anyP.variantLabel}`
      : anyP.productName ?? 'Product'
  }
  if (anyP.kind === 'course') return anyP.courseName ?? 'Course'
  return p.purpose || 'Payment'
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
    comment: p.comment ?? null,
    defaultLabel: connectDefaultLabel(p),
    createdAt: (p.created_at as unknown as { toDate?: () => Date }) ?? null,
    feeAmount: p.application_fee_amount ?? 0,
    refundable: p.status === 'succeeded' || p.status === 'partially_refunded',
    disputed: !!p.dispute_status,
    amountRefunded: p.amount_refunded ?? 0,
  }))
}

export function byoToUnified(events: Array<ExternalPayment & { id: string }>): UnifiedPaymentRow[] {
  return events.map((e) => ({
    key: `byo:${e.id}`,
    source: 'byo' as const,
    paymentId: e.id,
    gateway: e.gateway, // 'payrexx' | 'stripe'
    contactId: e.contact_id ?? null,
    assigned: (e.assignment_status ?? (e.contact_id ? 'assigned' : 'unassigned')) === 'assigned',
    email: e.email ?? null,
    amount: e.amount ?? 0,
    currency: e.currency ?? 'CHF',
    status: 'paid',
    comment: e.comment ?? null,
    defaultLabel: e.gateway === 'payrexx' ? 'Payrexx payment' : 'Stripe payment',
    createdAt: (e.processed_at as unknown as { toDate?: () => Date }) ?? null,
    feeAmount: 0, // BYO has no platform fee — money never touches Linyup
    refundable: false, // BYO is record-only — refunds happen in the studio's own gateway
    disputed: false,
    amountRefunded: 0,
  }))
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
