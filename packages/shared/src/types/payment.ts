// BYO (bring-your-own gateway) payment ledger — the minimal counterpart to the
// fully-integrated Stripe Connect rail (member_payments / member_subscriptions).
//
// A studio that wires its OWN Payrexx or Stripe account (no platform fee, money
// never touches Linyup) gets exactly one thing from Linyup: the payment is
// RECORDED against a contact. We do not run the checkout, manage refunds, or hold
// any credentials. Each confirmed payment lands here as an ExternalPayment, and a
// manager can (re)assign the contact + edit the comment from the payments
// dashboard / per-contact Payments tab.
//
// Stored at teams/{teamId}/payment_events/{id} (PAYMENT_EVENTS_SUBCOLLECTION),
// doc id = `${gateway}:${gatewayRef}` so a duplicate webhook delivery is a no-op.

import type { Timestamp } from './common'

export type ExternalPaymentGateway = 'payrexx' | 'stripe'

// Whether the payment has been linked to a Linyup contact. We record the payment
// either way — email is NOT a unique key (a parent's address can control several
// child contacts), so when zero or multiple active contacts match we leave it
// 'unassigned' and a manager links it, rather than silently guessing.
export type PaymentAssignmentStatus = 'assigned' | 'unassigned'

export interface ExternalPayment {
  /** Firestore doc id = `${gateway}:${gatewayRef}` (idempotency key). */
  id: string
  gateway: ExternalPaymentGateway
  /** The gateway's own reference: Payrexx transaction id / Stripe event id. */
  gatewayRef: string
  /** Linked Linyup contact, or null when unassigned (manager assigns later). */
  contact_id: string | null
  assignment_status: PaymentAssignmentStatus
  /** Payer email as reported by the gateway — used for matching + display. */
  email: string | null
  /** Gross amount in MINOR units (Rappen/cents), aligned with MemberPayment.amount. */
  amount: number | null
  currency: string
  /** Optional membership linkage, when the payment maps to a subscription type. */
  subscription_type_id?: string | null
  membership_expiration?: Timestamp | null
  /** Free-text "what was paid" — prefilled with a default suggestion on record. */
  comment?: string | null
  /** The gateway's raw status string (e.g. 'confirmed', 'succeeded'). */
  raw_status: string
  processed_at: Timestamp
  /** Set when a manager (re)assigns the contact via updatePaymentRecord. */
  assigned_by?: string | null
  assigned_at?: Timestamp | null
}

// ─── Comment presets ─────────────────────────────────────────────────────────
// Stable machine keys for the "what was paid" comment quick-pick. The displayed
// label is resolved in the frontend from the `PaymentComment` i18n namespace
// (`preset_<key>`); the STORED value is the resolved free-text string (free-text
// custom entries are also allowed). Keys are the stable identifier — never reuse
// or repurpose one. Surfaced as a combobox/datalist in the assign-payment dialog.
export const PAYMENT_COMMENT_PRESETS = [
  'subscription_signup',
  'subscription_renewal',
  'product',
  'course',
  'drop_in',
  'event',
  'other',
] as const

export type PaymentCommentPreset = (typeof PAYMENT_COMMENT_PRESETS)[number]
