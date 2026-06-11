import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { SESSIONS_COLLECTION, CONTACTS_COLLECTION } from '@linyup/shared'

export async function markNoShowBookings(): Promise<{
  sessions: number
  updated: number
  errors: number
}> {
  console.log('markNoShowBookings task started') // eslint-disable-line no-console

  const db = admin.firestore()
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600000)
  const stats = { sessions: 0, updated: 0, errors: 0 }

  const [sessErr, sessSnap] = await to(
    db
      .collection(SESSIONS_COLLECTION)
      .where('end', '>=', Timestamp.fromDate(sevenDaysAgo))
      .where('end', '<', Timestamp.fromDate(now))
      .get()
  )
  if (sessErr) {
    console.error('markNoShowBookings: error fetching sessions:', sessErr) // eslint-disable-line no-console
    throw sessErr
  }

  stats.sessions = sessSnap!.size
  console.log(`markNoShowBookings: found ${sessSnap!.size} past sessions to check`) // eslint-disable-line no-console

  for (const sessionDoc of sessSnap!.docs) {
    const [bookErr, bookSnap] = await to(
      sessionDoc.ref.collection('bookings').where('fromBioLink', '==', true).get()
    )
    if (bookErr) {
      console.error(
        `markNoShowBookings: error fetching bookings for session ${sessionDoc.id}:`,
        bookErr
      ) // eslint-disable-line no-console
      stats.errors++
      continue
    }

    // Include docs with no status field (treated as pending)
    const pendingDocs = bookSnap!.docs.filter(
      (d) => !d.data().status || d.data().status === 'pending'
    )
    if (pendingDocs.length === 0) continue

    try {
      const batch = db.batch()

      for (const bookingDoc of pendingDocs) {
        const booking = bookingDoc.data()
        batch.update(bookingDoc.ref, {
          status: 'no_show',
          no_show_at: FieldValue.serverTimestamp(),
        })

        const contactId = (booking.contact || booking.contactId) as string | undefined
        if (contactId) {
          batch.update(db.collection(CONTACTS_COLLECTION).doc(contactId), {
            pending_bookings_count: FieldValue.increment(-1),
          })
        }
      }

      batch.update(sessionDoc.ref, {
        bio_link_bookings_count: FieldValue.increment(-pendingDocs.length),
      })

      await batch.commit()
      stats.updated += pendingDocs.length
      console.log(
        `markNoShowBookings: session ${sessionDoc.id} — flipped ${pendingDocs.length} bookings to no_show`
      ) // eslint-disable-line no-console
    } catch (err) {
      console.error(
        `markNoShowBookings: error updating session ${sessionDoc.id}:`,
        (err as Error).message
      ) // eslint-disable-line no-console
      stats.errors++
    }
  }

  console.log('markNoShowBookings task completed:', stats) // eslint-disable-line no-console
  return stats
}
