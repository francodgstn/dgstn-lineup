import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { confirmClearedHoldFields, buildParticipantDoc, type SeatHold } from '@linyup/shared'
import { to } from '../utils/async'
import { hasTeamRole, isTeamMember } from '../utils/teams'

const CONTACTS_COLLECTION = 'contacts'
const RETENTION_DAYS = 30

// ─── deleteContact ────────────────────────────────────────────────────────────

export const deleteContact = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { contactId } = request.data as { contactId?: string }
  if (!contactId) throw new HttpsError('invalid-argument', 'contactId is required')

  const db = admin.firestore()
  const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
  const [getErr, contactSnap] = await to(contactRef.get())
  if (getErr) throw new HttpsError('internal', 'Error getting contact')
  if (!contactSnap || !contactSnap.exists) throw new HttpsError('not-found', 'Contact not found')

  const contactData = contactSnap.data()!
  const teamId = (contactData.teamId || contactData.teacher) as string

  const isLegacyOwner = contactData.teacher === request.auth.uid
  const hasManagerRole = teamId ? await hasTeamRole(request.auth.uid, teamId, 'manager') : false
  if (!isLegacyOwner && !hasManagerRole) {
    throw new HttpsError('permission-denied', 'You do not have permission to delete this contact')
  }

  if (contactData.deleted_at)
    throw new HttpsError('failed-precondition', 'Contact is already deleted')
  if (contactData.anonymized_at)
    throw new HttpsError('failed-precondition', 'Contact has been anonymized')

  const [updateErr] = await to(
    contactRef.update({
      deleted_at: FieldValue.serverTimestamp(),
      deleted_by: request.auth.uid,
      anonymized_at: null,
    })
  )
  if (updateErr) throw new HttpsError('internal', 'Error deleting contact')

  const restorationDeadline = new Date()
  restorationDeadline.setDate(restorationDeadline.getDate() + RETENTION_DAYS)

  return {
    success: true,
    contactId,
    deleted_at: new Date().toISOString(),
    restoration_deadline: restorationDeadline.toISOString(),
  }
})

// ─── restoreContact ───────────────────────────────────────────────────────────

export const restoreContact = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { contactId } = request.data as { contactId?: string }
  if (!contactId) throw new HttpsError('invalid-argument', 'contactId is required')

  const db = admin.firestore()
  const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
  const [getErr, contactSnap] = await to(contactRef.get())
  if (getErr) throw new HttpsError('internal', 'Error getting contact')
  if (!contactSnap || !contactSnap.exists) throw new HttpsError('not-found', 'Contact not found')

  const contactData = contactSnap.data()!
  const teamId = (contactData.teamId || contactData.teacher) as string

  const isLegacyOwner = contactData.teacher === request.auth.uid
  const hasManagerRole = teamId ? await hasTeamRole(request.auth.uid, teamId, 'manager') : false
  if (!isLegacyOwner && !hasManagerRole) {
    throw new HttpsError('permission-denied', 'You do not have permission to restore this contact')
  }

  if (!contactData.deleted_at) throw new HttpsError('failed-precondition', 'Contact is not deleted')
  if (contactData.anonymized_at)
    throw new HttpsError(
      'failed-precondition',
      'Contact has been anonymized and cannot be restored'
    )

  const deletedAt = (contactData.deleted_at as Timestamp).toDate()
  const daysSinceDeletion = Math.floor((Date.now() - deletedAt.getTime()) / (1000 * 60 * 60 * 24))
  if (daysSinceDeletion > RETENTION_DAYS) {
    throw new HttpsError(
      'failed-precondition',
      `Restoration window expired. Contact was deleted more than ${RETENTION_DAYS} days ago.`
    )
  }

  const [updateErr] = await to(contactRef.update({ deleted_at: null, deleted_by: null }))
  if (updateErr) throw new HttpsError('internal', 'Error restoring contact')

  return { success: true, contactId, restored_at: new Date().toISOString() }
})

// ─── checkInContact ───────────────────────────────────────────────────────────
//
// TAKES NO WAIVER, and the omission is a decision. This is the STAFF-side QR
// scanner (a coach opens the session detail page and scans the member's code),
// and it is the structural twin of `selfCheckIn`: it writes `participants` with
// no booking required — the booking read below only CONFIRMS an existing one.
// `selfCheckIn` IS gated; this is not, and the axis that separates them is WHO
// IS ACTING, not whether a gate is technically possible.
//
// A member scanning at a kiosk is acting alone and unsupervised, so the gate is
// the only thing between an unsigned person and the room. A coach scanning is a
// team member standing at the door who has chosen to admit this person, and an
// override a human chose is exactly what "surface, do not block" means — the
// same reasoning that leaves `createStaffAppointment` unblocked. Refusing here
// would stop a queue at the door over a document the coach cannot resolve from
// that screen, and they can add the same person to `participants` by hand from
// the same page anyway.
//
// The surfacing is the roster's waiver chip. The full census of attendance write
// sites, gated and exempt, lives in `waivers/gate.ts`.

export const checkInContact = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const {
    sessionId,
    contactId,
    hash,
    scope = 'sessions',
  } = request.data as {
    sessionId?: string
    contactId?: string
    hash?: string
    scope?: string
  }
  if (!sessionId || !contactId || !hash) {
    throw new HttpsError('invalid-argument', 'sessionId, contactId, and hash are required')
  }
  if (scope !== 'sessions') {
    throw new HttpsError('invalid-argument', 'Unsupported check-in scope')
  }

  const db = admin.firestore()
  const teacherId = request.auth.uid

  const sessionRef = db.collection('sessions').doc(sessionId)
  const [sessionErr, sessionDoc] = await to(sessionRef.get())
  if (sessionErr || !sessionDoc || !sessionDoc.exists)
    throw new HttpsError('not-found', 'Session not found')

  const session = sessionDoc.data()!
  const sessionTeamId = (session.teamId || session.teacher) as string

  const isLegacyOwner = session.teacher === teacherId
  const hasManagerRole = sessionTeamId
    ? await hasTeamRole(teacherId, sessionTeamId, 'manager')
    : false
  if (!isLegacyOwner && !hasManagerRole) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to check in contacts for this session'
    )
  }

  const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
  const [contactErr, contactDoc] = await to(contactRef.get())
  if (contactErr || !contactDoc || !contactDoc.exists)
    throw new HttpsError('not-found', 'Contact not found')

  const contact = contactDoc.data()!
  const contactTeamId = (contact.teamId || contact.teacher) as string

  const isContactLegacyOwner = contact.teacher === teacherId
  const contactTeamMatch = contactTeamId === sessionTeamId
  const hasContactTeamAccess = contactTeamId ? await isTeamMember(teacherId, contactTeamId) : false
  if (!contactTeamMatch || (!isContactLegacyOwner && !hasContactTeamAccess)) {
    throw new HttpsError('permission-denied', 'This contact does not belong to your team')
  }

  const contactSecret = contact.secret as string | undefined
  if (!contactSecret)
    throw new HttpsError('failed-precondition', 'Contact does not have a QR code generated')

  const expectedHash = crypto
    .createHash('sha256')
    .update(`${contactId}:${teacherId}:${contactSecret}`)
    .digest('hex')
  if (hash !== expectedHash) throw new HttpsError('permission-denied', 'Invalid QR code signature')

  const now = Timestamp.now()
  const sessionStart = session.start as Timestamp
  const sessionEnd =
    (session.end as Timestamp) ||
    Timestamp.fromMillis(sessionStart.toMillis() + ((session.duration as number) || 60) * 60 * 1000)

  const checkInWindowStart = Timestamp.fromMillis(sessionStart.toMillis() - 60 * 60 * 1000)
  const checkInWindowEnd = Timestamp.fromMillis(sessionEnd.toMillis() + 60 * 60 * 1000)

  if (now < checkInWindowStart || now > checkInWindowEnd) {
    throw new HttpsError('failed-precondition', 'Check-in window has closed for this session')
  }

  const participantRef = sessionRef.collection('participants').doc(contactId)
  const [partErr, participantDoc] = await to(participantRef.get())
  if (!partErr && participantDoc && participantDoc.exists) {
    return {
      success: true,
      alreadyCheckedIn: true,
      contactName: `${contact.firstname as string} ${contact.lastname as string}`,
      checkedInAt: participantDoc.data()!.checkedInAt,
    }
  }

  // ONE builder — see `selfCheckIn`. Both check-ins and both staff confirm
  // surfaces write the attendance row through `buildParticipantDoc`.
  const participantData = buildParticipantDoc({
    contactId,
    sessionId,
    who: {
      firstname: contact.firstname as string | undefined,
      lastname: contact.lastname as string | undefined,
      avatar_url: contact.avatar_url as string | undefined,
    },
    checkedInBy: 'qr-scan',
    checkedInAt: FieldValue.serverTimestamp(),
  })

  const bookingRef = sessionRef.collection('bookings').doc(contactId)
  const [bookingErr, bookingDoc] = await to(bookingRef.get())

  const batch = db.batch()
  batch.set(participantRef, participantData)

  if (!bookingErr && bookingDoc && bookingDoc.exists) {
    batch.update(bookingRef, {
      status: 'confirmed',
      confirmed_at: FieldValue.serverTimestamp(),
      // A confirmed seat is an ordinary booking from here on, so the hold
      // markers must go with the same write. `bookingHoldsSeat` no longer
      // expires a settled claim, so leaving the claim fields is not an oversell
      // any more — but they would still make `sendBookingReminders` skip this
      // person forever, and a stale flag on a confirmed booking is a lie the
      // next reader has to untangle. A claim that was mid-payment carries the
      // drop-in hold's `payment_status`/`expires_at` on top, and THOSE still
      // cost the seat: `confirmClearedHoldFields` is the one patch all four
      // confirm surfaces apply. Deleting an absent field is a no-op.
      ...confirmClearedHoldFields(bookingDoc.data() as SeatHold, FieldValue.delete()),
    })
    // No `bookings_count` here — a confirmed booking still holds its seat, and
    // trackBookings' recount owns that number (same fix as the kiosk self-scan
    // in sessions/index.ts).
    batch.update(sessionRef, {
      conversions_count: FieldValue.increment(1),
    })
    batch.update(contactRef, { pending_bookings_count: FieldValue.increment(-1) })
  }

  await batch.commit()

  return {
    success: true,
    alreadyCheckedIn: false,
    contactName: `${contact.firstname as string} ${contact.lastname as string}`,
    checkedInAt: now,
  }
})

// ─── moveContacts ─────────────────────────────────────────────────────────────

export const moveContacts = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { contactIds, newTeamId } = request.data as { contactIds?: string[]; newTeamId?: string }
  if (!contactIds || contactIds.length === 0)
    throw new HttpsError('invalid-argument', 'contactIds is required')
  if (!newTeamId) throw new HttpsError('invalid-argument', 'newTeamId is required')

  const db = admin.firestore()
  const authId = request.auth.uid

  const [targetErr, targetDoc] = await to(db.collection('teams').doc(newTeamId).get())
  if (targetErr || !targetDoc || !targetDoc.exists)
    throw new HttpsError('not-found', 'Target team not found')

  // First pass: validate all contacts share the same source team
  let sourceTeamId: string | null = null
  const contactRefs: admin.firestore.DocumentReference[] = []

  for (const contactId of contactIds) {
    const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
    const [cErr, contactDoc] = await to(contactRef.get())
    if (cErr || !contactDoc || !contactDoc.exists)
      throw new HttpsError('not-found', `Contact ${contactId} not found`)

    const data = contactDoc.data()!
    const contactTeamId = (data.teamId || data.teacher) as string | undefined
    if (!contactTeamId)
      throw new HttpsError('failed-precondition', `Contact ${contactId} has no team assigned`)
    if (!sourceTeamId) {
      sourceTeamId = contactTeamId
    } else if (contactTeamId !== sourceTeamId) {
      throw new HttpsError('invalid-argument', 'All contacts must belong to the same team')
    }
    contactRefs.push(contactRef)
  }

  const isLegacyOwner = authId === sourceTeamId
  const hasRole = sourceTeamId ? await hasTeamRole(authId, sourceTeamId, 'manager') : false
  if (!hasRole && !isLegacyOwner)
    throw new HttpsError('permission-denied', 'You must be a manager or owner of the source team')

  const hasTargetRole = await hasTeamRole(authId, newTeamId, 'manager')
  if (!hasTargetRole && authId !== newTeamId)
    throw new HttpsError('permission-denied', 'You must be a manager or owner of the target team')

  const batch = db.batch()
  for (const ref of contactRefs) {
    batch.update(ref, { teamId: newTeamId })
  }
  const [updateErr] = await to(batch.commit())
  if (updateErr) throw new HttpsError('internal', 'Failed to move contacts')

  return { success: true, movedCount: contactRefs.length }
})
