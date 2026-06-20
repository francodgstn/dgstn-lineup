import type { Timestamp } from './common'

// Types for the Brevo-backed mail pipeline (packages/functions/src/mail/).
// nDSG note: we persist Brevo references/IDs and minimal status only — never
// message bodies or PII beyond the recipient address needed for suppression.

// Why a recipient was suppressed. Mirrors the Brevo events that mean "stop
// sending here": a hard bounce, an explicit block, a spam complaint, or an
// address Brevo rejected as invalid.
export type MailSuppressionReason = 'hardBounce' | 'blocked' | 'spam' | 'invalid' | 'unsubscribed'

// One suppressed recipient. Doc id = sha256(lowercased email) so we never use a
// raw address as a document key. Checked before every send; a present doc means
// the address is dead/complained and must be skipped.
export interface MailSuppression {
  email: string
  reason: MailSuppressionReason
  provider_message_id?: string
  created_at: Timestamp
  updated_at: Timestamp
}

// Idempotency + delivery ledger. Doc id = the idempotency key the caller passed
// (or a hash of the message). Guards against duplicate sends on retry and records
// the last provider event for the message.
export interface MailSendRecord {
  idempotency_key: string
  provider: 'brevo'
  provider_message_id?: string
  // 'studio' mail is sent on behalf of a team; 'system' mail is Linyup's own.
  stream: 'system' | 'studio'
  team_id?: string
  status: 'sent' | 'delivered' | 'bounced' | 'blocked' | 'spam' | 'failed'
  created_at: Timestamp
  updated_at: Timestamp
}

// Shape of a single Brevo transactional webhook event (the subset we consume).
// https://developers.brevo.com/docs/transactional-webhooks
export interface BrevoWebhookEvent {
  event: string            // delivered | hardBounce | softBounce | blocked | spam | invalid | …
  email: string
  'message-id'?: string
  messageId?: string
  reason?: string
  ts?: number
  tag?: string
  tags?: string[]
}
