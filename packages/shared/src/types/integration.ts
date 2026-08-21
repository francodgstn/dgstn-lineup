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
  // Webhook signing secret (whsec_… from the studio's Stripe dashboard) — stored
  // in Firestore, owners only. Used by handleTeamStripeWebhook to verify the
  // Stripe-Signature header (BYO is minimal: signature verify + record only, no
  // API calls, so no secret key is needed). Mirrors Payrexx's webhook_signing_secret.
  webhook_signing_secret?: string
  // Fallback subscription_type_id when a checkout/payment carries no
  // metadata.subscriptionTypeId — mirrors Payrexx's default.
  default_subscription_type_id?: string
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

export type IntegrationType = 'payment_gateway' | 'email_sender' | 'public_domain'

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

// ─── Custom public domain (Cloudflare for SaaS) ───────────────────────────────
// A studio serving its public surfaces from a hostname it owns
// (`book.theirdojo.ch`) instead of `linyup.com/public/{slug}`. Stored at
// teams|organizations/{id}/integrations/public_domain. Owners/org-admins only,
// server-written only, and — like EmailSenderConfig — it holds NO credentials:
// the Cloudflare API token is platform-level and lives in Secret Manager.
//
// Full design: docs/custom-domains.md.

// Mirrors the Cloudflare custom-hostname lifecycle, collapsed to the four states
// a studio can act on. `error` is terminal only until they fix DNS and re-check.
export type PublicDomainStatus =
  | 'pending'    // registered at Cloudflare; waiting for the studio's CNAME
  | 'verifying'  // CNAME seen; certificate being issued
  | 'active'     // serving
  | 'error'      // Cloudflare reported a problem — see `error`

// The ONE record the studio adds at their registrar. Ownership verification and
// certificate issuance both fall out of it resolving (Cloudflare HTTP
// validation), which is why there is no TXT step in the common case.
export interface PublicDomainDnsRecord {
  type: 'CNAME'
  host: string   // e.g. 'book' (or the full hostname, for registrars that want it)
  value: string  // the published target, e.g. 'connect.linyup.com'
}

export interface PublicDomainConfig {
  type: 'public_domain'
  /**
   * The PRIMARY hostname — the one that serves the tree.
   *
   * Singular on purpose. Extra hostnames are aliases that 301 into the primary
   * (docs/custom-domains.md: a subdomain is a separate origin and the contact's
   * session is origin-scoped), and when they ship they arrive as an OPTIONAL
   * `aliases` array beside this field. That is additive — no migration, and no
   * list-of-one to unwrap at every read in the meantime.
   */
  hostname: string
  /** Cloudflare's custom-hostname id — the handle for status polls and deletion. */
  cf_hostname_id: string
  status: PublicDomainStatus
  dns_record: PublicDomainDnsRecord
  /** Cloudflare's raw SSL status, for support ("pending_validation", "active", …). */
  ssl_status?: string
  /** Cloudflare's verification error, verbatim. Null once it clears. */
  error?: string | null
  last_checked_at?: Timestamp
  /** First time the hostname reached `active`. Never reset by a later error. */
  verified_at?: Timestamp | null
  updatedAt: Timestamp
}

// public_domains/{hostname} — the global uniqueness registry. Deliberately tiny:
// it answers "is this hostname claimed, and by whom" and nothing else.
export interface PublicDomainClaim {
  hostname: string
  scope: 'team' | 'org'
  entityId: string
  cf_hostname_id: string
  created_at: Timestamp
}
