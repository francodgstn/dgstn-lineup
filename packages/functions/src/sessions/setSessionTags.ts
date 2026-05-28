// Ported from hmd-lineup/functions/src/setSessionTags/index.js
// Sets a session's tags and maintains per-team tag usage counters in sessions_tags subcollection.
// Counters are only updated for past sessions. Tags with a net count of 0 are deleted.
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'

const SESSIONS_COLLECTION = 'sessions'
const TEAMS_COLLECTION = 'teams'
const TEAM_SESSIONS_TAGS_SUBCOLLECTION = 'sessions_tags'

async function getSessionById(id: string): Promise<admin.firestore.DocumentSnapshot> {
  const [err, snapshot] = await to(
    admin.firestore().collection(SESSIONS_COLLECTION).doc(id).get()
  )
  if (err) throw new HttpsError('internal', `Failed to fetch session: ${err.message}`)
  if (!snapshot || !snapshot.exists) throw new HttpsError('not-found', `Session ${id} not found`)
  return snapshot
}

async function getTeamSessionsTagDoc(
  tag: string,
  teamId: string
): Promise<admin.firestore.QueryDocumentSnapshot | null> {
  const [err, snap] = await to(
    admin
      .firestore()
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(TEAM_SESSIONS_TAGS_SUBCOLLECTION)
      .where('tag', '==', tag)
      .get()
  )
  if (err) throw new HttpsError('internal', `Failed to fetch tag: ${err.message}`)
  return snap && !snap.empty ? snap.docs[0] : null
}

export const setSessionTags = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { id, tags = [] } = request.data as { id: string; tags?: string[] }
  if (!id) throw new HttpsError('invalid-argument', 'Session id is required')

  const sessionSnapshot = await getSessionById(id)
  const sessionData = sessionSnapshot.data()!
  const beforeTags: string[] = sessionData.tags ?? []
  // teacher || teamId — legacy compat
  const teamId: string = sessionData.teamId ?? sessionData.teacher

  const newTags = tags.filter((t) => !beforeTags.includes(t))
  const removedTags = beforeTags.filter((t) => !tags.includes(t))
  const tagIncrements = [
    ...newTags.map((tag) => ({ tag, increment: 1 })),
    ...removedTags.map((tag) => ({ tag, increment: -1 })),
  ]

  if (tagIncrements.length === 0) return {}

  const now = Timestamp.now()
  const sessionHasOccurred = sessionData.start && sessionData.start < now

  const batch = admin.firestore().batch()
  batch.update(sessionSnapshot.ref, { tags })

  if (sessionHasOccurred) {
    await Promise.all(
      tagIncrements.map(async ({ tag, increment }) => {
        const tagDoc = await getTeamSessionsTagDoc(tag, teamId)

        if (tagDoc && (tagDoc.data().count + increment) === 0) {
          // Counter reaches zero — remove the tag doc entirely
          batch.delete(tagDoc.ref)
          return
        }

        const tagRef = tagDoc
          ? tagDoc.ref
          : admin
              .firestore()
              .collection(TEAMS_COLLECTION)
              .doc(teamId)
              .collection(TEAM_SESSIONS_TAGS_SUBCOLLECTION)
              .doc()

        batch.set(tagRef, { tag, count: FieldValue.increment(increment) }, { merge: true })
      })
    )
  }

  const [commitErr] = await to(batch.commit())
  if (commitErr) throw new HttpsError('internal', `Failed to update session tags: ${commitErr.message}`)

  return { success: true }
})
