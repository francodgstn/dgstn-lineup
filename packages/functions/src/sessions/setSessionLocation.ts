// Ported from hmd-lineup/functions/src/setSessionLocation/index.js
// Sets a session's location and maintains a per-team place usage counter in team_places subcollection.
// The counter is only updated for past sessions (sessions that have already occurred).
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'

const SESSIONS_COLLECTION = 'sessions'
const TEAMS_COLLECTION = 'teams'
const TEAM_PLACES_SUBCOLLECTION = 'team_places'

async function getSessionById(id: string): Promise<admin.firestore.DocumentSnapshot> {
  const [err, snapshot] = await to(
    admin.firestore().collection(SESSIONS_COLLECTION).doc(id).get()
  )
  if (err) throw new HttpsError('internal', `Failed to fetch session: ${err.message}`)
  if (!snapshot || !snapshot.exists) throw new HttpsError('not-found', `Session ${id} not found`)
  return snapshot
}

async function getTeamPlaceRef(label: string, teamId: string): Promise<admin.firestore.DocumentReference> {
  const [err, snap] = await to(
    admin
      .firestore()
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(TEAM_PLACES_SUBCOLLECTION)
      .where('label', '==', label)
      .get()
  )
  if (err) throw new HttpsError('internal', `Failed to fetch team place: ${err.message}`)
  if (snap && !snap.empty) return snap.docs[0].ref
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(TEAM_PLACES_SUBCOLLECTION)
    .doc()
}

export const setSessionLocation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { id, location = null } = request.data as { id: string; location?: string | null }
  if (!id) throw new HttpsError('invalid-argument', 'Session id is required')

  const sessionSnapshot = await getSessionById(id)
  const sessionData = sessionSnapshot.data()!
  const beforeLocation: string | null = sessionData.location ?? null
  // teacher || teamId — legacy compat
  const teamId: string = sessionData.teamId ?? sessionData.teacher

  // No change
  if (beforeLocation === location) return {}

  const now = Timestamp.now()
  const sessionHasOccurred = sessionData.start && sessionData.start < now

  // Build list of place counter increments
  const locationIncrements: Array<{ label: string; increment: number }> = []
  if (beforeLocation) locationIncrements.push({ label: beforeLocation, increment: -1 })
  if (location) locationIncrements.push({ label: location, increment: 1 })
  if (locationIncrements.length === 0) return {}

  const batch = admin.firestore().batch()
  batch.set(sessionSnapshot.ref, { location }, { merge: true })

  if (sessionHasOccurred) {
    await Promise.all(
      locationIncrements.map(async ({ label, increment }) => {
        const placeRef = await getTeamPlaceRef(label, teamId)
        batch.set(placeRef, { label, count: FieldValue.increment(increment) }, { merge: true })
      })
    )
  }

  const [commitErr] = await to(batch.commit())
  if (commitErr) throw new HttpsError('internal', `Failed to update session location: ${commitErr.message}`)

  return { success: true }
})
