/* eslint-disable no-console */
// Open availability windows (Calendly-style). A coach advertises a daily time
// range + allowed durations; clients pick a start. Unlike fixed-slot templates,
// NOTHING is pre-generated — availability is computed on the fly here, and a
// Session is created lazily, overlap-safe, at booking time.
//
//  • listAvailability  — public: free start times per coach/day/duration.
//  • bookAppointment    — public: overlap-checked create-session + book.
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getTeam } from '../utils/teams'
import { sendEmail } from '../utils/email'
import { systemEmailEnabledFor } from '../utils/systemEmails'
import { generateSecureToken } from '../utils/crypto'
import { getHostingUrl } from '../utils/env'
import { to } from '../utils/async'
import { resolveSingleContact } from '../utils/contacts'
import { canCreateContact } from '../utils/contactCap'
import { AVAILABILITY_COLLECTION, type SaasPlan } from '@linyup/shared'
import { getDatePartsInTz, localTimeToUtc } from './index'
import {
  buildAppointmentConfirmationEmail,
  buildAppointmentICalAttachment,
  buildAppointmentProviderNotificationEmail,
} from './templates'

type Lang = 'en' | 'de' | 'fr' | 'it'
const VALID_LANGS: Lang[] = ['en', 'de', 'fr', 'it']
const asLang = (v: unknown): Lang => (VALID_LANGS.includes(v as Lang) ? (v as Lang) : 'en')

const DAY_MS = 24 * 60 * 60_000
const MAX_SESSION_MS = 8 * 60 * 60_000 // upper bound on any single appointment
const DEFAULT_RANGE_DAYS = 28
const MAX_RANGE_DAYS = 60

const parseHHMM = (s: unknown): [number, number] => {
  const [h, m] = String(s ?? '').split(':').map((x) => parseInt(x, 10))
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0]
}

interface WindowTemplate {
  id: string
  teamId: string
  providerId: string
  providerName: string
  title: string
  status: string
  mode?: string
  isFreeTrial?: boolean
  location?: string | null
  onlineUrl?: string | null
  window?: { start: string; end: string }
  durationsMinutes?: number[]
  granularityMinutes?: number
  bufferMinutes?: number
  recurrence?: {
    daysOfWeek?: number[]
    startDate?: Timestamp
    endDate?: Timestamp | null
  }
}

interface BusyInterval {
  start: number
  end: number
}

// Does [start, start+dur) collide with any busy interval expanded by buffer?
function conflicts(startMs: number, durMs: number, busy: BusyInterval[], bufferMs: number): boolean {
  const endMs = startMs + durMs
  return busy.some((b) => startMs < b.end + bufferMs && endMs > b.start - bufferMs)
}

// ─── listAvailability (public) ─────────────────────────────────────────────────

export const listAvailability = onCall(async (request) => {
  const data = request.data as { teamId?: string; providerId?: string; days?: number }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  const rangeDays = Math.min(Math.max(Math.floor(data.days ?? DEFAULT_RANGE_DAYS), 1), MAX_RANGE_DAYS)
  const db = admin.firestore()
  const nowMs = Date.now()
  const toMs = nowMs + rangeDays * DAY_MS

  const snap = await db
    .collection(AVAILABILITY_COLLECTION)
    .where('teamId', '==', data.teamId)
    .where('status', '==', 'active')
    .get()
  const templates: WindowTemplate[] = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<WindowTemplate, 'id'>) }))
    .filter((t) => t.mode === 'open_window' && (!data.providerId || t.providerId === data.providerId))
  if (templates.length === 0) return { coaches: [] }

  // Group templates by provider so a provider's booked sessions are queried once.
  const byProvider = new Map<string, WindowTemplate[]>()
  for (const t of templates) {
    const arr = byProvider.get(t.providerId)
    if (arr) arr.push(t)
    else byProvider.set(t.providerId, [t])
  }

  const coaches: unknown[] = []
  for (const [providerId, providerTemplates] of byProvider) {
    // Busy = this provider's non-cancelled sessions overlapping the range.
    const busySnap = await db
      .collection('sessions')
      .where('teamId', '==', data.teamId)
      .where('providerId', '==', providerId)
      .where('start', '>=', Timestamp.fromMillis(nowMs - MAX_SESSION_MS))
      .where('start', '<=', Timestamp.fromMillis(toMs))
      .get()
    const busy: BusyInterval[] = busySnap.docs
      .map((d) => d.data())
      .filter((s) => s.status !== 'cancelled')
      .map((s) => ({ start: (s.start as Timestamp).toMillis(), end: (s.end as Timestamp).toMillis() }))

    for (const tpl of providerTemplates) {
      const durations = (tpl.durationsMinutes ?? []).filter((x) => x > 0)
      if (!tpl.window || durations.length === 0) continue
      const gran = (tpl.granularityMinutes || 15) * 60_000
      const bufferMs = (tpl.bufferMinutes || 0) * 60_000
      const [wsH, wsM] = parseHHMM(tpl.window.start)
      const [weH, weM] = parseHHMM(tpl.window.end)
      const daysOfWeek = tpl.recurrence?.daysOfWeek ?? []
      const startDate = tpl.recurrence?.startDate ? tpl.recurrence.startDate.toMillis() : 0
      const endDate = tpl.recurrence?.endDate ? tpl.recurrence.endDate.toMillis() : Infinity

      const days: { dayMs: number; slotsByDuration: Record<string, number[]> }[] = []
      const cursor = new Date(nowMs)
      cursor.setUTCHours(0, 0, 0, 0)
      while (cursor.getTime() <= toMs) {
        const { year, month, day, dayOfWeek } = getDatePartsInTz(cursor)
        const dayMidnight = localTimeToUtc(year, month, day, 0, 0).getTime()
        if (
          daysOfWeek.includes(dayOfWeek) &&
          dayMidnight >= startDate - DAY_MS &&
          dayMidnight <= endDate
        ) {
          const winStart = localTimeToUtc(year, month, day, wsH, wsM).getTime()
          const winEnd = localTimeToUtc(year, month, day, weH, weM).getTime()
          const slotsByDuration: Record<string, number[]> = {}
          for (const dur of durations) {
            const durMs = dur * 60_000
            const starts: number[] = []
            for (let s = winStart; s + durMs <= winEnd; s += gran) {
              if (s <= nowMs) continue
              if (!conflicts(s, durMs, busy, bufferMs)) starts.push(s)
            }
            if (starts.length) slotsByDuration[String(dur)] = starts
          }
          if (Object.keys(slotsByDuration).length) days.push({ dayMs: dayMidnight, slotsByDuration })
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }

      if (days.length) {
        coaches.push({
          providerId,
          providerName: tpl.providerName,
          templateId: tpl.id,
          title: tpl.title,
          location: tpl.location ?? null,
          onlineUrl: tpl.onlineUrl ?? null,
          isFreeTrial: tpl.isFreeTrial !== false,
          durations,
          days,
        })
      }
    }
  }

  return { coaches }
})

// ─── appointment booking emails (shared confirmation + .ics + coach notify) ────

async function sendAppointmentBookingEmails(p: {
  teamId: string
  teamName: string
  lang: Lang
  activityName: string
  providerId: string | null
  providerName: string
  start: Date
  end: Date
  location: string | null
  onlineUrl: string | null
  cancelUrl: string | null
  bookingId: string
  client: { firstname: string; lastname: string; email: string; phone: string | null }
}): Promise<void> {
  let coachEmail: string | null = null
  let coachFirstname = 'Coach'
  if (p.providerId) {
    const [, coachDoc] = await to(admin.firestore().collection('users').doc(p.providerId).get())
    if (coachDoc?.exists) {
      coachEmail = coachDoc.get('email') || null
      coachFirstname = coachDoc.get('firstname') || 'Coach'
    }
  }

  const confirmationEnabled = await systemEmailEnabledFor(p.teamId, 'booking_confirmation')
  if (confirmationEnabled) {
    try {
      const email = buildAppointmentConfirmationEmail({
        firstname: p.client.firstname,
        teamName: p.teamName,
        slotTitle: p.activityName,
        providerName: p.providerName,
        start: p.start,
        end: p.end,
        location: p.location,
        onlineUrl: p.onlineUrl,
        cancelUrl: p.cancelUrl,
        instructions: null,
        lang: p.lang,
      })
      const ical = buildAppointmentICalAttachment({
        bookingId: p.bookingId,
        slotTitle: p.activityName,
        start: p.start,
        end: p.end,
        location: p.location,
        providerName: p.providerName,
        coachEmail: coachEmail || 'noreply@linyup.com',
        clientName: `${p.client.firstname} ${p.client.lastname}`,
        clientEmail: p.client.email,
      })
      const subjects: Record<Lang, string> = {
        en: `Appointment Confirmed – ${p.activityName}`,
        de: `Termin bestätigt – ${p.activityName}`,
        fr: `Rendez-vous confirmé – ${p.activityName}`,
        it: `Appuntamento confermato – ${p.activityName}`,
      }
      await sendEmail({
        to: p.client.email,
        subject: subjects[p.lang],
        html: email.html,
        text: email.text,
        teamId: p.teamId,
        attachments: [
          { filename: ical.filename, content: ical.content, contentType: ical.contentType },
        ],
      })
    } catch (err) {
      console.error('appointment window: confirmation email failed', err)
    }
  }

  if (coachEmail) {
    try {
      const notif = buildAppointmentProviderNotificationEmail({
        coachFirstname,
        clientName: `${p.client.firstname} ${p.client.lastname}`,
        clientEmail: p.client.email,
        clientPhone: p.client.phone,
        slotTitle: p.activityName,
        start: p.start,
        end: p.end,
        notes: null,
        lang: p.lang,
      })
      const subjects: Record<Lang, string> = {
        en: `New appointment: ${p.client.firstname} ${p.client.lastname}`,
        de: `Neuer Termin: ${p.client.firstname} ${p.client.lastname}`,
        fr: `Nouveau rendez-vous : ${p.client.firstname} ${p.client.lastname}`,
        it: `Nuovo appuntamento: ${p.client.firstname} ${p.client.lastname}`,
      }
      await sendEmail({
        to: coachEmail,
        subject: subjects[p.lang],
        html: notif.html,
        text: notif.text,
        teamId: p.teamId,
      })
    } catch (err) {
      console.error('appointment window: coach notification failed', err)
    }
  }
}

// ─── bookAppointment (public) ───────────────────────────────────────────────────

export const bookAppointment = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    templateId?: string
    providerId?: string
    startMs?: number
    durationMinutes?: number
    contactDetails?: { firstname: string; lastname: string; email: string; phone?: string }
    authenticatedContactId?: string
    verificationCodeId?: string
  }
  if (
    !data?.teamId ||
    !data?.templateId ||
    typeof data.startMs !== 'number' ||
    typeof data.durationMinutes !== 'number'
  ) {
    throw new HttpsError('invalid-argument', 'teamId, templateId, startMs and durationMinutes are required')
  }

  const db = admin.firestore()
  const start = new Date(data.startMs)
  if (start.getTime() <= Date.now()) {
    throw new HttpsError('failed-precondition', 'Cannot book a time in the past')
  }
  const durationMinutes = data.durationMinutes
  const end = new Date(start.getTime() + durationMinutes * 60_000)

  // ── Load + validate the window template ──
  const tplDoc = await db.collection(AVAILABILITY_COLLECTION).doc(data.templateId).get()
  if (!tplDoc.exists) throw new HttpsError('not-found', 'Availability not found')
  const tpl = tplDoc.data() as WindowTemplate
  if (tpl.teamId !== data.teamId) throw new HttpsError('permission-denied', 'Team mismatch')
  if (tpl.status !== 'active' || tpl.mode !== 'open_window' || !tpl.window)
    throw new HttpsError('failed-precondition', 'This availability is not open for booking')
  const providerId = tpl.providerId
  if (data.providerId && data.providerId !== providerId)
    throw new HttpsError('invalid-argument', 'Coach mismatch')

  // Validate the chosen start against the advertised window.
  const { year, month, day, dayOfWeek } = getDatePartsInTz(start)
  if (!(tpl.recurrence?.daysOfWeek ?? []).includes(dayOfWeek))
    throw new HttpsError('failed-precondition', 'Not an available day')
  const [wsH, wsM] = parseHHMM(tpl.window.start)
  const [weH, weM] = parseHHMM(tpl.window.end)
  const winStart = localTimeToUtc(year, month, day, wsH, wsM).getTime()
  const winEnd = localTimeToUtc(year, month, day, weH, weM).getTime()
  const gran = (tpl.granularityMinutes || 15) * 60_000
  if (start.getTime() < winStart || end.getTime() > winEnd)
    throw new HttpsError('failed-precondition', 'Chosen time is outside the availability window')
  if ((start.getTime() - winStart) % gran !== 0)
    throw new HttpsError('failed-precondition', 'Chosen time is not on the booking grid')
  if (!(tpl.durationsMinutes ?? []).includes(durationMinutes))
    throw new HttpsError('failed-precondition', 'Duration is not offered')
  const sd = tpl.recurrence?.startDate ? tpl.recurrence.startDate.toMillis() : 0
  const ed = tpl.recurrence?.endDate ? tpl.recurrence.endDate.toMillis() : Infinity
  if (start.getTime() < sd || start.getTime() > ed + DAY_MS)
    throw new HttpsError('failed-precondition', 'This availability is not active for that date')

  const isFreeTrial = tpl.isFreeTrial !== false
  const authenticated = !!data.authenticatedContactId
  if (!isFreeTrial && !authenticated)
    throw new HttpsError('permission-denied', 'This time is for registered members only.')

  // ── Team + resolve/create the contact ──
  const team = await getTeam(data.teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')
  const teamName = (team as { name?: string }).name || 'Our Team'
  const teamSlug = (team as { slug?: string }).slug || null
  const plan = ((team as { plan?: SaasPlan }).plan || 'free') as SaasPlan
  const lang = asLang((team as { language?: string }).language)

  let contactId: string
  let isNewContact = false
  let sanitized: { firstname: string; lastname: string; email: string; phone: string | null }

  if (authenticated) {
    if (data.verificationCodeId) {
      const codeDoc = await db
        .collection('booking_verification_codes')
        .doc(data.verificationCodeId)
        .get()
      if (!codeDoc.exists) throw new HttpsError('invalid-argument', 'Invalid verification code')
      const cd = codeDoc.data()!
      if (!cd.verified) throw new HttpsError('failed-precondition', 'Verification code not verified')
      if (cd.team_id !== data.teamId) throw new HttpsError('permission-denied', 'Code team mismatch')
      if (!(cd.matched_contact_ids || []).includes(data.authenticatedContactId))
        throw new HttpsError('permission-denied', 'Contact not in verified matches')
      await codeDoc.ref.update({
        used: true,
        used_at: FieldValue.serverTimestamp(),
        used_contact_id: data.authenticatedContactId,
      })
    }
    const cDoc = await db.collection('contacts').doc(data.authenticatedContactId as string).get()
    if (!cDoc.exists) throw new HttpsError('not-found', 'Contact not found')
    const c = cDoc.data()!
    if (c.teamId !== data.teamId) throw new HttpsError('permission-denied', 'Contact team mismatch')
    contactId = data.authenticatedContactId as string
    sanitized = {
      firstname: c.firstname || '',
      lastname: c.lastname || '',
      email: (c.email || '').toLowerCase().trim(),
      phone: c.phone || null,
    }
  } else {
    const cd = data.contactDetails
    if (!cd?.firstname || !cd?.lastname || !cd?.email)
      throw new HttpsError('invalid-argument', 'firstname, lastname and email are required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cd.email))
      throw new HttpsError('invalid-argument', 'Invalid email format')
    sanitized = {
      firstname: cd.firstname.trim(),
      lastname: cd.lastname.trim(),
      email: cd.email.toLowerCase().trim(),
      phone: cd.phone?.trim() || null,
    }
    const match = await resolveSingleContact(data.teamId, sanitized.email)
    if (match.contactId) {
      contactId = match.contactId
    } else {
      if (!(await canCreateContact(data.teamId, plan)))
        throw new HttpsError('resource-exhausted', 'Contact limit reached — please contact the studio.')
      isNewContact = true
      const ref = db.collection('contacts').doc()
      await ref.set({
        firstname: sanitized.firstname,
        lastname: sanitized.lastname,
        email: sanitized.email,
        phone: sanitized.phone,
        acquisition_stage: 'trial_booked',
        acquisition_stage_updated_at: FieldValue.serverTimestamp(),
        entry: 'booking',
        provisional: true,
        teamId: data.teamId,
        archived_at: null,
        deleted_at: null,
        created_at: FieldValue.serverTimestamp(),
        pending_bookings_count: 1,
      })
      contactId = ref.id
    }
  }

  // ── Overlap-safe create (transaction) ──
  // Deterministic id makes same-start double-books collide on one doc; the range
  // query inside the tx catches overlapping different starts. A previously
  // cancelled session at the same id is reusable (its time is free again).
  const bufferMs = (tpl.bufferMinutes || 0) * 60_000
  const sessionRef = db.collection('sessions').doc(`apt_${providerId}_${start.getTime()}`)
  const bookingToken = generateSecureToken()

  const sessionDoc = {
    teamId: data.teamId,
    templateId: data.templateId,
    origin: 'window',
    activityType: 'appointment',
    activityName: tpl.title,
    providerId,
    providerName: tpl.providerName,
    isFreeTrial,
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
    duration_minutes: durationMinutes,
    max_participants: 1,
    bookings_count: 1,
    location: tpl.location ?? null,
    onlineUrl: tpl.onlineUrl ?? null,
    allowBooking: true,
    status: 'full',
    has_bookings: true,
    bio_link_bookings_count: 1,
    last_booking_at: FieldValue.serverTimestamp(),
    created_at: FieldValue.serverTimestamp(),
  }
  const bookingDoc = {
    firstname: sanitized.firstname,
    lastname: sanitized.lastname,
    email: sanitized.email,
    phone: sanitized.phone,
    contact: contactId,
    session: sessionRef.id,
    teamId: data.teamId,
    joinedAt: FieldValue.serverTimestamp(),
    fromBioLink: true,
    is_new_contact: isNewContact,
    booking_token: bookingToken,
    authenticated_booking: authenticated,
    status: 'confirmed',
    fullname: `${sanitized.firstname} ${sanitized.lastname}`,
  }

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(sessionRef)
    if (existing.exists && existing.data()!.status !== 'cancelled') {
      throw new HttpsError('failed-precondition', 'This time was just taken. Please pick another.')
    }
    const overlapQ = db
      .collection('sessions')
      .where('teamId', '==', data.teamId)
      .where('providerId', '==', providerId)
      .where('start', '>=', Timestamp.fromMillis(start.getTime() - MAX_SESSION_MS))
      .where('start', '<=', Timestamp.fromMillis(end.getTime() + bufferMs))
    const overlapSnap = await tx.get(overlapQ)
    for (const d of overlapSnap.docs) {
      if (d.id === sessionRef.id) continue
      const s = d.data()
      if (s.status === 'cancelled') continue
      const bStart = (s.start as Timestamp).toMillis()
      const bEnd = (s.end as Timestamp).toMillis()
      if (start.getTime() < bEnd + bufferMs && end.getTime() > bStart - bufferMs) {
        throw new HttpsError('failed-precondition', 'This time overlaps another appointment.')
      }
    }
    tx.set(sessionRef, sessionDoc)
    tx.set(sessionRef.collection('bookings').doc(contactId), bookingDoc)
  })

  if (!isNewContact) {
    await to(
      db
        .collection('contacts')
        .doc(contactId)
        .update({ pending_bookings_count: FieldValue.increment(1) })
    )
  }

  // ── Emails (confirmation + .ics + coach notification) ──
  const cancelUrl = teamSlug
    ? `${getHostingUrl()}/public/${teamSlug}/appointments/cancel?token=${bookingToken}`
    : null
  await sendAppointmentBookingEmails({
    teamId: data.teamId,
    teamName,
    lang,
    activityName: tpl.title,
    providerId,
    providerName: tpl.providerName,
    start,
    end,
    location: tpl.location ?? null,
    onlineUrl: tpl.onlineUrl ?? null,
    cancelUrl,
    bookingId: `${sessionRef.id}-${contactId}`,
    client: sanitized,
  })

  return { success: true }
})
