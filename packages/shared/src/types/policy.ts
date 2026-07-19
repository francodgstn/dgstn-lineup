// No-show policy (E5) — threshold-based fees collected via an EMAILED payment
// link (v1 deliberately does NOT auto-charge saved cards: off-session consent
// and compliance are a separate, reviewed follow-up).
//
// Model (TeamUp's Penalty System shape): every no-show increments the
// contact's strike counter; when it reaches the team's threshold a SINGLE fee
// is created, the counter resets, and the contact gets a payment link. Fees
// live at teams/{teamId}/policy_fees/{feeId} (manager read, function writes);
// managers can waive. v1 counts NO-SHOWS only — late-cancel windows need a
// per-activity cancellation policy first (documented follow-up).

import type { Timestamp } from './common'

/** Team settings under teams/{id}.settings.noShowPolicy. Off by default. */
export interface NoShowPolicySettings {
  enabled: boolean
  /** The fee (major units, team currency), charged per THRESHOLD reached. */
  feeAmount: number
  /** Strikes that trigger one fee (≥1). TeamUp-style: never per incident. */
  threshold: number
}

export type PolicyFeeStatus = 'pending' | 'paid' | 'waived'

export interface PolicyFee {
  id: string
  teamId: string
  contactId: string
  contactName?: string | null
  contactEmail?: string | null
  /** Major units, team currency. */
  amount: number
  currency: string
  status: PolicyFeeStatus
  /** The no-show bookings that accumulated to this fee: 'sessionId/bookingId'. */
  strike_booking_refs: string[]
  created_at?: Timestamp
  paid_at?: Timestamp | null
  payment_intent_id?: string | null
  waived_at?: Timestamp | null
  waived_by?: string | null
}

/** Parse the settings bag defensively; null = policy off. */
export function resolveNoShowPolicy(settings: unknown): NoShowPolicySettings | null {
  const raw = (settings as { noShowPolicy?: Partial<NoShowPolicySettings> } | undefined)
    ?.noShowPolicy
  if (!raw || raw.enabled !== true) return null
  if (typeof raw.feeAmount !== 'number' || raw.feeAmount <= 0) return null
  const threshold =
    typeof raw.threshold === 'number' && raw.threshold >= 1 ? Math.floor(raw.threshold) : 3
  return { enabled: true, feeAmount: raw.feeAmount, threshold }
}
