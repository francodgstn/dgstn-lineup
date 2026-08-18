/* eslint-disable no-console */
// The two row actions on the studio's own queue view (session detail, day sheet).
//
// They are callables and not client writes, and that is the whole point: every
// waitlist transition moves a seat count or a claim hold, and `firestore.rules`
// denies ALL client writes to `sessions/{id}/waitlist/**` — including from a
// schedule.manage holder. A coach flipping an entry to 'offered' from the
// browser would mint a claim nobody held a seat for, and a coach deleting one
// would leave a hold behind with no owner. Both go through the same
// transactions the automatic paths use.
//
// Deliberately absent: an admin "book them in directly" action. That would be a
// second capacity-writing path for a job the existing booking surfaces already
// do — the add-participant dialog and the walk-in door both write a seat
// through gates that recount.
//
// EVERY refusal here carries `details.reason`, and so does every refusal these
// two can reach (`offerWaitlistSeats`' guards, the undeliverable-offer release).
// The reason IS the copy: the session page maps it to a translated string
// (`waitlistErrorKey`, SessionDetail.waitlistError*), because the strings in
// this file are English and a coach in Lausanne pressing "Offer now" must not
// read them. A new throw without a reason silently falls back to the English
// message — add one.

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { SESSIONS_COLLECTION, WAITLIST_SUBCOLLECTION } from '@linyup/shared'
import { assertManager } from '../../connect/access'
import { offerWaitlistSeatsAndNotify } from './promote'
import { releaseWaitlistOffer } from './release'

/** Both callables address one entry: `sessions/{sessionId}/waitlist/{contactId}`. */
interface EntryTarget {
  teamId: string
  sessionId: string
  contactId: string
}

/**
 * Resolve the addressed entry and prove the caller may act on it.
 *
 * The session's OWN `teamId` is what the manager check runs against — a caller
 * who passed someone else's `sessionId` with their own `teamId` would otherwise
 * pass `assertManager` and then act on another studio's queue.
 */
async function requireEntryAccess(
  uid: string,
  data: Partial<EntryTarget>
): Promise<{ target: EntryTarget; entryRef: FirebaseFirestore.DocumentReference }> {
  const bad = (message: string) =>
    new HttpsError('invalid-argument', message, { reason: 'invalid_request' })
  if (!data?.teamId) throw bad('teamId is required')
  if (!data?.sessionId) throw bad('sessionId is required')
  if (!data?.contactId) throw bad('contactId is required')
  const { teamId, sessionId, contactId } = data as EntryTarget

  const db = admin.firestore()
  const sessionSnap = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get()
  if (!sessionSnap.exists) {
    throw new HttpsError('not-found', 'Session not found', { reason: 'session_unavailable' })
  }
  if (sessionSnap.data()?.teamId !== teamId) {
    throw new HttpsError('permission-denied', 'Session does not belong to this team', {
      reason: 'permission_denied',
    })
  }
  await assertManager(uid, teamId)

  return {
    target: { teamId, sessionId, contactId },
    entryRef: sessionSnap.ref.collection(WAITLIST_SUBCOLLECTION).doc(contactId),
  }
}

/**
 * "Offer now" — hand the seat to this person ahead of the queue.
 *
 * The coach at the door has context the `joined_at` order does not: the person
 * at the front has already said they cannot make it, or is standing in the room
 * on someone else's booking. Pinning skips the ORDER and nothing else — the
 * same transaction re-verifies the cutoff, the claim window, the activity flag
 * and, above all, that a seat is genuinely free. A pinned run throws rather than
 * no-opping (see `OfferWaitlistOptions`), so the button reports which guard
 * refused instead of appearing to do nothing.
 */
export const promoteWaitlistEntry = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required', {
      reason: 'unauthenticated',
    })
  }
  const { target, entryRef } = await requireEntryAccess(
    request.auth.uid,
    request.data as Partial<EntryTarget>
  )

  const entrySnap = await entryRef.get()
  if (!entrySnap.exists) {
    throw new HttpsError('not-found', 'Waitlist entry not found', { reason: 'entry_not_found' })
  }
  const status = entrySnap.data()?.status as string | undefined
  // Checked here purely so the common mistakes read as themselves. The
  // transaction re-derives all of this from its own read set — this is the
  // message, never the guard.
  if (status === 'offered') {
    throw new HttpsError('failed-precondition', 'This person already has an offer.', {
      reason: 'already_offered',
    })
  }
  if (status !== 'waiting') {
    throw new HttpsError('failed-precondition', 'This person is no longer waiting for a seat.', {
      reason: 'not_waiting',
    })
  }

  // The notification rides the same path an automatic offer's does — one
  // function offers AND tells the person, so the manual and automatic routes can
  // never drift into "the coach's offer emails, the trigger's doesn't".
  const offers = await offerWaitlistSeatsAndNotify(target.sessionId, {
    pinnedContactId: target.contactId,
  })
  console.log(
    `[waitlist] ${request.auth.uid} offered a seat on session ${target.sessionId} to contact ${target.contactId}`
  )
  return { ok: true, offered: offers.length }
})

/**
 * "Remove" — take this person out of the queue.
 *
 * Terminal status is 'left' rather than 'expired': the entry did not run out of
 * time, somebody decided it was over. `releaseWaitlistOffer` applies the same
 * guard every other release path does — a hold that has already been claimed or
 * paid for is never deleted, the entry is corrected to match the booking
 * instead. So removing an entry can never destroy a seat somebody owns.
 */
export const removeWaitlistEntry = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required', {
      reason: 'unauthenticated',
    })
  }
  const { target, entryRef } = await requireEntryAccess(
    request.auth.uid,
    request.data as Partial<EntryTarget>
  )
  if (!(await entryRef.get()).exists) {
    throw new HttpsError('not-found', 'Waitlist entry not found', { reason: 'entry_not_found' })
  }

  const { outcome } = await releaseWaitlistOffer({
    entryRef,
    terminalStatus: 'left',
    from: ['waiting', 'offered'],
  })

  // Removing someone who held an offer frees their seat THIS instant. The
  // session write inside the release usually re-fires the promotion trigger,
  // but only when the class was exactly full before it — so roll the queue on
  // explicitly. `offerWaitlistSeats` re-reads everything and writes nothing when
  // there is nothing to do.
  if (outcome === 'released') {
    try {
      await offerWaitlistSeatsAndNotify(target.sessionId)
    } catch (err) {
      console.error(`[waitlist] re-offer after admin removal on ${target.sessionId} failed:`, err)
    }
  }

  console.log(
    `[waitlist] ${request.auth.uid} removed contact ${target.contactId} from the queue on session ${target.sessionId} (${outcome})`
  )
  return { ok: true, outcome }
})
