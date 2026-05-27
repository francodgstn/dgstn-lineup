/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getTeam } from '../utils/teams'
import { sendEmail } from '../utils/email'
import { generateSecureToken } from '../utils/crypto'
import { getHostingUrl } from '../utils/env'
import { to } from '../utils/async'
import {
  buildCoachingConfirmationEmail,
  buildCoachingICalAttachment,
  buildCoachNotificationEmail,
  buildCoachingCancellationEmail,
} from './templates'


type Lang = 'en' | 'de' | 'fr' | 'it'
const VALID_LANGS: Lang[] = ['en', 'de', 'fr', 'it']
function isLang(v: unknown): v is Lang { return VALID_LANGS.includes(v as Lang) }

const TIMEZONE = 'Europe/Zurich'
const GENERATION_WINDOW_DAYS = 28

// ─── timezone helper ──────────────────────────────────────────────────────────

function getDatePartsInTz(date: Date): { year: number; month: number; day: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'narrow',
  }).formatToParts(date)
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10)
  const weekdayStr = parts.find((p) => p.type === 'weekday')!.value  // 'S' 'M' 'T' 'W' 'T' 'F' 'S'
  const weekdayMap: Record<string, number> = { S: -1, M: 1, T: 2, W: 3, F: 5 }  // too ambiguous, use a JS Date instead
  const [y, m, d] = [get('year'), get('month'), get('day')]
  // Reconstruct a noon-UTC date in that local calendar date to read getDay() correctly
  const localNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  void weekdayStr; void weekdayMap
  return { year: y, month: m, day: d, dayOfWeek: localNoon.getUTCDay() }
}

function localTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  })
  const p = Object.fromEntries(formatter.formatToParts(utcGuess).map(({ type, value }) => [type, parseInt(value, 10)]))
  const diffMs = Date.UTC(year, month - 1, day, hour, minute, 0)
    - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return new Date(utcGuess.getTime() + diffMs)
}

// ─── slot occurrence generator ────────────────────────────────────────────────

interface AvailabilityDoc {
  teamId: string
  coachId: string
  coachName: string
  title: string
  description?: string | null
  isFreeTrial?: boolean
  status: 'active' | 'paused' | 'archived'
  duration_minutes: number
  max_participants: number
  location?: string | null
  onlineUrl?: string | null
  recurrence: {
    daysOfWeek: number[]
    time: string
    startDate: Timestamp
    endDate?: Timestamp | null
  }
}

function generateOccurrences(
  template: AvailabilityDoc,
  from: Date,
  to: Date,
): { start: Date; end: Date }[] {
  const [hour, minute] = template.recurrence.time.split(':').map(Number)
  const validFrom = template.recurrence.startDate.toDate()
  const validUntil = template.recurrence.endDate?.toDate() ?? null

  const results: { start: Date; end: Date }[] = []
  // Start iterating from the later of `from` and `validFrom`
  const cursor = new Date(Math.max(from.getTime(), validFrom.getTime()))
  cursor.setUTCHours(0, 0, 0, 0)

  while (cursor <= to) {
    if (validUntil && cursor > validUntil) break
    const { year, month, day, dayOfWeek } = getDatePartsInTz(cursor)
    if (template.recurrence.daysOfWeek.includes(dayOfWeek)) {
      const start = localTimeToUtc(year, month, day, hour, minute)
      if (start > new Date()) {  // only future slots
        const end = new Date(start.getTime() + template.duration_minutes * 60_000)
        results.push({ start, end })
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return results
}

// ─── core generation logic ────────────────────────────────────────────────────

async function generateSlotsForTemplate(
  templateId: string,
  template: AvailabilityDoc,
): Promise<{ created: number; skipped: number }> {
  const db = admin.firestore()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + GENERATION_WINDOW_DAYS * 24 * 60 * 60_000)
  const occurrences = generateOccurrences(template, now, windowEnd)

  let created = 0
  let skipped = 0

  for (const occ of occurrences) {
    const startTs = Timestamp.fromDate(occ.start)
    const existing = await db.collection('coach_slots')
      .where('templateId', '==', templateId)
      .where('start', '==', startTs)
      .limit(1)
      .get()

    if (!existing.empty) { skipped++; continue }

    await db.collection('coach_slots').add({
      teamId: template.teamId,
      templateId,
      coachId: template.coachId,
      coachName: template.coachName,
      title: template.title,
      description: template.description ?? null,
      isFreeTrial: template.isFreeTrial !== false,
      start: startTs,
      end: Timestamp.fromDate(occ.end),
      duration_minutes: template.duration_minutes,
      max_participants: template.max_participants,
      bookings_count: 0,
      location: template.location ?? null,
      onlineUrl: template.onlineUrl ?? null,
      status: 'open',
      created_at: FieldValue.serverTimestamp(),
      cancelled_at: null,
    })
    created++
  }

  return { created, skipped }
}

async function runGenerationForTeam(teamId: string): Promise<{ created: number; skipped: number }> {
  const db = admin.firestore()
  const snap = await db.collection('coach_availability')
    .where('teamId', '==', teamId)
    .where('status', '==', 'active')
    .get()

  let created = 0
  let skipped = 0
  for (const doc of snap.docs) {
    const result = await generateSlotsForTemplate(doc.id, doc.data() as AvailabilityDoc)
    created += result.created
    skipped += result.skipped
  }
  return { created, skipped }
}

async function runGenerationAll(): Promise<{ created: number; skipped: number }> {
  const db = admin.firestore()
  const snap = await db.collection('coach_availability').where('status', '==', 'active').get()

  let created = 0
  let skipped = 0
  for (const doc of snap.docs) {
    const result = await generateSlotsForTemplate(doc.id, doc.data() as AvailabilityDoc)
    created += result.created
    skipped += result.skipped
  }
  return { created, skipped }
}

// ─── generateCoachSlotsScheduled ─────────────────────────────────────────────

export const generateCoachSlotsScheduled = onSchedule(
  { schedule: '0 2 * * *', timeZone: TIMEZONE },
  async () => {
    const result = await runGenerationAll()
    console.log(`generateCoachSlots (scheduled): created=${result.created} skipped=${result.skipped}`)
  },
)

// ─── generateCoachSlots (callable) ───────────────────────────────────────────

export const generateCoachSlots = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const { teamId } = request.data as { teamId?: string }
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  const memberDoc = await admin.firestore()
    .collection('teams').doc(teamId)
    .collection('team_members').doc(request.auth.uid)
    .get()
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Not a team member')

  const result = await runGenerationForTeam(teamId)
  console.log(`generateCoachSlots (manual) teamId=${teamId}: created=${result.created} skipped=${result.skipped}`)
  return result
})

// ─── bookCoachSlot ────────────────────────────────────────────────────────────

export const bookCoachSlot = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    slotId?: string
    authenticatedContactId?: string
    verificationCodeId?: string
    contact?: {
      firstname: string
      lastname: string
      email: string
      phone?: string
      notes?: string
    }
  }

  if (!data?.teamId || !data?.slotId) {
    throw new HttpsError('invalid-argument', 'teamId and slotId are required')
  }

  const db = admin.firestore()

  // Validate team
  const team = await getTeam(data.teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')
  const lang: Lang = isLang(team.language) ? team.language : 'en'
  const teamName: string = team.name || 'Our Team'

  // Validate slot
  const slotDoc = await db.collection('coach_slots').doc(data.slotId).get()
  if (!slotDoc.exists) throw new HttpsError('not-found', 'Slot not found')
  const slot = slotDoc.data()!

  if (slot.teamId !== data.teamId) throw new HttpsError('permission-denied', 'Slot does not belong to this team')
  if (slot.status === 'cancelled') throw new HttpsError('failed-precondition', 'This slot has been cancelled')
  if (slot.status === 'full') throw new HttpsError('failed-precondition', 'This slot is fully booked')

  const now = Timestamp.now()
  if (slot.start.toMillis() < now.toMillis()) {
    throw new HttpsError('failed-precondition', 'Cannot book slots in the past')
  }

  // ── Members-only gate ──────────────────────────────────────────────────────
  const slotIsFreeTrial = slot.isFreeTrial !== false

  if (!slotIsFreeTrial) {
    if (!data.authenticatedContactId) {
      throw new HttpsError('permission-denied', 'This coaching series is for registered members only. Please verify your email.')
    }
    // Validate verification code
    if (data.verificationCodeId) {
      const codeDoc = await db.collection('booking_verification_codes').doc(data.verificationCodeId).get()
      if (!codeDoc.exists) throw new HttpsError('invalid-argument', 'Invalid verification code')
      const codeData = codeDoc.data()!
      if (!codeData.verified) throw new HttpsError('failed-precondition', 'Verification code not verified')
      if (codeData.team_id !== data.teamId) throw new HttpsError('permission-denied', 'Code does not match team')
      if (!(codeData.matched_contact_ids || []).includes(data.authenticatedContactId)) {
        throw new HttpsError('permission-denied', 'Contact not found in verified matches')
      }
    }
    const contactDoc = await db.collection('contacts').doc(data.authenticatedContactId).get()
    if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found')
    const contactData = contactDoc.data()!
    if (contactData.teamId !== data.teamId) throw new HttpsError('permission-denied', 'Contact does not belong to this team')
    if (contactData.type === 'trial') {
      throw new HttpsError('permission-denied', 'This coaching series is for members only. Trial accounts cannot book.')
    }
  }

  // Resolve contact details — authenticated path uses Firestore, guest path uses form input
  let resolvedContact: { firstname: string; lastname: string; email: string; phone?: string | null; notes?: string | null }

  if (data.authenticatedContactId) {
    const contactDoc = await db.collection('contacts').doc(data.authenticatedContactId).get()
    if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found')
    const c = contactDoc.data()!
    resolvedContact = {
      firstname: c.firstname || '',
      lastname: c.lastname || '',
      email: (c.email || '').toLowerCase().trim(),
      phone: c.phone || null,
      notes: null,
    }
  } else {
    if (!data.contact) throw new HttpsError('invalid-argument', 'contact details are required')
    const { firstname, lastname, email, phone, notes } = data.contact
    if (!firstname || !lastname || !email) {
      throw new HttpsError('invalid-argument', 'firstname, lastname and email are required')
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) throw new HttpsError('invalid-argument', 'Invalid email format')
    resolvedContact = {
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim() || null,
      notes: notes?.trim() || null,
    }
  }

  const sanitized = {
    ...resolvedContact,
    fullname: `${resolvedContact.firstname} ${resolvedContact.lastname}`,
  }

  // Duplicate check by email
  const dupSnap = await db.collection('coach_slots').doc(data.slotId)
    .collection('bookings')
    .where('email', '==', sanitized.email)
    .where('status', '==', 'confirmed')
    .limit(1)
    .get()
  if (!dupSnap.empty) throw new HttpsError('already-exists', 'This email is already booked for this slot')

  // Get coach email for notification
  let coachEmail: string | null = null
  let coachFirstname = 'Coach'
  const [, coachUserDoc] = await to(db.collection('users').doc(slot.coachId).get())
  if (coachUserDoc && coachUserDoc.exists) {
    coachEmail = coachUserDoc.get('email') || null
    coachFirstname = coachUserDoc.get('firstname') || 'Coach'
  }

  // Create booking
  const cancelToken = generateSecureToken()
  const teamSlug: string | null = team.slug || null
  const cancelUrl = teamSlug
    ? `${getHostingUrl()}/portal/${teamSlug}/coaching/cancel?token=${cancelToken}`
    : null

  const bookingRef = await db.collection('coach_slots').doc(data.slotId)
    .collection('bookings').add({
      slotId: data.slotId,
      teamId: data.teamId,
      firstname: sanitized.firstname,
      lastname: sanitized.lastname,
      fullname: sanitized.fullname,
      email: sanitized.email,
      phone: sanitized.phone,
      notes: sanitized.notes,
      cancel_token: cancelToken,
      status: 'confirmed',
      booked_at: FieldValue.serverTimestamp(),
      cancelled_at: null,
    })

  const slotStart: Date = slot.start.toDate()
  const slotEnd: Date = slot.end.toDate()

  // Send confirmation email to client
  if (cancelUrl) {
    try {
      const email = buildCoachingConfirmationEmail({
        firstname: sanitized.firstname,
        teamName,
        slotTitle: slot.title,
        coachName: slot.coachName,
        start: slotStart,
        end: slotEnd,
        location: slot.location,
        onlineUrl: slot.onlineUrl,
        cancelUrl,
        lang,
      })
      const ical = buildCoachingICalAttachment({
        bookingId: bookingRef.id,
        slotTitle: slot.title,
        start: slotStart,
        end: slotEnd,
        location: slot.location,
        coachName: slot.coachName,
        coachEmail: coachEmail || 'noreply@lineup.app',
        clientName: sanitized.fullname,
        clientEmail: sanitized.email,
      })
      const subjects: Record<Lang, string> = {
        en: `Appointment Confirmed – ${slot.title}`,
        de: `Termin bestätigt – ${slot.title}`,
        fr: `Rendez-vous confirmé – ${slot.title}`,
        it: `Appuntamento confermato – ${slot.title}`,
      }
      await sendEmail({
        to: sanitized.email,
        subject: subjects[lang],
        html: email.html,
        text: email.text,
        attachments: [{ filename: ical.filename, content: ical.content, contentType: ical.contentType }],
      })
    } catch (err) {
      console.error('Error sending coaching confirmation email:', err)
    }
  }

  // Send notification email to coach
  if (coachEmail) {
    try {
      const notif = buildCoachNotificationEmail({
        coachFirstname,
        clientName: sanitized.fullname,
        clientEmail: sanitized.email,
        clientPhone: sanitized.phone,
        slotTitle: slot.title,
        start: slotStart,
        end: slotEnd,
        notes: sanitized.notes,
        lang,
      })
      const subjects: Record<Lang, string> = {
        en: `New appointment: ${sanitized.fullname}`,
        de: `Neuer Termin: ${sanitized.fullname}`,
        fr: `Nouveau rendez-vous : ${sanitized.fullname}`,
        it: `Nuovo appuntamento: ${sanitized.fullname}`,
      }
      await sendEmail({ to: coachEmail, subject: subjects[lang], html: notif.html, text: notif.text })
    } catch (err) {
      console.error('Error sending coaching coach notification email:', err)
    }
  }

  return {
    success: true,
    bookingId: bookingRef.id,
    slotDetails: { title: slot.title, start: slotStart.toISOString(), end: slotEnd.toISOString() },
  }
})

// ─── cancelCoachBooking ───────────────────────────────────────────────────────

export const cancelCoachBooking = onCall(async (request) => {
  const { token } = request.data as { token?: string }
  if (!token) throw new HttpsError('invalid-argument', 'Cancel token is required')

  const db = admin.firestore()

  const bookingSnap = await db.collectionGroup('bookings')
    .where('cancel_token', '==', token)
    .limit(1)
    .get()

  if (bookingSnap.empty) {
    throw new HttpsError('not-found', 'Booking not found. The link may have expired or already been used.')
  }

  const bookingDoc = bookingSnap.docs[0]
  const booking = bookingDoc.data()

  // Only handle coach bookings (must have cancel_token field and slotId)
  if (!booking.slotId) throw new HttpsError('not-found', 'Booking not found')
  if (booking.status === 'cancelled') {
    throw new HttpsError('failed-precondition', 'This appointment has already been cancelled.')
  }

  // Validate slot is in the future
  const [, slotDoc] = await to(db.collection('coach_slots').doc(booking.slotId).get())
  if (!slotDoc || !slotDoc.exists) throw new HttpsError('not-found', 'Slot no longer exists')
  const slot = slotDoc.data()!
  const slotStart: Date = slot.start.toDate()
  if (slotStart < new Date()) {
    throw new HttpsError('failed-precondition', 'Cannot cancel a past appointment.')
  }

  // Cancel the booking
  await bookingDoc.ref.update({
    status: 'cancelled',
    cancelled_at: FieldValue.serverTimestamp(),
  })
  // trackCoachBookings trigger will update the slot's bookings_count and status

  // Send cancellation email
  const teamId: string = booking.teamId
  let teamName = ''
  let lang: Lang = 'en'
  const [, teamDoc] = await to(db.collection('teams').doc(teamId).get())
  if (teamDoc && teamDoc.exists) {
    teamName = teamDoc.data()!.name || ''
    const l = teamDoc.data()!.language
    if (isLang(l)) lang = l
  }

  try {
    const cancelEmail = buildCoachingCancellationEmail({
      firstname: booking.firstname,
      teamName,
      slotTitle: slot.title,
      start: slotStart,
      lang,
    })
    const subjects: Record<Lang, string> = {
      en: `Appointment Cancelled – ${slot.title}`,
      de: `Termin abgesagt – ${slot.title}`,
      fr: `Rendez-vous annulé – ${slot.title}`,
      it: `Appuntamento annullato – ${slot.title}`,
    }
    await sendEmail({ to: booking.email, subject: subjects[lang], html: cancelEmail.html, text: cancelEmail.text })
  } catch (err) {
    console.error('Error sending coaching cancellation email:', err)
  }

  return { success: true, message: 'Your appointment has been cancelled.' }
})

// ─── trackCoachBookings ───────────────────────────────────────────────────────

export const trackCoachBookings = onDocumentWritten(
  'coach_slots/{slotId}/bookings/{bookingId}',
  async (event) => {
    const { slotId } = event.params
    const db = admin.firestore()

    const [, bookingsSnap] = await to(
      db.collection('coach_slots').doc(slotId)
        .collection('bookings')
        .where('status', '==', 'confirmed')
        .get()
    )
    if (!bookingsSnap) return

    const count = bookingsSnap.size

    const [, slotDoc] = await to(db.collection('coach_slots').doc(slotId).get())
    if (!slotDoc || !slotDoc.exists) return
    const slot = slotDoc.data()!
    if (slot.status === 'cancelled') return  // never un-cancel a slot via trigger

    const newStatus = count >= (slot.max_participants || 1) ? 'full' : 'open'
    await slotDoc.ref.update({ bookings_count: count, status: newStatus })
  },
)

// ─── onCoachAvailabilityWritten — auto-generate slots on template save ────────

export const onCoachAvailabilityWritten = onDocumentWritten(
  'coach_availability/{templateId}',
  async (event) => {
    const after = event.data?.after
    if (!after?.exists) return  // deleted — nothing to generate
    const template = after.data() as AvailabilityDoc
    if (template.status !== 'active') return  // paused or archived
    try {
      const result = await generateSlotsForTemplate(event.params.templateId, template)
      console.log(`onCoachAvailabilityWritten templateId=${event.params.templateId}: created=${result.created} skipped=${result.skipped}`)
    } catch (err) {
      console.error('onCoachAvailabilityWritten: slot generation failed', err)
    }
  },
)

// ─── getPublicCoachSlots — public callable for portal use ────────────────────

export const getPublicCoachSlots = onCall(async (request) => {
  const { teamSlug } = request.data as { teamSlug?: string }
  if (!teamSlug) throw new HttpsError('invalid-argument', 'teamSlug is required')

  const db = admin.firestore()

  // Resolve team by slug
  const profileSnap = await db.collectionGroup('public_profile')
    .where('slug', '==', teamSlug)
    .where('type', '==', 'team')
    .limit(1)
    .get()
  if (profileSnap.empty) throw new HttpsError('not-found', 'Team not found')
  const teamId = profileSnap.docs[0].ref.parent.parent!.id

  const now = Timestamp.now()
  const windowEnd = Timestamp.fromMillis(now.toMillis() + 60 * 24 * 60 * 60_000)

  const slotsSnap = await db.collection('coach_slots')
    .where('teamId', '==', teamId)
    .where('status', '==', 'open')
    .where('start', '>=', now)
    .where('start', '<=', windowEnd)
    .orderBy('start', 'asc')
    .limit(50)
    .get()

  return {
    teamId,
    slots: slotsSnap.docs.map((d) => {
      const s = d.data()
      return {
        id: d.id,
        title: s.title as string,
        description: (s.description as string) ?? null,
        coachName: s.coachName as string,
        start: (s.start as Timestamp).toMillis(),
        end: (s.end as Timestamp).toMillis(),
        duration_minutes: s.duration_minutes as number,
        max_participants: s.max_participants as number,
        bookings_count: s.bookings_count as number,
        location: (s.location as string) ?? null,
        onlineUrl: (s.onlineUrl as string) ?? null,
        isFreeTrial: s.isFreeTrial !== false,
      }
    }),
  }
})
