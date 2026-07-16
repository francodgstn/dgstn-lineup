/**
 * Shared appointment-seeding helpers — the AVAILABILITY-ONLY model.
 *
 * An `availability` doc publishes only the WHEN (a provider's free time). The
 * WHAT — name, duration, capacity, access rule — lives on the linked `appointment`
 * activities (`activityIds`). Crucially, NOTHING is pre-generated: there is no
 * generator cron and no availability trigger, so an appointment `Session` exists
 * only once a client books one. Seeds must therefore never fabricate "open slots";
 * they materialise a handful of ALREADY-BOOKED appointments instead, shaped exactly
 * like the ones the `bookAppointment` callable writes.
 *
 * Path/type constants mirror @linyup/shared (the seed scripts compile under
 * tsconfig.scripts.json, which does not resolve the workspace import — same
 * convention as scripts/lib/storefront.ts).
 */
import * as admin from 'firebase-admin'

const tsOf = (d: Date) => admin.firestore.Timestamp.fromDate(d)

export interface SeedAccessRule {
  type: 'open' | 'members' | 'subscription'
  subscriptionTypeIds?: string[]
}

/**
 * Dates matching `daysOfWeek` (JS getDay(): 0=Sun … 6=Sat) at `time` ('HH:MM',
 * local), walking away from today until `count` are found.
 *
 * `direction: 1` (default) collects UPCOMING dates (strictly in the future),
 * `direction: -1` collects PAST ones (strictly in the past) — history that makes
 * the appointment calendar and the reports look lived-in.
 */
export function appointmentOccurrences(p: {
  daysOfWeek: number[]
  time: string
  count: number
  direction?: 1 | -1
  /** How many days out to start looking (default 0 = today). */
  fromDayOffset?: number
  /** Give up after this many days of walking (default 120). */
  maxDayspan?: number
}): Date[] {
  const [hh, mm] = p.time.split(':').map(Number)
  const direction = p.direction ?? 1
  const maxDayspan = p.maxDayspan ?? 120
  const nowMs = Date.now()
  const out: Date[] = []
  for (let step = p.fromDayOffset ?? 0; out.length < p.count && step <= maxDayspan; step++) {
    const d = new Date()
    d.setDate(d.getDate() + step * direction)
    if (!p.daysOfWeek.includes(d.getDay())) continue
    d.setHours(hh, mm || 0, 0, 0)
    const future = d.getTime() > nowMs
    if (direction === 1 ? future : !future) out.push(d)
  }
  return out
}

export interface SeedAppointmentInput {
  teamId: string
  /** The availability doc this appointment was booked out of. */
  templateId: string
  /** The `type: 'appointment'` activity the client picked — the WHAT. */
  activityId: string
  activityName: string
  /** Inherited from the activity, exactly as bookAppointment does. */
  accessRule: SeedAccessRule
  isFreeTrial: boolean
  maxParticipants: number
  providerId: string
  providerName: string
  start: Date
  durationMinutes: number
  location?: string | null
  onlineUrl?: string | null
  /** Extra fields merged into BOTH docs (e.g. locationAddress, placeId). */
  extra?: Record<string, unknown>
  /** Past appointments: already delivered, so not bookable and attendance-counted. */
  past?: boolean
  createdAt?: Date
}

/**
 * The docs a booked appointment consists of: the session + its public mirror.
 * Mirrors `bookAppointment` (packages/functions/src/appointments/) for the session
 * and `syncSessionPublicProfile` for the mirror, so seeded data is shaped like
 * production data. The booking subcollection doc is built separately (see
 * buildAppointmentBookingDoc) because each seed sources its client differently.
 */
export function buildAppointmentSessionDocs(input: SeedAppointmentInput): {
  id: string
  session: Record<string, unknown>
  publicProfile: Record<string, unknown>
} {
  const end = new Date(input.start.getTime() + input.durationMinutes * 60_000)
  const extra = input.extra ?? {}
  // Deterministic id, exactly as bookAppointment mints it — same-start double
  // books collide on one doc.
  const id = `apt_${input.providerId}_${input.start.getTime()}`

  const session = {
    teamId: input.teamId,
    templateId: input.templateId,
    origin: 'window',
    activityType: 'appointment',
    activityId: input.activityId,
    activityName: input.activityName,
    accessRule: input.accessRule,
    providerId: input.providerId,
    providerName: input.providerName,
    isFreeTrial: input.isFreeTrial,
    start: tsOf(input.start),
    end: tsOf(end),
    duration_minutes: input.durationMinutes,
    max_participants: input.maxParticipants,
    bookings_count: 1,
    location: input.location ?? null,
    onlineUrl: input.onlineUrl ?? null,
    allowBooking: !input.past,
    status: 'full',
    has_bookings: true,
    bio_link_bookings_count: 1,
    ...(input.past ? { participants_count: 1 } : {}),
    last_booking_at: tsOf(input.createdAt ?? input.start),
    created_at: tsOf(input.createdAt ?? input.start),
    ...extra,
  }

  // The live syncSessionPublicProfile mirrors appointment sessions (allowBooking:
  // true) unless cancelled, past ones included; the public timetable shows those
  // muted.
  const publicProfile = {
    type: 'appointment_session',
    teamId: input.teamId,
    activityType: 'appointment',
    activityName: input.activityName,
    providerId: input.providerId,
    providerName: input.providerName,
    templateId: input.templateId,
    start: tsOf(input.start),
    end: tsOf(end),
    duration_minutes: input.durationMinutes,
    location: input.location ?? null,
    onlineUrl: input.onlineUrl ?? null,
    max_participants: input.maxParticipants,
    bookings_count: 1,
    isFreeTrial: input.isFreeTrial,
    accessRule: input.accessRule,
    status: 'full',
    allowBooking: true,
    ...extra,
  }

  return { id, session, publicProfile }
}

/** The `confirmed` booking doc bookAppointment writes at sessions/{id}/bookings/{contactId}. */
export function buildAppointmentBookingDoc(p: {
  teamId: string
  sessionId: string
  contactId: string
  firstname: string
  lastname: string
  email: string
  phone?: string | null
  bookedAt: Date
}): Record<string, unknown> {
  return {
    teamId: p.teamId,
    contactId: p.contactId,
    contact: p.contactId,
    session: p.sessionId,
    firstname: p.firstname,
    lastname: p.lastname,
    fullname: `${p.firstname} ${p.lastname}`,
    email: p.email,
    phone: p.phone ?? null,
    status: 'confirmed',
    joinedAt: tsOf(p.bookedAt),
    fromBioLink: true,
    authenticated_booking: true,
    booking_token: `tok-appointment-${p.sessionId}`,
    is_new_contact: false,
  }
}
