// Ported from hmd-lineup/functions/src/{generateReferralCodes,confirmReferral,getMyReferralCode,getMyReferralStats}

import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { isTeamMember, getTeam } from '../utils/teams'
import { ensureReferralCode, updateReferralStatus } from '../utils/referrals'
import { getHostingUrl } from '../utils/env'

const BATCH_SIZE = 50

// ─── generateReferralCodes ────────────────────────────────────────────────────
// Admin callable — generates referral codes for all contacts in a team that
// don't yet have one. Called when enabling the referral feature for the first time.

export const generateReferralCodes = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.')

  const { teamId } = request.data as { teamId: string }
  if (!teamId) throw new HttpsError('invalid-argument', 'Missing required field: teamId')

  const userId = request.auth.uid
  const isMember = await isTeamMember(userId, teamId)
  if (!isMember) throw new HttpsError('permission-denied', 'You are not a member of this team.')

  const team = await getTeam(teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found.')
  const teamSettings = (team.settings as Record<string, unknown> | undefined) ?? {}
  const referralSettings = teamSettings.referral as Record<string, unknown> | undefined
  if (!referralSettings?.enabled) {
    throw new HttpsError('failed-precondition', 'Referral program is not enabled for this team.')
  }

  console.log(`Generating referral codes for team ${teamId} by user ${userId}`)

  const db = admin.firestore()
  let generated = 0
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null

  while (true) {
    let query = db
      .collection('contacts')
      .where('teamId', '==', teamId)
      .where('deleted_at', '==', null)
      .limit(BATCH_SIZE) as admin.firestore.Query

    if (lastDoc) query = query.startAfter(lastDoc)

    const snapshot = await query.get()
    if (snapshot.empty) break

    await Promise.all(
      snapshot.docs.map(async (doc) => {
        if (!doc.data().referral_code) {
          try {
            await ensureReferralCode(doc.id, teamId)
            generated++
          } catch (err) {
            console.error(`Failed to generate code for contact ${doc.id}:`, err)
          }
        }
      })
    )

    lastDoc = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < BATCH_SIZE) break
  }

  console.log(`Generated ${generated} referral codes for team ${teamId}`)
  return { generated }
})

// ─── confirmReferral ──────────────────────────────────────────────────────────
// Admin callable — advances a referral to the next status.
// Transitions: friend_signed_up → pending_reward (confirm_membership)
//              pending_reward  → rewarded         (mark_rewarded)

type ReferralAction = 'confirm_membership' | 'mark_rewarded'
const TRANSITIONS: Record<ReferralAction, { from: string; to: string }> = {
  confirm_membership: { from: 'friend_signed_up', to: 'pending_reward' },
  mark_rewarded: { from: 'pending_reward', to: 'rewarded' },
}

export const confirmReferral = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.')

  const { referralId, action, reward, reward_notes } = request.data as {
    referralId: string
    action: ReferralAction
    reward?: { reward_type: string; reward_amount: number }
    reward_notes?: string
  }

  if (!referralId) throw new HttpsError('invalid-argument', 'Missing required field: referralId')
  if (!action || !(action in TRANSITIONS)) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid action. Must be one of: ${Object.keys(TRANSITIONS).join(', ')}`
    )
  }

  const userId = request.auth.uid
  const db = admin.firestore()
  const referralDoc = await db.collection('referrals').doc(referralId).get()
  if (!referralDoc.exists) throw new HttpsError('not-found', 'Referral not found.')

  const referralData = referralDoc.data()!
  const teamId = referralData.team_id as string

  const isMember = await isTeamMember(userId, teamId)
  if (!isMember) throw new HttpsError('permission-denied', 'You are not a member of this team.')

  const transition = TRANSITIONS[action]
  if (referralData.status !== transition.from) {
    throw new HttpsError(
      'failed-precondition',
      `Cannot perform action '${action}' on referral with status '${referralData.status as string}'. Expected status: '${transition.from}'.`
    )
  }

  if (action === 'mark_rewarded') {
    if (
      !reward ||
      typeof reward.reward_type !== 'string' ||
      typeof reward.reward_amount !== 'number'
    ) {
      throw new HttpsError(
        'invalid-argument',
        'reward with reward_type (string) and reward_amount (number) is required for mark_rewarded'
      )
    }
  }

  await updateReferralStatus(
    referralId,
    transition.to,
    userId,
    action === 'mark_rewarded' ? reward! : null,
    reward_notes ?? null
  )

  console.log(
    `Referral ${referralId} advanced from ${transition.from} to ${transition.to} by user ${userId}`
  )
  return { success: true, newStatus: transition.to }
})

// ─── getMyReferralCode ────────────────────────────────────────────────────────
// Student callable (auth token with contactId claim) — returns the student's
// referral code and shareable URL, generating one lazily if needed.

export const getMyReferralCode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.')

  const contactId = request.auth.token?.contactId as string | undefined
  if (!contactId) throw new HttpsError('permission-denied', 'Invalid session. Please log in again.')

  const db = admin.firestore()
  const contactDoc = await db.collection('contacts').doc(contactId).get()
  if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found.')

  const contactData = contactDoc.data()!
  const teamId = (contactData.teamId ?? contactData.teacher) as string | undefined
  if (!teamId) throw new HttpsError('failed-precondition', 'Contact is not associated with a team.')

  const team = await getTeam(teamId)
  const teamSettings2 = (team?.settings as Record<string, unknown> | undefined) ?? {}
  const referralSettings2 = teamSettings2.referral as Record<string, unknown> | undefined
  if (!referralSettings2?.enabled) {
    throw new HttpsError('failed-precondition', 'Referral program is not enabled for this team.')
  }

  const code = await ensureReferralCode(contactId, teamId)
  const teamSlug = team?.slug
  const referralUrl = `${getHostingUrl()}/public/${teamSlug}/booking?referral=${code}`

  console.log(`Referral code ${code} returned for contact ${contactId}`)
  return { code, referralUrl }
})

// ─── getMyReferralStats ───────────────────────────────────────────────────────
// Student callable — returns counts of referrals that reached 'rewarded' status.

export const getMyReferralStats = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.')

  const contactId = request.auth.token?.contactId as string | undefined
  if (!contactId) throw new HttpsError('permission-denied', 'Invalid session. Please log in again.')

  const db = admin.firestore()
  const [err, snapshot] = await to(
    db
      .collection('referrals')
      .where('referrer_contact_id', '==', contactId)
      .where('status', '==', 'rewarded')
      .get()
  )
  if (err)
    throw new HttpsError('internal', (err as Error).message ?? 'Failed to get referral stats.')

  return { rewarded_count: snapshot?.size ?? 0 }
})
