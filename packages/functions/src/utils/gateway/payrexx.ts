import type { PayrexxGatewayConfig } from '@lineup/shared'
import type { GatewayAdapter, CheckoutSession, Invoice, WebhookEvent } from './interface'

// Payrexx adapter — stub pending implementation.
// Reference: https://developers.payrexx.com/docs
//
// Key Payrexx API endpoints to implement:
//   POST /v1/Gateway/         — create a hosted payment gateway (checkout)
//   DELETE /v1/Subscription/{id}/ — cancel a subscription
//   GET /v1/Invoice/          — list invoices
//   Webhook: validate HMAC-SHA256 signature in X-Payrexx-Signature header

export class PayrexxAdapter implements GatewayAdapter {
  constructor(private config: PayrexxGatewayConfig) {}

  async createCheckoutSession(_params: {
    teamId: string
    plan: string
    customerEmail: string
    successUrl: string
    cancelUrl: string
    idempotencyKey: string
  }): Promise<CheckoutSession> {
    throw new Error('PayrexxAdapter.createCheckoutSession not yet implemented')
  }

  async cancelSubscription(_params: { subscriptionId: string }): Promise<void> {
    throw new Error('PayrexxAdapter.cancelSubscription not yet implemented')
  }

  async parseWebhook(_params: {
    payload: string | Buffer
    signature: string
    secret: string
  }): Promise<WebhookEvent> {
    throw new Error('PayrexxAdapter.parseWebhook not yet implemented')
  }

  async fetchInvoices(_params: { customerId: string; limit?: number }): Promise<Invoice[]> {
    throw new Error('PayrexxAdapter.fetchInvoices not yet implemented')
  }
}
