// Key-gated install for LOCKED plugins (currently just the AI assistant). A locked
// plugin is visible in the marketplace but can only be installed through this
// callable, after a timing-safe check against a strong secret key. firestore.rules
// denies direct client `create` of a locked install doc, so this admin-SDK write is
// the only install path — the key is the real gate.
import * as admin from 'firebase-admin'
import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { hasTeamRole } from '../utils/teams'
import { getSecret } from '../utils/secrets'
import { hashVerificationCode } from '../utils/crypto'

// Locked plugin ids → the Secret Manager secret holding their unlock key.
// Keep in sync with firestore.rules (installed_plugins create denylist) and the
// manifest `locked: true` flag.
const UNLOCK_SECRETS: Record<string, string> = {
  'ai-assistant': 'ai-assistant-unlock-key', // emulator env: AI_ASSISTANT_UNLOCK_KEY
}

const UNLOCK_RATE_LIMIT_MAX = 8 // attempts per user + plugin per hour
const RATE_WINDOW_MS = 60 * 60 * 1000

// Compare two strings in constant time by hashing both to a fixed length first
// (avoids leaking length + short-circuits). Reuses the shared code hasher.
function timingSafeEqualStr(a: string, b: string): boolean {
  const ah = Buffer.from(hashVerificationCode(a, ''), 'hex')
  const bh = Buffer.from(hashVerificationCode(b, ''), 'hex')
  return crypto.timingSafeEqual(ah, bh)
}

export const unlockPlugin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.')
  const uid = request.auth.uid
  const { teamId, pluginId, key } = (request.data ?? {}) as {
    teamId?: string
    pluginId?: string
    key?: string
  }

  if (!teamId || !pluginId) throw new HttpsError('invalid-argument', 'teamId and pluginId are required.')
  const secretName = UNLOCK_SECRETS[pluginId]
  if (!secretName) throw new HttpsError('invalid-argument', 'This plugin is not key-gated.')
  if (!key || typeof key !== 'string') throw new HttpsError('invalid-argument', 'A key is required.')

  const db = admin.firestore()

  // Only team owners may unlock.
  const [roleErr, isOwner] = await to(hasTeamRole(uid, teamId, 'owner'))
  if (roleErr || !isOwner) {
    throw new HttpsError('permission-denied', 'Only the team owner can unlock this plugin.')
  }

  // Brute-force guard: cap unlock attempts per user + plugin per hour.
  const windowKey = Math.floor(Date.now() / RATE_WINDOW_MS).toString()
  const rlRef = db
    .collection('rate_limits')
    .doc(uid)
    .collection('plugin_unlock')
    .doc(`${pluginId}_${windowKey}`)
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rlRef)
    const count = snap.exists ? (snap.data()!.count as number) : 0
    if (count >= UNLOCK_RATE_LIMIT_MAX) return false
    tx.set(rlRef, { count: count + 1, updated_at: FieldValue.serverTimestamp() }, { merge: true })
    return true
  })
  if (!allowed) throw new HttpsError('resource-exhausted', 'Too many attempts. Please try again later.')

  // Validate the submitted key (timing-safe) against the configured secret.
  const [secretErr, expected] = await to(getSecret(secretName))
  if (secretErr || !expected) throw new HttpsError('failed-precondition', 'Unlock is not configured.')
  if (!timingSafeEqualStr(key, expected)) throw new HttpsError('permission-denied', 'Invalid key.')

  // Install via admin SDK (rules deny the direct client create for this id).
  await db
    .collection('teams')
    .doc(teamId)
    .collection('installed_plugins')
    .doc(pluginId)
    .set({
      pluginId,
      teamId,
      installedAt: FieldValue.serverTimestamp(),
      installedBy: uid,
      status: 'active',
      config: { unlockedAt: FieldValue.serverTimestamp(), unlockedBy: uid },
    })

  return { success: true }
})
