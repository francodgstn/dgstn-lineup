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

    // Include docs with no status field (treated as pending), but never an
    // UNSETTLED HOLD. A hold is not an attendance record: an abandoned drop-in
    // checkout (`payment_status: 'required'`) and a waitlist claim that was
    // never taken up (`waitlist_claim`) are both `pending` with `fromBioLink`,
    // so this job used to stamp "no_show" on a real person who never had a
    // booking — and decrement a counter that was never incremented for them.
    // expirePendingBookings owns those documents; it deletes them.
    const pendingDocs = bookSnap!.docs.filter((d) => {
      const b = d.data()
      if (b.status && b.status !== 'pending') return false
      return b.payment_status !== 'required' && b.waitlist_claim !== true
    })
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

      // No session counter write. `bookings_count` has one writing style —
      // absolute, from a read set — and a batch has no conflict detection, so
      // this `increment(-n)` could clobber (or be clobbered by) a concurrent
      // booking's absolute write. trackBookings recounts on each 'no_show' flip.
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
