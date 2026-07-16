/* eslint-disable no-console */
// Appointments are ACTIVITY-BOUND and AVAILABILITY-ONLY. A coach publishes an
// `Availability` (the *when* — a daily range or explicit times, Calendly-style)
// linked to one or more `type: 'appointment'` Activities (the *what* — name,
// duration(s), capacity, access rule). Nothing is ever pre-generated: a start
// time is indeterminate until the client picks an activity, so free time is
// computed on the fly here, and a Session is created lazily, overlap-safe, at
// booking time.
//
//  • listAvailability — public: free start times per coach/activity/day/duration.
//  • bookAppointment  — public: resolves the covering availability server-side,
//    runs the shared paid-access gate, then overlap-checked create-session + book.
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
import { resolveBookingAccessGate } from '../booking/access'
import {
  AVAILABILITY_COLLECTION,
  ACTIVITIES_COLLECTION,
  CONTACT_CREDIT_GRANTS_SUBCOLLECTION,
  resolveActivityAccessRule,
  type Activity,
  type ActivityAccessRule,
  type Availability,
  type SaasPlan,
} from '@linyup/shared'
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

// A provider's published free time — the *when*. `id` is the Firestore doc id.
interface WindowTemplate extends Availability {
  id: string
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

// Loaded/derived shape of a `type: 'appointment'` activity — the *what*.
interface ActivityInfo {
  id: string
  name: string
  durationsMinutes: number[]
  accessRule: ActivityAccessRule
}

function toActivityInfo(id: string, a: Activity): ActivityInfo | null {
  const durationsMinutes = (a.durationsMinutes && a.durationsMinutes.length ? a.durationsMinutes : [60]).filter(
    (x) => x > 0
  )
  if (!durationsMinutes.length) return null
  return {
    id,
    name: a.name || 'Appointment',
    durationsMinutes,
    accessRule: resolveActivityAccessRule({ accessRule: a.accessRule, isFreeTrial: a.isFreeTrial }),
  }
}

// Enumerate candidate starts for (template, activity durations) across
// [nowMs, toMs], merging into a per-day, per-duration accumulator so several
// availabilities offering the SAME activity combine into one listing.
function accumulateCandidates(
  tpl: WindowTemplate,
  durations: number[],
  busy: BusyInterval[],
  nowMs: number,
  toMs: number,
  daysMap: Map<number, Record<string, Set<number>>>
): void {
  const bufferMs = (tpl.bufferMinutes || 0) * 60_000
  const daysOfWeek = tpl.recurrence?.daysOfWeek ?? []
  const startDate = tpl.recurrence?.startDate ? tpl.recurrence.startDate.toMillis() : 0
  const endDate = tpl.recurrence?.endDate ? tpl.recurrence.endDate.toMillis() : Infinity

  let gran = 0
  let winStartHM: [number, number] | null = null
  let winEndHM: [number, number] | null = null
  if (tpl.mode === 'range') {
    if (!tpl.window) return
    winStartHM = parseHHMM(tpl.window.start)
    winEndHM = parseHHMM(tpl.window.end)
    gran = (tpl.granularityMinutes || 15) * 60_000
  }

  const cursor = new Date(nowMs)
  cursor.setUTCHours(0, 0, 0, 0)
  while (cursor.getTime() <= toMs) {
    const { year, month, day, dayOfWeek } = getDatePartsInTz(cursor)
    const dayMidnight = localTimeToUtc(year, month, day, 0, 0).getTime()
    if (daysOfWeek.includes(dayOfWeek) && dayMidnight >= startDate - DAY_MS && dayMidnight <= endDate) {
      for (const dur of durations) {
        const durMs = dur * 60_000
        const starts: number[] = []
        if (tpl.mode === 'times') {
          for (const hhmm of tpl.times ?? []) {
            const [h, m] = parseHHMM(hhmm)
            const s = localTimeToUtc(year, month, day, h, m).getTime()
            if (s <= nowMs) continue
            // 'times' mode: no window bound — just don't spill past end of day.
            if (s + durMs > dayMidnight + DAY_MS) continue
            if (conflicts(s, durMs, busy, bufferMs)) continue
            starts.push(s)
          }
        } else if (winStartHM && winEndHM) {
          const winStart = localTimeToUtc(year, month, day, winStartHM[0], winStartHM[1]).getTime()
          const winEnd = localTimeToUtc(year, month, day, winEndHM[0], winEndHM[1]).getTime()
          for (let s = winStart; s + durMs <= winEnd; s += gran) {
            if (s <= nowMs) continue
            if (conflicts(s, durMs, busy, bufferMs)) continue
            starts.push(s)
          }
        }
        if (starts.length) {
          let byDur = daysMap.get(dayMidnight)
          if (!byDur) {
            byDur = {}
            daysMap.set(dayMidnight, byDur)
          }
          const set = byDur[String(dur)] ?? (byDur[String(dur)] = new Set<number>())
          for (const s of starts) set.add(s)
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

// ─── listAvailability (public) ─────────────────────────────────────────────────

export const listAvailability = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    providerId?: string
    activityId?: string
    days?: number
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  const rangeDays = Math.min(Math.max(Math.floor(data.days ?? DEFAULT_RANGE_DAYS), 1), MAX_RANGE_DAYS)
  const db = admin.firestore()
  const nowMs = Date.now()
  const toMs = nowMs + rangeDays * DAY_MS

  // Both 'range' and 'times' modes are live — no mode filter here any more.
  const snap = await db
    .collection(AVAILABILITY_COLLECTION)
    .where('teamId', '==', data.teamId)
    .where('status', '==', 'active')
    .get()
  let templates: WindowTemplate[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Availability) }))
  if (data.providerId) templates = templates.filter((t) => t.providerId === data.providerId)
  if (templates.length === 0) return { coaches: [] }

  // Batch-load the union of referenced activities; keep only bookable appointment offerings.
  const activityIds = new Set<string>()
  for (const t of templates) for (const id of t.activityIds ?? []) activityIds.add(id)
  const activityDocs = await Promise.all(
    [...activityIds].map((id) => db.collection(ACTIVITIES_COLLECTION).doc(id).get())
  )
  const activityMap = new Map<string, ActivityInfo>()
  for (const doc of activityDocs) {
    if (!doc.exists) continue
    const a = doc.data() as Activity
    if (a.type !== 'appointment' || a.teamId !== data.teamId) continue
    if (data.activityId && doc.id !== data.activityId) continue
    const info = toActivityInfo(doc.id, a)
    if (info) activityMap.set(doc.id, info)
  }
  if (activityMap.size === 0) return { coaches: [] }

  // Group templates by provider so a provider's busy sessions are queried once.
  const byProvider = new Map<string, WindowTemplate[]>()
  for (const t of templates) {
    const offersBookable = (t.activityIds ?? []).some((id) => activityMap.has(id))
    if (!offersBookable) continue
    const arr = byProvider.get(t.providerId)
    if (arr) arr.push(t)
    else byProvider.set(t.providerId, [t])
  }
  if (byProvider.size === 0) return { coaches: [] }

  interface ActivityAccumulator {
    activityId: string
    activityName: string
    durationsMinutes: number[]
    accessRule: ActivityAccessRule
    location: string | null
    onlineUrl: string | null
    daysMap: Map<number, Record<string, Set<number>>>
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

    // GROUP BY (provider, activity) — merge days across a provider's several
    // availabilities that offer the same activity (e.g. "Saturday mornings" AND
    // "Weekday evenings" both offering the same 60' session).
    const activityAcc = new Map<string, ActivityAccumulator>()
    for (const tpl of providerTemplates) {
      const offered = (tpl.activityIds ?? []).filter((id) => activityMap.has(id))
      for (const activityId of offered) {
        const info = activityMap.get(activityId)!
        let acc = activityAcc.get(activityId)
        if (!acc) {
          // Location/onlineUrl: take them from the first contributing availability.
          // Edge case: differing locations across schedules show the first —
          // booking always resolves the real one from the matched availability.
          acc = {
            activityId,
            activityName: info.name,
            durationsMinutes: info.durationsMinutes,
            accessRule: info.accessRule,
            location: tpl.location ?? null,
            onlineUrl: tpl.onlineUrl ?? null,
            daysMap: new Map(),
          }
          activityAcc.set(activityId, acc)
        }
        accumulateCandidates(tpl, info.durationsMinutes, busy, nowMs, toMs, acc.daysMap)
      }
    }

    const activities: unknown[] = []
    for (const acc of activityAcc.values()) {
      const days = [...acc.daysMap.entries()]
        .map(([dayMs, byDur]) => ({
          dayMs,
          slotsByDuration: Object.fromEntries(
            Object.entries(byDur).map(([dur, set]) => [dur, [...set].sort((a, b) => a - b)])
          ),
        }))
        .sort((a, b) => a.dayMs - b.dayMs)
      if (days.length) {
        activities.push({
          activityId: acc.activityId,
          activityName: acc.activityName,
          durationsMinutes: acc.durationsMinutes,
          accessRule: acc.accessRule,
          location: acc.location,
          onlineUrl: acc.onlineUrl,
          days,
        })
      }
    }
    if (activities.length) {
      coaches.push({ providerId, providerName: providerTemplates[0].providerName, activities })
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

// Does availability `tpl` (offering `activityId`, already pre-filtered by the
// caller) cover this exact start for a booking of length `durMs`?
function availabilityCoversStart(tpl: WindowTemplate, startMsVal: number, durMs: number): boolean {
  const { year, month, day, dayOfWeek } = getDatePartsInTz(new Date(startMsVal))
  if (!(tpl.recurrence?.daysOfWeek ?? []).includes(dayOfWeek)) return false
  const sd = tpl.recurrence?.startDate ? tpl.recurrence.startDate.toMillis() : 0
  const ed = tpl.recurrence?.endDate ? tpl.recurrence.endDate.toMillis() : Infinity
  if (startMsVal < sd || startMsVal > ed + DAY_MS) return false

  if (tpl.mode === 'times') {
    return (tpl.times ?? []).some((hhmm) => {
      const [h, m] = parseHHMM(hhmm)
      return localTimeToUtc(year, month, day, h, m).getTime() === startMsVal
    })
  }

  // 'range' mode
  if (!tpl.window) return false
  const [wsH, wsM] = parseHHMM(tpl.window.start)
  const [weH, weM] = parseHHMM(tpl.window.end)
  const winStart = localTimeToUtc(year, month, day, wsH, wsM).getTime()
  const winEnd = localTimeToUtc(year, month, day, weH, weM).getTime()
  const gran = (tpl.granularityMinutes || 15) * 60_000
  if (startMsVal < winStart || startMsVal + durMs > winEnd) return false
  if ((startMsVal - winStart) % gran !== 0) return false
  return true
}

// ─── bookAppointment (public) ───────────────────────────────────────────────────

export const bookAppointment = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    providerId?: string
    activityId?: string
    startMs?: number
    durationMinutes?: number
    contactDetails?: { firstname: string; lastname: string; email: string; phone?: string }
    authenticatedContactId?: string
    verificationCodeId?: string
  }
  if (
    !data?.teamId ||
    !data?.providerId ||
    !data?.activityId ||
    typeof data.startMs !== 'number' ||
    typeof data.durationMinutes !== 'number'
  ) {
    throw new HttpsError(
      'invalid-argument',
      'teamId, providerId, activityId, startMs and durationMinutes are required'
    )
  }

  const db = admin.firestore()
  const start = new Date(data.startMs)
  if (start.getTime() <= Date.now()) {
    throw new HttpsError('failed-precondition', 'Cannot book a time in the past')
  }
  const durationMinutes = data.durationMinutes
  const durationMs = durationMinutes * 60_000
  const end = new Date(start.getTime() + durationMs)

  // ── Load + validate the activity (the *what*: name, duration, capacity, access) ──
  const actDoc = await db.collection(ACTIVITIES_COLLECTION).doc(data.activityId).get()
  if (!actDoc.exists) throw new HttpsError('not-found', 'Activity not found')
  const activity = actDoc.data() as Activity
  if (activity.teamId !== data.teamId) throw new HttpsError('permission-denied', 'Team mismatch')
  if (activity.type !== 'appointment')
    throw new HttpsError('failed-precondition', 'This activity does not support appointment booking')
  const allowedDurations =
    activity.durationsMinutes && activity.durationsMinutes.length ? activity.durationsMinutes : [60]
  if (!allowedDurations.includes(durationMinutes))
    throw new HttpsError('failed-precondition', 'Duration is not offered')

  // ── Resolve the availability (the *when*) that covers this start ──
  const providerId = data.providerId
  const tplSnap = await db
    .collection(AVAILABILITY_COLLECTION)
    .where('teamId', '==', data.teamId)
    .where('providerId', '==', providerId)
    .where('status', '==', 'active')
    .get()
  const templates: WindowTemplate[] = tplSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Availability) }))
  const tpl = templates.find(
    (t) =>
      (t.activityIds ?? []).includes(data.activityId as string) &&
      availabilityCoversStart(t, start.getTime(), durationMs)
  )
  if (!tpl) {
    throw new HttpsError('failed-precondition', 'This time is no longer available. Please pick another.')
  }
  const providerName = tpl.providerName

  // ── Team ──
  const team = await getTeam(data.teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')
  const teamName = (team as { name?: string }).name || 'Our Team'
  const teamSlug = (team as { slug?: string }).slug || null
  const plan = ((team as { plan?: SaasPlan }).plan || 'free') as SaasPlan
  const lang = asLang((team as { language?: string }).language)

  // ── Resolve/validate the caller's contact details ──
  const authenticated = !!data.authenticatedContactId
  let authenticatedContactFull: (admin.firestore.DocumentData & { id: string }) | null = null
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
    authenticatedContactFull = { id: data.authenticatedContactId as string, ...c }
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
  }

  // ── Access gate (paid-access axis) — shared with bookSession, see booking/access.ts.
  // Guests booking a 'members'/'subscription' activity are refused here.
  const accessRule = resolveActivityAccessRule({
    accessRule: activity.accessRule,
    isFreeTrial: activity.isFreeTrial,
  })
  const { matchedSubscriptionTypeId, creditSpendTypeId } = await resolveBookingAccessGate({
    teamId: data.teamId,
    accessRule,
    authenticatedContact: authenticatedContactFull,
    isAppointment: true,
  })

  // ── Resolve/create the contact (only reached unauthenticated for 'open' activities) ──
  let contactId: string
  let isNewContact = false
  if (authenticated) {
    contactId = data.authenticatedContactId as string
  } else {
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
    templateId: tpl.id,
    origin: 'window',
    activityType: 'appointment',
    // The session INHERITS FROM THE ACTIVITY: name/access/capacity come from the
    // offering the client picked, not the schedule — exactly like a class.
    activityId: data.activityId,
    activityName: activity.name,
    accessRule,
    providerId,
    providerName,
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
    duration_minutes: durationMinutes,
    max_participants: activity.max_participants ?? 1,
    bookings_count: 1,
    // Location/onlineUrl come from the matched availability (the *when*).
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
    subscription_type_id: matchedSubscriptionTypeId,
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

    // Credit-pack coverage: spend one credit atomically with the booking write,
    // inside the SAME transaction as the overlap check (all reads before writes).
    // FIFO across the contact's usable grants (soonest expiry first, then oldest).
    let grant: { ref: FirebaseFirestore.DocumentReference; credits_used: number } | null = null
    if (creditSpendTypeId) {
      const grantsQuery = db
        .collection('contacts')
        .doc(contactId)
        .collection(CONTACT_CREDIT_GRANTS_SUBCOLLECTION)
        .where('teamId', '==', data.teamId)
        .where('subscription_type_id', '==', creditSpendTypeId)
      const grantsSnap = await tx.get(grantsQuery)
      const nowMsTx = Date.now()
      const usable = grantsSnap.docs
        .map((d) => {
          const g = d.data()
          return {
            ref: d.ref,
            credits_total: (g.credits_total as number) ?? 0,
            credits_used: (g.credits_used as number) ?? 0,
            expires_at: (g.expires_at as Timestamp | null) ?? null,
            created_at: (g.created_at as Timestamp | null) ?? null,
          }
        })
        .filter(
          (g) => g.credits_used < g.credits_total && (!g.expires_at || g.expires_at.toMillis() > nowMsTx)
        )
        .sort((a, b) => {
          const ax = a.expires_at?.toMillis() ?? Number.MAX_SAFE_INTEGER
          const bx = b.expires_at?.toMillis() ?? Number.MAX_SAFE_INTEGER
          if (ax !== bx) return ax - bx
          return (a.created_at?.toMillis() ?? 0) - (b.created_at?.toMillis() ?? 0)
        })
      const picked = usable[0]
      if (!picked) {
        throw new HttpsError(
          'permission-denied',
          'No lesson credits remaining on your pack. Purchase a new pack to book this class.'
        )
      }
      grant = { ref: picked.ref, credits_used: picked.credits_used }
    }

    if (grant) tx.update(grant.ref, { credits_used: grant.credits_used + 1 })
    tx.set(sessionRef, sessionDoc)
    tx.set(sessionRef.collection('bookings').doc(contactId), {
      ...bookingDoc,
      ...(grant && { credit_grant_id: grant.ref.id, credit_spent: 1 }),
    })
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
    activityName: activity.name,
    providerId,
    providerName,
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
