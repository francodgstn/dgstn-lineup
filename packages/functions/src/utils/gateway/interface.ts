export type WebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'payment.succeeded'
  | 'payment.failed'

export interface WebhookEvent {
  type: WebhookEventType
  eventId: string           // gateway's unique event ID — used for idempotency
  teamId?: string
  orgId?: string
  customerId?: string
  subscriptionId?: string
  plan?: string
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  cancelAtPeriodEnd?: boolean
  amount?: number           // smallest currency unit (cents / rappen)
  currency?: string
  lastInvoiceId?: string
  lastPaymentStatus?: string
  // Subscription line items (present on subscription.created/updated) — used to
  // reconcile plugin add-ons. Each carries its Stripe item id + price lookup key.
  items?: Array<{ itemId: string; lookupKey?: string }>
  raw: unknown
}

export interface CheckoutSession {
  url: string
  sessionId: string
}

export interface Invoice {
  id: string
  amount: number            // smallest currency unit
  currency: string
  status: string
  created: Date
  hostedUrl?: string
  pdfUrl?: string
}

export interface GatewayAdapter {
  createCheckoutSession(params: {
    teamId?: string
    orgId?: string
    plan: string
    customerEmail: string
    successUrl: string
    cancelUrl: string
    idempotencyKey: string
  }): Promise<CheckoutSession>

  cancelSubscription(params: { subscriptionId: string }): Promise<void>

  parseWebhook(params: {
    payload: string | Buffer
    signature: string
    secret: string
  }): Promise<WebhookEvent>

  fetchInvoices(params: { customerId: string; limit?: number }): Promise<Invoice[]>
}
