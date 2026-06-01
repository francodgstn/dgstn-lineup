import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'
import { isCheckinCompleted } from '@lineup/shared'

setGlobalOptions({ region: 'europe-west6' })

const CHECKINS_COLLECTION = 'checkins'
const EVENTS_COLLECTION = 'events'

interface AddEventCheckinInput {
  eventId: string
  contactId: string
  contact: { firstname: string; lastname: string }
  checkinData?: Record<string, unknown>
}

export const addEventCheckin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.')

  const { eventId, contactId, contact, checkinData = {} } = request.data as AddEventCheckinInput
  if (!eventId || !contactId) throw new HttpsError('invalid-argument', 'eventId and contactId are required.')

  const db = admin.firestore()

  const eventDoc = await db.collection(EVENTS_COLLECTION).doc(eventId).get()
  if (!eventDoc.exists) throw new HttpsError('not-found', 'Event not found.')

  const event = eventDoc.data()!
  const teamId = event.teamId as string

  const memberDoc = await db
    .collection('teams').doc(teamId)
    .collection('team_members').doc(request.auth.uid)
    .get()
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Not a member of this team.')
  const role = memberDoc.data()?.role as string | undefined
  if (role !== 'owner' && role !== 'manager') {
    throw new HttpsError('permission-denied', 'Only managers and owners can manage checkins.')
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
    teamId,
    is_completed,
    checkin_data: checkinData,
    checked_in_by: request.auth.uid,
    created_at: FieldValue.serverTimestamp(),
  })

  return { id: docRef.id, is_completed, created: true }
})
