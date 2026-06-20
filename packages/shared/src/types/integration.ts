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

export type IntegrationType = 'payment_gateway' | 'email_sender'

// ─── Email sending (Brevo ESP) ────────────────────────────────────────────────
// Outbound mail is sent through Brevo's transactional API (see
// packages/functions/src/mail/). A studio's *sender identity* is resolved from
// the EmailSenderConfig below; there are NO stored mail credentials for anyone —
// the Brevo API key is server-side only (Secret Manager) and BYO domains are
// authenticated via the studio's own DNS, never a password.

// 'managed'   → send from a Linyup-controlled address on linyup.com with the
//               studio's name as the display name and the studio's contact email
//               as Reply-To. Zero setup; the fallback for everyone.
// 'byo_domain'→ send from the studio's own verified domain (DKIM-authenticated in
//               Brevo). Falls back to 'managed' automatically until verified.
export type SenderModel = 'managed' | 'byo_domain'

// Mirrors Brevo's domain authentication lifecycle. We only send as a BYO domain
// once it is 'verified'.
export type DomainVerificationStatus = 'pending' | 'verified' | 'failed'

// A DNS record the studio must add to authenticate their domain. Surfaced to the
// studio verbatim from Brevo's createDomain/getDomainConfiguration response.
export interface EmailDnsRecord {
  purpose: 'dkim' | 'brevo_code' | 'dmarc'
  type: string   // DNS record type (TXT, CNAME, …)
  host: string   // host_name to create
  value: string  // record value
  verified?: boolean // Brevo's per-record status at last check
}

// Per-studio (team or org) sender configuration. Stored at
// teams|organizations/{id}/integrations/email_sender. Owners/org-admins only.
// Contains NO credentials — authentication for BYO is via the studio's DNS.
export interface EmailSenderConfig {
  type: 'email_sender'
  model: SenderModel
  // BYO only ────────────────────────────────────────────────────────────────
  domain?: string                 // e.g. 'theirdojo.ch'
  from_local_part?: string        // local part of the From address, default 'info'
  brevo_domain_id?: number        // Brevo's domain id (from createDomain)
  verification_status?: DomainVerificationStatus
  dns_records?: EmailDnsRecord[]  // records to display to the studio
  last_checked_at?: Timestamp     // last time we polled Brevo for status
  // ───────────────────────────────────────────────────────────────────────────
  updatedAt: Timestamp
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
