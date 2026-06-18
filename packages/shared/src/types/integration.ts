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
  // Webhook signing secret (from Payrexx dashboard) — stored in Firestore, owners only.
  // Used by handlePayrexxWebhook to verify X-Webhook-Signature (HMAC-SHA256, hex).
  webhook_signing_secret?: string
  // Fallback subscription_type_id when transaction.referenceId is blank.
  default_subscription_type_id?: string
}

export type PaymentGatewayConfig = StripeGatewayConfig | PayrexxGatewayConfig

export type IntegrationType = 'payment_gateway' | 'email_smtp'

export interface SmtpIntegration {
  type: 'email_smtp'
  host: string
  port: number
  secure: boolean        // true = TLS on connect (port 465), false = STARTTLS (port 587)
  user: string
  password_enc: string   // AES-256-GCM encrypted ciphertext (base64)
  from_name: string
  from_email: string
  use_org_smtp?: boolean // team-level only: if true, ignore above and use org config
  updatedAt: Timestamp
}

// Platform-wide ("global") SMTP fallback, stored at
// app_settings/global_settings.nodemailer_smtp. It is the bottom of the
// team → org → global hierarchy resolved by getSmtpTransporter. The non-secret
// fields live here; the password lives in the `smtp-password` Secret Manager
// secret (read by getSMTPConfig). Edited from the operator console (apps/admin).
export interface GlobalSmtpSettings {
  host: string
  port: number
  secure: boolean          // true = TLS on connect (465), false = STARTTLS (587)
  auth: {
    user: string
  }
  // True once a password has been written to the `smtp-password` secret.
  // The password itself is never stored in Firestore.
  password_set?: boolean
  password_updated_at?: Timestamp
  updated_at?: Timestamp
  updated_by?: string      // operator email that last saved the config
}

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
