// Pure helpers for bulk outreach — no firebase-admin, no firebase-functions, so
// they can be unit-tested without a runtime. The callable in ./index.ts owns the
// I/O; everything that decides WHO gets mailed lives here.

/** Why a recipient was not mailed. Reported per contact so the UI can be honest. */
export type OutreachSkipReason =
  | 'no_email'
  | 'unsubscribed'
  | 'not_found'
  | 'wrong_team'
  // The mail service declined it AFTER we decided to send: an idempotent
  // duplicate of this same send, an ESP suppression (bounced/blocked/spam), a
  // tenant messaging policy, or the MAIL_ENABLED kill switch. Deliberately its
  // own bucket — folding these into 'unsubscribed' would tell a studio their
  // contacts opted out when the real cause was a retry or a dead address.
  | 'not_delivered'

export type RecipientVerdict =
  | { ok: true }
  | { ok: false; reason: OutreachSkipReason }

/**
 * Hard ceiling per invocation. Above this the caller must split the send — the
 * UI never offers it, so hitting this means something automated is calling.
 * Sized to stay well inside the function's deadline at CONCURRENCY below.
 */
export const MAX_RECIPIENTS = 500

/** Recipients mailed in parallel. Keeps the ESP burst and memory predictable. */
export const CONCURRENCY = 10

/** Minimal shape read off a contact document. */
export interface RecipientContact {
  email?: unknown
  email_unsubscribed?: unknown
  teamId?: unknown
  /** Legacy tenant field, still present on migrated data. */
  teacher?: unknown
}

/**
 * May this contact be mailed as part of a bulk outreach send?
 *
 * `email_unsubscribed` is the studio's own MARKETING opt-out and is checked
 * here. It is a different thing from the ESP suppression list
 * (mail_suppressions: bounces, blocks, spam reports), which the mail service
 * applies separately on every send — transactional mail ignores this flag but
 * outreach must not.
 */
export function partitionRecipients(
  contact: RecipientContact | null | undefined,
  teamId: string,
): RecipientVerdict {
  if (!contact) return { ok: false, reason: 'not_found' }

  const contactTeamId = (contact.teamId ?? contact.teacher) as string | undefined
  if (contactTeamId !== teamId) return { ok: false, reason: 'wrong_team' }

  if (!contact.email || typeof contact.email !== 'string') {
    return { ok: false, reason: 'no_email' }
  }
  // Only an explicit true opts out — an absent flag is consent, not refusal.
  if (contact.email_unsubscribed === true) return { ok: false, reason: 'unsubscribed' }

  return { ok: true }
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Replaces an unbounded Promise.allSettled: at a few hundred contacts that
 * opened a few hundred simultaneous ESP connections against the request's own
 * deadline. A worker that throws rejects the whole run, so callers catch per
 * item — one bad recipient must not abandon the rest of the send.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

export interface OutreachSendStats {
  total: number
  sent: number
  failed: number
  skipped: number
  skippedByReason: Record<OutreachSkipReason, number>
  errors: Array<{ contactId: string; error: string }>
}

export function emptyOutreachStats(total: number): OutreachSendStats {
  return {
    total,
    sent: 0,
    failed: 0,
    skipped: 0,
    skippedByReason: {
      no_email: 0, unsubscribed: 0, not_found: 0, wrong_team: 0, not_delivered: 0,
    },
    errors: [],
  }
}
