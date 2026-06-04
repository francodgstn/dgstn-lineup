import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'
import { isCheckinCompleted } from '@linyup/shared'

setGlobalOptions({ region: 'europe-west6' })

const CHECKINS_COLLECTION = 'checkins'
const EVENTS_COLLECTION = 'events'

interface AddEventCheckinInput {
  eventId: string
  contactId: string
  contact: { firstname: string; lastname: string }
  checkinData?: Record<string, unknown>
  // For org-scoped events: the team the contact belongs to.
  // For team-scoped events: omit — resolved from the event doc.
  checkinTeamId?: string
}

export const addEventCheckin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.')

  const {
    eventId,
    contactId,
    contact,
    checkinData = {},
    checkinTeamId,
  } = request.data as AddEventCheckinInput

  if (!eventId || !contactId) {
    throw new HttpsError('invalid-argument', 'eventId and contactId are required.')
  }

  const db = admin.firestore()

  const eventDoc = await db.collection(EVENTS_COLLECTION).doc(eventId).get()
  if (!eventDoc.exists) throw new HttpsError('not-found', 'Event not found.')

  const event = eventDoc.data()!
  const isOrgEvent = event.scope === 'org' && !!event.orgId

  // Determine the teamId to stamp on the checkin (the contact's team).
  // For team events this must match the event's own teamId.
  // For org events the caller may specify a different club's teamId.
  const resolvedTeamId: string = isOrgEvent
    ? (checkinTeamId ?? (event.teamId as string))
    : (event.teamId as string)

  // Permission check
  if (isOrgEvent) {
    const memberDoc = await db
      .collection('organizations').doc(event.orgId as string)
      .collection('org_members').doc(request.auth.uid)
      .get()
    if (!memberDoc.exists || memberDoc.data()?.role !== 'org_admin') {
      throw new HttpsError('permission-denied', 'Only org admins can manage checkins for org events.')
    }
  } else {
    const memberDoc = await db
      .collection('teams').doc(resolvedTeamId)
      .collection('team_members').doc(request.auth.uid)
      .get()
    if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Not a member of this team.')
    const role = memberDoc.data()?.role as string | undefined
    if (role !== 'owner' && role !== 'manager') {
      throw new HttpsError('permission-denied', 'Only managers and owners can manage checkins.')
    }
  }

  const is_completed = isCheckinCompleted(event.type as string, checkinData)

  // Update if a checkin already exists for this contact+event
  const existingSnap = await db.collection(CHECKINS_COLLECTION)
    .where('event.id', '==', eventId)
    .where('contact.id', '==', contactId)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    const docRef = existingSnap.docs[0].ref
    await docRef.update({
      checkin_data: checkinData,
      is_completed,
      updated_at: FieldValue.serverTimestamp(),
    })
    return { id: docRef.id, is_completed, created: false }
  }

  const docRef = await db.collection(CHECKINS_COLLECTION).add({
    event: { id: eventId, title: event.title ?? '', type: event.type ?? '' },
    contact: { id: contactId, ...contact },
    teamId: resolvedTeamId,
    is_completed,
    checkin_data: checkinData,
    checked_in_by: request.auth.uid,
    created_at: FieldValue.serverTimestamp(),
  })

  return { id: docRef.id, is_completed, created: true }
})
