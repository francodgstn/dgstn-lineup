/* eslint-disable no-console */
// SWEEP THE SIGNUPS THAT NEVER PROVED THEIR ADDRESS.
//
// An unverified account is not, by itself, a problem — it is a person who
// signed up and got distracted. What makes it worth removing is the pair:
// unverified AND untouched. Nobody proved the mailbox, and nobody did anything
// with the tenant. That combination is either a typo'd address (the person
// never received the mail and cannot ever get in) or somebody trying the door
// with an address they do not own.
//
// ── THE RULE, AND WHY IT IS THIS AND NOT "DELETE UNVERIFIED" ────────────────
// A studio that signed up, ignored the verification mail, and then spent an
// afternoon entering forty contacts is NOT swept. Their data is real work, the
// mail gate has already stopped anything going out in their name, and a banner
// is telling them exactly what to do about it. Deleting them would be the worst
// failure this file could have — so "untouched" is checked against real
// tenant data, not against a login timestamp.
//
// What is checked, all of which must be true:
//   • the Auth user's email is still unverified;
//   • the account is older than UNVERIFIED_MAX_AGE_DAYS;
//   • every team the user OWNS has no contacts, no sessions and no payments;
//   • the user owns no team with anybody else in it.
//
// ── WHAT IT DELETES ─────────────────────────────────────────────────────────
// The team goes through `purgeTeam`, so the collection list stays driven by
// TENANT_DATA_COLLECTIONS and nothing has to be hand-copied here. The Auth user
// goes last: if the purge fails, the account survives to be swept again
// tomorrow, which is the correct direction to fail in.
//
// ── WHY NO CONSENT EXPORT HERE (the Q13 gate's ONE exemption) ───────────────
// The two production teardown paths that CAN destroy a signature —
// `scripts/purge-team.ts` and `dailyTasks/purgeScheduledTeams.ts` — export the
// waiver ledger before deleting. This path deliberately does not, and does not
// need to: it only ever sweeps a team that is UNTOUCHED — no contacts, no
// sessions, no payments (the checks above). A waiver acceptance is real tenant
// data, so a team that has none by definition collected no signature, and there
// is nothing to preserve. The exemption is named here as explicitly as the
// inclusions are on the other two paths, rather than left to be inferred.

import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  CONTACTS_COLLECTION,
  MEMBER_PAYMENTS_SUBCOLLECTION,
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
} from '@linyup/shared'
import { purgeTeam } from '../saas-billing/purgeTeam'

/** How long an unverified signup is left alone. Long enough for a holiday. */
export const UNVERIFIED_MAX_AGE_DAYS = 7

/** How many accounts one run will remove. A bound, not a target — a sweep that
 *  suddenly wants to delete hundreds of accounts is a bug, and this is what
 *  stops the first run of that bug from being the last one that matters. */
const MAX_PER_RUN = 25

export interface PurgeUnverifiedResult {
  scanned: number
  deleted: number
  keptWithData: number
}

/** Has anything actually happened inside this tenant? */
async function teamIsUntouched(teamId: string): Promise<boolean> {
  const db = admin.firestore()
  const [contacts, sessions, payments, members] = await Promise.all([
    db.collection(CONTACTS_COLLECTION).where('teamId', '==', teamId).limit(1).get(),
    db.collection(SESSIONS_COLLECTION).where('teamId', '==', teamId).limit(1).get(),
    db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(MEMBER_PAYMENTS_SUBCOLLECTION)
      .limit(1)
      .get(),
    // More than the owner themselves means somebody was invited in and accepted
    // — the tenant has a second person's expectations attached to it.
    db.collection(TEAMS_COLLECTION).doc(teamId).collection(TEAM_MEMBERS_SUBCOLLECTION).limit(2).get(),
  ])
  return contacts.empty && sessions.empty && payments.empty && members.size <= 1
}

export async function purgeUnverifiedSignups(): Promise<PurgeUnverifiedResult> {
  const db = admin.firestore()
  const auth = admin.auth()
  const cutoffMs = Date.now() - UNVERIFIED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  const result: PurgeUnverifiedResult = { scanned: 0, deleted: 0, keptWithData: 0 }

  // Driven off the USER documents rather than off a full Auth listing: the
  // flag we write (`email_verified`) is only ever set to true, so an absent or
  // false value is the candidate set, and it is a Firestore query rather than a
  // paginated walk of every account on the project.
  const candidates = await db
    .collection('users')
    .where('created_at', '<', Timestamp.fromMillis(cutoffMs))
    .where('email_verified', '==', false)
    .limit(MAX_PER_RUN * 4)
    .get()

  for (const userDoc of candidates.docs) {
    if (result.deleted >= MAX_PER_RUN) break
    result.scanned++
    const uid = userDoc.id

    // AUTH IS THE AUTHORITY, always re-read. The Firestore flag can only lag
    // (nothing sets it back to false), but a person who verified an hour ago
    // and has not opened the app since would still be marked false here — and
    // deleting them would be deleting a verified account.
    let user: admin.auth.UserRecord
    try {
      user = await auth.getUser(uid)
    } catch {
      // No Auth user at all — a half-created account. Its Firestore profile is
      // still cleaned up below via its teams.
      user = null as unknown as admin.auth.UserRecord
    }
    if (user?.emailVerified) continue

    const owned = await db
      .collectionGroup(TEAM_MEMBERS_SUBCOLLECTION)
      .where('userId', '==', uid)
      .where('role', '==', 'owner')
      .get()
    const teamIds = owned.docs
      .map((d) => d.ref.parent.parent?.id)
      .filter((id): id is string => !!id)

    const untouched = await Promise.all(teamIds.map(teamIsUntouched))
    if (untouched.some((ok) => !ok)) {
      // Real work inside. Left alone, permanently — the mail gate has already
      // stopped anything going out in their name, and the banner is asking.
      result.keptWithData++
      continue
    }

    for (const teamId of teamIds) {
      await purgeTeam(teamId, false)
    }
    await db.collection('users').doc(uid).delete().catch(() => {})
    if (user) await auth.deleteUser(uid).catch((err) => console.error(`[purgeUnverified] auth delete ${uid}:`, err))

    result.deleted++
    console.log(`[purgeUnverified] removed ${uid} (${teamIds.length} team(s))`)
  }

  return result
}
