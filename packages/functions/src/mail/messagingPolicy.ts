/* eslint-disable no-console */
// Per-tenant outbound-delivery policy — the mixed-tenant answer to "one env,
// many delivery needs" (the sandbox hosts founder-lead demos AND the public
// /try playground). Three independent layers protect real recipients and the
// Brevo sender reputation:
//
//   Layer 0 (env)     MAIL_ENABLED / SMS_ENABLED hard kill; TEST_MODE redirect
//                     is a local-dev/CI convenience that BYPASSES this module.
//   Layer 1 (always)  isSyntheticEmail() — RFC-2606/reserved recipients
//                     (@example.com & friends) are dropped in every environment.
//   Layer 2 (policy)  messaging_policies/{entityId} — OPERATOR-set per-tenant
//                     mode: live | allowlist | redirect | silent. Absent doc →
//                     the MESSAGING_DEFAULT_MODE env param ('silent' on the
//                     sandbox, 'live' in production).
//
// Docs are written ONLY via the Admin SDK (seeders, scripts/messaging-policy.ts,
// operator console) — firestore.rules denies all client access.
import * as admin from 'firebase-admin'
import { defineString } from 'firebase-functions/params'
import { MESSAGING_POLICIES_COLLECTION, type MessagingMode, type MessagingPolicy } from '@linyup/shared'

const defaultMode = defineString('MESSAGING_DEFAULT_MODE', {
  description: "Delivery mode for tenants without a messaging_policies doc: live | allowlist | redirect | silent ('live' keeps production behavior)",
  default: 'live',
})

const VALID_MODES: MessagingMode[] = ['live', 'allowlist', 'redirect', 'silent']

// ─── Layer 1: synthetic-recipient guard ───────────────────────────────────────
// RFC 2606 / RFC 6761 reserved names + the seeders' fabricated domains. Matches
// exact domains and any subdomain of the reserved TLDs.
const SYNTHETIC_DOMAINS = new Set(['example.com', 'example.org', 'example.net'])
const SYNTHETIC_TLDS = ['example', 'test', 'invalid', 'localhost', 'local']

export function isSyntheticEmail(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 0) return true // not an address at all — never hand to the provider
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '')
  if (!domain) return true
  if (SYNTHETIC_DOMAINS.has(domain)) return true
  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  return SYNTHETIC_TLDS.includes(tld) || !domain.includes('.')
}

// ─── Layer 2: policy resolution (60s in-memory cache) ─────────────────────────
const CACHE_TTL_MS = 60 * 1000
const policyCache = new Map<string, { policy: MessagingPolicy | null; at: number }>()

export function __clearPolicyCacheForTests(): void {
  policyCache.clear()
}

/** The policy for an entity (teamId | orgId | 'system'); null = no doc → env default. */
export async function resolveMessagingPolicy(entityId: string): Promise<MessagingPolicy | null> {
  const cached = policyCache.get(entityId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.policy
  let policy: MessagingPolicy | null = null
  try {
    const snap = await admin
      .firestore()
      .collection(MESSAGING_POLICIES_COLLECTION)
      .doc(entityId)
      .get()
    if (snap.exists) {
      const data = snap.data() as MessagingPolicy
      policy = VALID_MODES.includes(data.mode) ? data : null
      if (!policy) console.warn(`[messaging] policy for '${entityId}' has invalid mode '${data.mode}' — ignoring`)
    }
  } catch (err) {
    // Fail toward the env default — never let a read error turn silence into sends
    // or vice versa beyond what the environment default dictates.
    console.error(`[messaging] failed to read policy for '${entityId}':`, err)
  }
  policyCache.set(entityId, { policy, at: Date.now() })
  return policy
}

export function envDefaultMode(): MessagingMode {
  const v = defaultMode.value() as MessagingMode
  return VALID_MODES.includes(v) ? v : 'live'
}

// ─── pure recipient filters (unit-tested) ─────────────────────────────────────

export interface PolicyDecision {
  recipients: string[]
  // Set when the policy dropped EVERY recipient (nothing to send).
  droppedAll?: 'policy_silent' | 'policy_allowlist'
}

function emailAllowed(email: string, allow: string[]): boolean {
  const e = email.trim().toLowerCase()
  return allow.some((entry) => {
    const a = entry.trim().toLowerCase()
    if (!a) return false
    if (a.startsWith('@')) return e.endsWith(a)
    return e === a
  })
}

/** Apply a policy mode to email recipients. `policy` null → mode from env default. */
export function applyEmailPolicy(
  recipients: string[],
  policy: MessagingPolicy | null,
  fallbackMode: MessagingMode,
): PolicyDecision {
  const mode = policy?.mode ?? fallbackMode
  switch (mode) {
    case 'live':
      return { recipients }
    case 'silent':
      return { recipients: [], droppedAll: 'policy_silent' }
    case 'redirect': {
      const target = policy?.redirectEmail?.trim()
      if (!target) return { recipients: [], droppedAll: 'policy_silent' }
      return { recipients: [target] }
    }
    case 'allowlist': {
      const allow = policy?.allowEmails ?? []
      const kept = recipients.filter((r) => emailAllowed(r, allow))
      return kept.length > 0
        ? { recipients: kept }
        : { recipients: [], droppedAll: 'policy_allowlist' }
    }
  }
}

/** Apply a policy mode to ONE SMS recipient (E.164). Null result = drop. */
export function applySmsPolicy(
  phoneE164: string,
  policy: MessagingPolicy | null,
  fallbackMode: MessagingMode,
): { recipient: string | null; droppedReason?: 'policy_silent' | 'policy_allowlist' } {
  const mode = policy?.mode ?? fallbackMode
  switch (mode) {
    case 'live':
      return { recipient: phoneE164 }
    case 'silent':
      return { recipient: null, droppedReason: 'policy_silent' }
    case 'redirect': {
      const target = policy?.redirectPhone?.trim()
      return target
        ? { recipient: target }
        : { recipient: null, droppedReason: 'policy_silent' }
    }
    case 'allowlist': {
      const allow = (policy?.allowPhones ?? []).map((p) => p.replace(/[\s\-()]/g, ''))
      return allow.includes(phoneE164)
        ? { recipient: phoneE164 }
        : { recipient: null, droppedReason: 'policy_allowlist' }
    }
  }
}
