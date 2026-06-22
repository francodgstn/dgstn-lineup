/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { defineString } from 'firebase-functions/params'
import { MAIL_SENDS_COLLECTION } from '@linyup/shared'
import { brevoProvider } from './brevoProvider'
import { getManagedStudioFrom, getSystemSender } from './senderIdentity'
import { resolveStudioSender } from './senderResolution'
import { loadOrgContext, loadStudioContext } from './senderConfig'
import { isSuppressed } from './suppression'
import type { MailProvider, OutboundMessage, ResolvedSender } from './types'

const testModeEnabled = defineString('TEST_MODE', {
  description: 'Redirect all outbound mail to a single test address',
  default: 'false',
})
const testEmail = defineString('TEST_EMAIL', {
  description: 'Recipient when TEST_MODE is enabled',
  default: '',
})
// Master kill switch for outbound mail. Set to "false" to disable ALL sending in
// an environment (e.g. the public sandbox/demo) — no Brevo calls, no quota use,
// no risk of mailing demo contacts. Defaults to enabled.
const mailEnabled = defineString('MAIL_ENABLED', {
  description: 'Set to "false" to disable all outbound mail in this environment',
  default: 'true',
})

// The active provider. Swappable for tests; in production it is always Brevo.
let provider: MailProvider = brevoProvider
export function __setMailProviderForTests(p: MailProvider): void {
  provider = p
}

export type MailStream = 'system' | 'studio'

export interface SendOutcome {
  providerMessageId?: string
  // True when the send was suppressed (all recipients dead) or deduped.
  skipped?: boolean
  testMode?: boolean
}

function isTestMode(): boolean {
  return testModeEnabled.value() === 'true'
}

function isMailEnabled(): boolean {
  return mailEnabled.value() !== 'false'
}

function toArray(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to]
}

// Retry only when an idempotency key is present — Brevo dedupes on the
// Idempotency-Key header, so a retried POST cannot double-send. Without a key we
// rely on the SDK's own bounded retries and do not risk duplicates here.
async function sendWithRetry(
  msg: OutboundMessage,
  sender: ResolvedSender,
): Promise<{ providerMessageId: string }> {
  const maxAttempts = msg.idempotencyKey ? 3 : 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await provider.send(msg, sender)
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        const backoffMs = 250 * 2 ** (attempt - 1)
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }
  }
  throw lastErr
}

async function dispatch(
  msg: OutboundMessage,
  sender: ResolvedSender,
  stream: MailStream,
  teamId?: string,
): Promise<SendOutcome> {
  if (!msg.to || !msg.subject || (!msg.html && !msg.text)) {
    throw new Error('Missing required email fields: to, subject, and html/text')
  }

  // Kill switch — short-circuit before any Brevo or Firestore work so a disabled
  // environment makes zero external calls.
  if (!isMailEnabled()) {
    console.log(`[mail] sending disabled (MAIL_ENABLED=false) — skipping ${stream} mail to ${toArray(msg.to).join(', ')}`)
    return { skipped: true }
  }

  const db = admin.firestore()
  const testMode = isTestMode()

  // ── Idempotency: skip a keyed send that already succeeded ──────────────────
  const ledgerRef = msg.idempotencyKey
    ? db.collection(MAIL_SENDS_COLLECTION).doc(msg.idempotencyKey)
    : null
  if (ledgerRef) {
    const existing = await ledgerRef.get()
    if (existing.exists && existing.data()?.status !== 'failed') {
      console.log(`[mail] idempotent skip for key ${msg.idempotencyKey}`)
      return { providerMessageId: existing.data()?.provider_message_id, skipped: true }
    }
  }

  // ── Recipients: test-mode redirect, else drop suppressed addresses ─────────
  let recipients = toArray(msg.to)
  if (testMode) {
    const redirect = testEmail.value()
    console.log(`[mail] TEST MODE → redirecting ${recipients.join(', ')} to ${redirect}`)
    recipients = redirect ? [redirect] : []
  } else {
    const checked = await Promise.all(
      recipients.map(async (email) => ({ email, suppressed: await isSuppressed(email) })),
    )
    const suppressed = checked.filter((c) => c.suppressed).map((c) => c.email)
    if (suppressed.length) console.warn(`[mail] skipping suppressed recipients: ${suppressed.join(', ')}`)
    recipients = checked.filter((c) => !c.suppressed).map((c) => c.email)
  }

  if (recipients.length === 0) {
    return { skipped: true, testMode }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  const result = await sendWithRetry({ ...msg, to: recipients }, sender)

  // ── Ledger (idempotency + delivery status linkage for the webhook) ─────────
  if (ledgerRef) {
    const now = FieldValue.serverTimestamp()
    await ledgerRef.set(
      {
        idempotency_key: msg.idempotencyKey,
        provider: 'brevo',
        provider_message_id: result.providerMessageId,
        stream,
        ...(teamId ? { team_id: teamId } : {}),
        status: 'sent',
        updated_at: now,
        created_at: now,
      },
      { merge: true },
    )
  }

  return { providerMessageId: result.providerMessageId, testMode }
}

// Linyup's own system mail — password reset, verification, receipts, platform
// notices. Sent from the configured system identity (hello@linyup.com).
export async function sendSystemMail(msg: OutboundMessage): Promise<SendOutcome> {
  return dispatch(msg, getSystemSender(), 'system')
}

// "Send as the studio" — resolves the entity's sender identity (Managed or a
// verified BYO domain) and sends on its behalf. Works for a team or an org.
export async function sendEntityMail(
  scope: 'team' | 'org',
  entityId: string,
  msg: OutboundMessage,
  fallbackContactEmail?: string,
): Promise<SendOutcome> {
  const ctx =
    scope === 'team' ? await loadStudioContext(entityId) : await loadOrgContext(entityId, fallbackContactEmail)
  const sender = resolveStudioSender({
    teamName: ctx.teamName,
    contactEmail: ctx.contactEmail,
    plan: ctx.plan,
    config: ctx.config,
    managedFrom: getManagedStudioFrom(),
  })
  return dispatch(msg, sender, 'studio', entityId)
}

// Convenience wrapper for the common team case (used by utils/email's façade).
export async function sendStudioMail(teamId: string, msg: OutboundMessage): Promise<SendOutcome> {
  return sendEntityMail('team', teamId, msg)
}

// Stable idempotency key helper for critical-path sends.
export function idempotencyKey(...parts: (string | undefined)[]): string {
  return createHash('sha256').update(parts.filter(Boolean).join(':')).digest('hex').slice(0, 32)
}
