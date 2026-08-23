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
import {
  applyEmailPolicy,
  envDefaultMode,
  isSyntheticEmail,
  resolveMessagingPolicy,
} from './messagingPolicy'
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

/**
 * In TEST_MODE `dispatch` replaces every recipient with `testEmail` and bypasses
 * the policy layer below, so nothing addressed to a real person leaves a
 * developer's machine or a lead demo.
 *
 * It used to be EXPORTED, because one caller — the emailed guardian link, a
 * message whose delivery WAS the evidence — had to record the environment on the
 * artefact it wrote rather than merely react to it. That mechanism is gone, so
 * this is internal again. `requestWaiverAcceptance` does send mail, but it
 * records nothing about delivery — it asks somebody to sign and reports the
 * ordinary `SendOutcome` back to the manager, which needs no environment stamp.
 */
function isTestMode(): boolean {
  return testModeEnabled.value() === 'true'
}

/**
 * EXPORTED for the same reason, on the other axis: the kill switch is a fact
 * about the ENVIRONMENT and never about a recipient's address. `dispatch`
 * short-circuits on it before any Firestore work and writes no ledger row at
 * all, so "no row" alone cannot distinguish a disabled environment from a dead
 * mailbox — and filing an operator's configuration beside a hard bounce would
 * tell a studio that a parent's address is bad when nothing was ever sent.
 */
export function isMailEnabled(): boolean {
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

// Records a keyed send that was dropped before the provider (synthetic recipient
// or policy) so ledger gaps are explainable. Keyless sends are only console-logged.
async function writeSuppressedLedger(
  ledgerRef: FirebaseFirestore.DocumentReference | null,
  stream: MailStream,
  teamId: string | undefined,
  reason: 'synthetic' | 'policy_silent' | 'policy_allowlist',
): Promise<void> {
  if (!ledgerRef) return
  const now = FieldValue.serverTimestamp()
  try {
    await ledgerRef.set(
      {
        idempotency_key: ledgerRef.id,
        provider: 'brevo',
        stream,
        ...(teamId ? { team_id: teamId } : {}),
        status: 'suppressed',
        suppress_reason: reason,
        updated_at: now,
        created_at: now,
      },
      { merge: true },
    )
  } catch (err) {
    console.warn('[mail] failed to write suppressed ledger entry:', err)
  }
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

  // ── Recipients: test-mode redirect, else synthetic guard → policy → suppression ──
  let recipients = toArray(msg.to)
  if (testMode) {
    // Local-dev/CI convenience: redirect everything to one inbox. Deliberately
    // BYPASSES the per-tenant policy layer below.
    const redirect = testEmail.value()
    console.log(`[mail] TEST MODE → redirecting ${recipients.join(', ')} to ${redirect}`)
    recipients = redirect ? [redirect] : []
  } else {
    // Layer 1 — synthetic recipients (RFC-2606 reserved domains, i.e. seeded demo
    // contacts) never reach the provider, in ANY environment. Protects the Brevo
    // sender reputation from @example.com bounces on reseeds/automations.
    const synthetic = recipients.filter(isSyntheticEmail)
    if (synthetic.length) console.log(`[mail] dropping synthetic recipients: ${synthetic.join(', ')}`)
    recipients = recipients.filter((r) => !isSyntheticEmail(r))
    if (recipients.length === 0) {
      await writeSuppressedLedger(ledgerRef, stream, teamId, 'synthetic')
      return { skipped: true }
    }

    // Layer 2 — per-tenant delivery policy (operator-set; env default when absent).
    const entityId = stream === 'system' ? 'system' : (teamId ?? 'system')
    const policy = await resolveMessagingPolicy(entityId)
    const decision = applyEmailPolicy(recipients, policy, envDefaultMode())
    if (decision.droppedAll) {
      console.log(`[mail] policy '${policy?.mode ?? envDefaultMode()}' for '${entityId}' dropped all recipients (${decision.droppedAll})`)
      await writeSuppressedLedger(ledgerRef, stream, teamId, decision.droppedAll)
      return { skipped: true }
    }
    if (decision.recipients.join(',') !== recipients.join(',')) {
      console.log(`[mail] policy for '${entityId}' adjusted recipients: ${recipients.join(', ')} → ${decision.recipients.join(', ')}`)
    }
    recipients = decision.recipients

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
//
// TEST_MODE override: when TEST_MODE=true, the managed-studio sender
// (studios@linyup.com with an unverified studio display name) is not registered
// in the Brevo test account and would be rejected. Instead we fall back to the
// system sender (hello@linyup.com — verified) so local dev and CI can send
// without a registered managed sender. Production behavior is unchanged.
export async function sendEntityMail(
  scope: 'team' | 'org',
  entityId: string,
  msg: OutboundMessage,
  fallbackContactEmail?: string,
): Promise<SendOutcome> {
  if (isTestMode()) {
    // Use the verified system sender in test mode — avoids Brevo rejecting an
    // unverified managed From address (studios@linyup.com) in dev/CI.
    return dispatch(msg, getSystemSender(), 'studio', entityId)
  }
  const ctx =
    scope === 'team' ? await loadStudioContext(entityId) : await loadOrgContext(entityId, fallbackContactEmail)

  // ── AN UNVERIFIED SIGNUP DOES NOT GET TO SEND MAIL AS A STUDIO ─────────────
  // Anyone could sign up with an address they do not own and, within a minute,
  // have this product mailing strangers under a studio name. Verification is
  // what closes that, and the send is where it has to bite — a banner in the
  // dashboard asks nicely, it does not stop anything.
  //
  // BLOCKS ON AN EXPLICIT `false`, never on absence. The flag is written by
  // signup and by `confirmEmailVerified` from 2026-08-23 onward; every team that
  // existed before has no value at all, and reading that as "unverified" would
  // silence every studio on the platform. Failing open here is the correct
  // direction: the population it cannot see is the one that was never at risk.
  if (scope === 'team' && ctx.ownerEmailVerified === false) {
    console.warn(`[mail] blocked: team ${entityId} has not verified its email address`)
    return { skipped: true }
  }

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
