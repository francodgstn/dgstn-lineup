import type { Timestamp } from './common'
import type { SaasPlan, SaasStatus } from './team'
import type { PaymentGatewayType } from './integration'
import type { SubscriptionCancellationDetails } from '../utils/subscriptionLifecycle'

export interface SaasSubscription {
  entity_type: 'team' | 'org'
  entity_id: string
  /** @deprecated use entity_id instead */
  teamId: string
  plan: SaasPlan
  status: SaasStatus
  trial_ends_at: Timestamp | null
  current_period_start: Timestamp | null
  current_period_end: Timestamp | null
  /**
   * The studio's subscription is scheduled to end rather than renew. TRUE for
   * both ways Stripe expresses that — see MemberSubscription.cancel_at_period_end
   * and shared/utils/subscriptionLifecycle.ts; this drives ACTIONS (which of
   * Cancel / Reactivate the billing page offers), not just a label.
   */
  cancel_at_period_end: boolean
  /**
   * WHEN it ends, when Stripe told us. Absent on docs written before this field
   * existed; `subscriptionEndsAt()` is what falls back to `current_period_end`
   * for those, so read it through the predicate rather than repeating the
   * choice. See MemberSubscription.cancel_at for what it does NOT mean.
   */
  cancel_at?: Timestamp | null
  /** WHEN the studio asked to leave — the start of the win-back window. */
  canceled_at?: Timestamp | null
  /**
   * WHY the studio is leaving. Written whole or null, same rule as
   * MemberSubscription.cancellation_details. On this rail the churn feedback is
   * read by the operator console: a studio that left over price and a studio
   * whose card failed are the same `status: 'cancelled'` and completely
   * different conversations.
   */
  cancellation_details?: SubscriptionCancellationDetails | null
  gateway_type: PaymentGatewayType | null  // null = manually managed
  gateway_data: {
    customer_id?: string
    subscription_id?: string
    last_invoice_id?: string
    last_payment_status?: string
    last_event_id?: string               // idempotency: last processed webhook event ID
    // Active paid plugin add-ons (Coach plan) → their Stripe subscription items.
    activeAddOns?: Array<{ pluginId: string; itemId: string }>
  } | null
  created_at: Timestamp
  updated_at: Timestamp
}
