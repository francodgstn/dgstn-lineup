/* eslint-disable no-console */
// THE OTHER HALF OF EMAIL VERIFICATION — telling the SERVER that it happened.
//
// Firebase sends the verification mail and flips `emailVerified` on the Auth
// user, and that is the whole of what it does: there is no webhook, no trigger,
// and nothing anywhere in Firestore changes. So a team's own documents cannot
// know whether its owner ever proved the address — which is exactly what the
// mail gate (`mailService.sendEntityMail`) and the unverified-account sweep
// need to read.
//
// This callable is how the fact crosses over. It is NOT trusted client input:
// the claim is read off the caller's own ID token (`request.auth.token`), which
// Firebase signs and this runtime verifies, so a caller cannot assert a
// verification they do not have. The client's only power is to ask.
//
// It is idempotent, cheap, and safe to call on every app load — which is what
// the web app does, because there is no event to hang it off.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { TEAMS_COLLECTION, TEAM_MEMBERS_SUBCOLLECTION, USERS_COLLECTION } from '@linyup/shared'

export const confirmEmailVerified = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  // The signed claim, not a body field. Social sign-ins arrive with this already
  // true, which is why they are never mailed a verification link.
  const verified = request.auth.token.email_verified === true
  if (!verified) return { verified: false as const, teamsUpdated: 0 }

  const uid = request.auth.uid
  const db = admin.firestore()

  await db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .set({ email_verified: true, email_verified_at: FieldValue.serverTimestamp() }, { merge: true })

  // Every team this user OWNS. Not "is a member of": the flag is a statement
  // about the account that created the tenant, and a coach who joins someone
  // else's studio has no business clearing their owner's flag.
  const memberships = await db
    .collectionGroup(TEAM_MEMBERS_SUBCOLLECTION)
    .where('userId', '==', uid)
    .where('role', '==', 'owner')
    .get()

  let teamsUpdated = 0
  for (const doc of memberships.docs) {
    const teamId = doc.ref.parent.parent?.id
    if (!teamId) continue
    // `update`, not `set`: a team that does not exist any more is not an error
    // worth failing an idempotent confirmation over.
    await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .update({ owner_email_verified: true })
      .then(() => {
        teamsUpdated++
      })
      .catch((err) => console.warn(`[auth] confirmEmailVerified: team ${teamId}:`, err))
  }

  return { verified: true as const, teamsUpdated }
})
