import type { Timestamp } from './common'

// Extensible payment gateway plugin architecture.
// New gateways are added by defining a new type literal and a matching config type.

export type PaymentGatewayType = 'stripe' | 'payrexx'

export interface StripeGatewayConfig {
  type: 'stripe'
  publishable_key: string
  // Secret key stored in Firebase Secret Manager, not in Firestore
  webhook_secret_ref?: string
  currency: string
}

export interface PayrexxGatewayConfig {
  type: 'payrexx'
  instance_name: string
  // API secret stored in Firebase Secret Manager, not in Firestore
  api_secret_ref?: string
  currency: string
}

export type PaymentGatewayConfig = StripeGatewayConfig | PayrexxGatewayConfig

export type IntegrationType = 'payment_gateway'

export interface TeamIntegration {
  id: string
  teamId: string
  type: IntegrationType
  enabled: boolean
  config: PaymentGatewayConfig
  created: Timestamp
  createdBy: string
  updated_at?: Timestamp
}
