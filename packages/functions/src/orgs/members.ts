// Organisation member management — add / change role / remove.
//
// WHY THESE EXIST (UX-34): the org Members tab has always rendered a complete
// form — an "Add member" dialog with an email field and a role picker, and a
// per-row delete with a confirmation — against `addOrgMember` and
// `removeOrgMember`, neither of which had ever been written. Every submit came
// back "internal". `createOrganization` makes exactly ONE org_admin (the
// creator) and there was no second path, so an organisation could never gain an
// admin, hand one over, or lose one: a bus factor of one, permanently.
//
// AUTHORIZATION follows UX-75's shape and nothing else: `assertOrgAdmin` against
// `organizations/{orgId}/org_members/{uid}`. An org admin is not a team owner
// and has no `team_members` document anywhere, so `hasTeamRole` / `assertOwner`
// would refuse the very person who is allowed to do this.
//
// WHY CALLABLES AT ALL, when firestore.rules already lets an org_admin write
// `org_members/{memberId}` directly: the client cannot turn an email address
// into a uid (that is an Admin SDK read), cannot maintain `users/{uid}.orgIds`
// (it may only write its OWN user document), and cannot enforce "an
// organisation keeps at least one admin" — that is a read of the whole
// collection inside a transaction. All three are server obligations.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  ORGANIZATIONS_COLLECTION,
  ORG_MEMBERS_SUBCOLLECTION,
  type OrgRole,
} from '@linyup/shared'
import { assertOrgAdmin } from './index'

const ORG_ROLES: OrgRole[] = ['org_admin', 'org_viewer']

function requireRole(role: unknown): OrgRole {
  if (typeof role !== 'string' || !ORG_ROLES.includes(role as OrgRole)) {
    throw new HttpsError('invalid-argument', 'role must be org_admin or org_viewer')
  }
  return role as OrgRole
}

function membersRef(orgId: string) {
  return admin
    .firestore()
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(orgId)
    .collection(ORG_MEMBERS_SUBCOLLECTION)
}

/**
 * The last-admin guard, shared by the two callables that can take an admin away
 * (remove, and demote to viewer). Reads the whole member collection — an org has
 * a handful of admins, not thousands — and refuses when `uid` is the only one
 * left. Called INSIDE the transaction that performs the write, so two admins
 * removing each other at once cannot both pass.
 */
async function assertNotLastAdmin(
  tx: FirebaseFirestore.Transaction,
  orgId: string,
  uid: string
): Promise<void> {
  const snap = await tx.get(membersRef(orgId).where('role', '==', 'org_admin'))
  const otherAdmins = snap.docs.filter((d) => d.id !== uid)
  if (otherAdmins.length === 0) {
    throw new HttpsError(
      'failed-precondition',
      'An organisation must keep at least one admin.',
      { reason: 'last_admin' }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// addOrgMember — org admin adds an EXISTING Linyup user by email
// ─────────────────────────────────────────────────────────────────────────────
//
// Deliberately NOT an invitation. `org_invitations` exists for the other
// relationship — inviting a whole TEAM into the org, which is accepted by that
// team's owner and changes their billing. An org admin is a person who already
// works in Linyup; adding one is an immediate grant, and inventing a second
// pending-invitation lifecycle for it would mean a second accept surface, a
// second expiry sweep and a second way for the member list to disagree with
// itself. If the address has no account, we say exactly that rather than
// creating a placeholder user nobody can sign in as.

export const addOrgMember = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = (request.data ?? {}) as { orgId?: string; email?: string; role?: string }
  if (!data.orgId) throw new HttpsError('invalid-argument', 'orgId is required')
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  if (!email) throw new HttpsError('invalid-argument', 'email is required')
  const role = requireRole(data.role ?? 'org_admin')

  await assertOrgAdmin(request.auth.uid, data.orgId)

  const db = admin.firestore()
  const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(data.orgId).get()
  if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found')

  // Resolve the person. Auth is the authority on "does this address have an
  // account"; the users document is where the display name lives.
  let userRecord: admin.auth.UserRecord
  try {
    userRecord = await admin.auth().getUserByEmail(email)
  } catch {
    throw new HttpsError(
      'not-found',
      'No Linyup account exists for that email address.',
      { reason: 'no_account' }
    )
  }
  const uid = userRecord.uid

  const memberRef = membersRef(data.orgId).doc(uid)
  const existing = await memberRef.get()
  if (existing.exists) {
    throw new HttpsError('already-exists', 'That person is already a member of this organisation.')
  }

  const userDoc = await db.collection('users').doc(uid).get()
  const displayName =
    (userDoc.data()?.displayName as string | undefined) ?? userRecord.displayName ?? ''

  const now = FieldValue.serverTimestamp()
  const batch = db.batch()
  batch.set(memberRef, {
    userId: uid,
    orgId: data.orgId,
    role,
    joined: now,
    addedBy: request.auth.uid,
    // Denormalized so the members list can name people: an org admin has no
    // rule that lets them read other users' documents.
    displayName,
    email: userRecord.email ?? email,
  })
  // The sidebar finds a user's orgs from this array rather than a collectionGroup
  // query, so it is part of the membership, not a cache. `set(..., {merge:true})`
  // rather than `update` — a user document is created at signup, but an account
  // created some other way (an operator import) may not have one yet.
  batch.set(
    db.collection('users').doc(uid),
    { orgIds: FieldValue.arrayUnion(data.orgId) },
    { merge: true }
  )
  await batch.commit()

  return { userId: uid, role, displayName, email: userRecord.email ?? email }
})

// ─────────────────────────────────────────────────────────────────────────────
// updateOrgMemberRole — org admin promotes/demotes an existing member
// ─────────────────────────────────────────────────────────────────────────────

export const updateOrgMemberRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = (request.data ?? {}) as { orgId?: string; userId?: string; role?: string }
  if (!data.orgId) throw new HttpsError('invalid-argument', 'orgId is required')
  if (!data.userId) throw new HttpsError('invalid-argument', 'userId is required')
  const role = requireRole(data.role)

  await assertOrgAdmin(request.auth.uid, data.orgId)

  const orgId = data.orgId
  const userId = data.userId
  const memberRef = membersRef(orgId).doc(userId)

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(memberRef)
    if (!snap.exists) throw new HttpsError('not-found', 'That person is not a member of this organisation.')
    const current = snap.data()!.role as OrgRole
    if (current === role) return
    // Demoting the last admin locks everyone out of the organisation just as
    // surely as removing them — same guard, same transaction.
    if (current === 'org_admin') await assertNotLastAdmin(tx, orgId, userId)
    tx.update(memberRef, { role, updated_at: FieldValue.serverTimestamp() })
  })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// removeOrgMember — org admin removes a member
// ─────────────────────────────────────────────────────────────────────────────

export const removeOrgMember = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = (request.data ?? {}) as { orgId?: string; userId?: string }
  if (!data.orgId) throw new HttpsError('invalid-argument', 'orgId is required')
  if (!data.userId) throw new HttpsError('invalid-argument', 'userId is required')

  await assertOrgAdmin(request.auth.uid, data.orgId)

  const db = admin.firestore()
  const orgId = data.orgId
  const userId = data.userId
  const memberRef = membersRef(orgId).doc(userId)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef)
    if (!snap.exists) throw new HttpsError('not-found', 'That person is not a member of this organisation.')
    if ((snap.data()!.role as OrgRole) === 'org_admin') {
      await assertNotLastAdmin(tx, orgId, userId)
    }
    tx.delete(memberRef)
    tx.set(
      db.collection('users').doc(userId),
      { orgIds: FieldValue.arrayRemove(orgId) },
      { merge: true }
    )
  })

  return { success: true }
})
