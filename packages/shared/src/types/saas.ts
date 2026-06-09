import type { Timestamp } from './common'
import type { SaasPlan, SaasStatus } from './team'
import type { PaymentGatewayType } from './integration'

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
  cancel_at_period_end: boolean
  gateway_type: PaymentGatewayType | null  // null = manually managed
  gateway_data: {
    customer_id?: string
    subscription_id?: string
    last_invoice_id?: string
    last_payment_status?: string
    last_event_id?: string               // idempotency: last processed webhook event ID
    // Active paid plugin add-ons (Coach plan) → their Stripe subscription items.
    activeAddOns?: Array<{ pluginId: string; itemId: string }>
    // Contact overage: the per-student subscription item + its current quantity
    // (contacts over the plan's included count). Synced by syncContactOverage.
    overage?: { itemId: string; quantity: number }
  } | null
  created_at: Timestamp
  updated_at: Timestamp
}
