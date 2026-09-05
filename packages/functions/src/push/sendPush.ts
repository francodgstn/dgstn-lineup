/* eslint-disable no-console */
// The ONE send path for member push notifications, and the ONE writer that
// prunes a contact's `push_tokens` subcollection
// (packages/shared/src/types/push.ts) of tokens the vendor reports DEAD.
//
// Nothing calls this yet. This pass ships the capability only — no trigger,
// scheduled job or automation action is wired to it; see the module header of
// `packages/functions/src/push/provider.ts` for the vendor seam this sits on.
//
// Resolves every live token registered under the given contact(s), groups
// them by `PushToken.kind` so each group goes through its own vendor, and
// NEVER throws: a vendor outage, an empty token set or a Firestore read
// failure can only ever mean fewer notifications delivered, never a failed
// caller transaction or booking — same rule `translateSite.ts` follows for
// publishes.
import * as admin from 'firebase-admin'
import type { Firestore } from 'firebase-admin/firestore'
import { CONTACTS_COLLECTION, CONTACT_PUSH_TOKENS_SUBCOLLECTION, type PushToken, type PushTokenKind } from '@linyup/shared'
import { getPushProvider } from './provider'
import type { PushMessage, PushSendReceipt } from './types'

export interface SendPushResult {
  /** Receipts with status 'ok'. */
  sent: number
  /** Tokens deleted because the vendor reported them dead. */
  pruned: number
}

interface Registration {
  contactId: string
  token: string
  kind: PushTokenKind
}

/** Pure — exported for `sendPush.test.ts`. Buckets registrations by the
 *  vendor that must send them, so each bucket can be handed to exactly one
 *  `PushProvider`. */
export function groupByKind(registrations: Registration[]): Map<PushTokenKind, Registration[]> {
  const byKind = new Map<PushTokenKind, Registration[]>()
  for (const reg of registrations) {
    const list = byKind.get(reg.kind)
    if (list) list.push(reg)
    else byKind.set(reg.kind, [reg])
  }
  return byKind
}

/** Pure — exported for `sendPush.test.ts`. Splits a provider's receipts back
 *  into what `sendPush` needs: how many delivered, and which registrations
 *  must be pruned (status 'dead' ONLY — 'error' is left alone, see
 *  `PushSendStatus`'s doc comment in `./types.ts`). */
export function partitionReceipts(
  receipts: PushSendReceipt[],
  regs: Registration[]
): { sentCount: number; dead: Registration[] } {
  const byToken = new Map(regs.map((r) => [r.token, r]))
  let sentCount = 0
  const dead: Registration[] = []
  for (const receipt of receipts) {
    if (receipt.status === 'ok') {
      sentCount++
    } else if (receipt.status === 'dead') {
      const reg = byToken.get(receipt.token)
      if (reg) dead.push(reg)
    }
  }
  return { sentCount, dead }
}

async function fetchRegistrations(
  db: Firestore,
  contactIds: string[]
): Promise<Registration[]> {
  const registrations: Registration[] = []
  for (const contactId of contactIds) {
    const snap = await db
      .collection(CONTACTS_COLLECTION)
      .doc(contactId)
      .collection(CONTACT_PUSH_TOKENS_SUBCOLLECTION)
      .get()
    snap.forEach((d) => {
      const data = d.data() as PushToken
      registrations.push({ contactId, token: d.id, kind: data.kind })
    })
  }
  return registrations
}

/**
 * THE ONE WRITER of a `push_tokens` deletion. A token the vendor reports dead
 * is removed outright — never flagged, never left for a sweep — because a
 * stale token has no value once the vendor has said so: it only slows every
 * future send and pollutes delivery stats. One `WriteBatch` per call (Expo's
 * chunk size already caps this well under Firestore's 500-write limit).
 */
async function prunePushTokens(db: Firestore, dead: Registration[]): Promise<number> {
  if (dead.length === 0) return 0
  const batch = db.batch()
  for (const { contactId, token } of dead) {
    batch.delete(
      db.collection(CONTACTS_COLLECTION).doc(contactId).collection(CONTACT_PUSH_TOKENS_SUBCOLLECTION).doc(token)
    )
  }
  await batch.commit()
  return dead.length
}

export async function sendPush(contactIds: string | string[], message: PushMessage): Promise<SendPushResult> {
  const ids = Array.isArray(contactIds) ? contactIds : [contactIds]
  const result: SendPushResult = { sent: 0, pruned: 0 }
  if (ids.length === 0) return result

  try {
    const db = admin.firestore()
    const registrations = await fetchRegistrations(db, ids)
    if (registrations.length === 0) return result

    for (const [kind, regs] of groupByKind(registrations)) {
      const provider = getPushProvider(kind)
      if (!provider) {
        console.warn(`[push] no provider for kind '${kind}' — skipping ${regs.length} token(s)`)
        continue
      }
      try {
        const receipts = await provider.send(regs.map((r) => ({ token: r.token, message })))
        const { sentCount, dead } = partitionReceipts(receipts, regs)
        result.sent += sentCount
        result.pruned += await prunePushTokens(db, dead)
      } catch (err) {
        console.warn(`[push] provider '${kind}' failed for a batch of ${regs.length} — skipping:`, (err as Error).message)
      }
    }
  } catch (err) {
    console.warn('[push] sendPush failed — no notifications sent:', (err as Error).message)
  }

  return result
}
