import type { Timestamp } from './common'

/** Has a paid-booking hold lapsed? A 'pending_payment' session whose
 *  `hold_expires_at` has passed no longer blocks its slot — readers treat it as
 *  free (lazy expiry) until the daily sweep flips it to 'cancelled'. */
export function isExpiredAppointmentHold(
  s: { status?: string; hold_expires_at?: { toMillis(): number } | null },
  nowMs = Date.now()
): boolean {
  return s.status === 'pending_payment' && !!s.hold_expires_at && s.hold_expires_at.toMillis() <= nowMs
}

/** THE slot-blocking predicate for appointment scheduling — the single source of
 *  truth for "does this session make the provider busy?". Used by
 *  listAvailability's busy filter, both branches of the booking transaction
 *  (deterministic-id reuse + overlap range loop), and the admin calendar. */
export function appointmentSlotBlocked(
  s: { status?: string; hold_expires_at?: { toMillis(): number } | null },
  nowMs = Date.now()
): boolean {
  return s.status !== 'cancelled' && !isExpiredAppointmentHold(s, nowMs)
}

/** Has the online booking cutoff passed for this session? `cutoffMinutes` is
 *  how long before start online booking closes (0/absent = no cutoff — bookable
 *  right up to start). Shared by the client (hide/disable slots) and the
 *  booking callables (authoritative refusal) so they never disagree. */
export function isPastBookingCutoff(
  sessionStart: { toMillis(): number },
  cutoffMinutes: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!cutoffMinutes || cutoffMinutes <= 0) return false
  return nowMs >= sessionStart.toMillis() - cutoffMinutes * 60_000
}

export interface Session {
  id: string
  teamId: string
  activityId?: string
  activityName?: string
  /** Denormalised from the linked Activity.type — 'class' | 'appointment'. Default class. */
  activityType?: string
  start: Timestamp
  end: Timestamp
  duration_minutes?: number
  location?: string
  // Optional link to a Place + Room (team or org place). `location` is kept as a
  // free-text fallback (online/ad-hoc) and for display.
  placeId?: string
  roomId?: string
  onlineUrl?: string
  tags?: string[]
  participants_count?: number
  allowBooking?: boolean
  notes?: string
  created_at?: Timestamp
  createdBy?: string
  // ── Recurring session fields ──
  seriesId?: string
  isException?: boolean
  exceptionType?: 'modified' | 'cancelled' | null
  /** UID of the person who runs this session — class instructor or appointment
   *  provider (picked from the team's coach roster). Replaces the former
   *  instructorId/coachId split. */
  providerId?: string
  /** Denormalised display name of the provider. */
  providerName?: string
  /** When booking is allowed, mark it as required (no drop-ins) — surfaces a
   *  "Booking required" chip in the public booking flow. Class-only in UI. */
  bookingMandatory?: boolean
  /** A note pinned to this specific occurrence ("Marta subbing today", "outdoor
   *  — bring a jacket"). Internal by default; set `headlinePublic` to also show
   *  it on the public slot list, the confirmation email, and the reminder.
   *  Distinct from `notes`, which is always internal-only. */
  headline?: string
  /** When true, `headline` is mirrored onto the session's public_profile and
   *  surfaced to bookers. Absent/false ⇒ staff-only, same as `notes`. */
  headlinePublic?: boolean
  // ── Booking state — BOTH kinds. Not implied by activityType. ──
  /** Hard booking cap (seats for a class, 1 for a typical 1:1 appointment). */
  max_participants?: number
  /** Bookings currently HOLDING CAPACITY — i.e. every booking whose status is
   *  neither 'cancelled' nor 'no_show' (an absent status = pending = holds a
   *  seat). One counter for classes and appointments alike; `trackBookings` is
   *  the authoritative recount and self-heals races.
   *  History: classes used to count into a separate `bio_link_bookings_count`
   *  while appointments used this one — merged 2026-07. */
  bookings_count?: number
  /** Capacity state, derived from bookings_count vs max_participants (plus
   *  explicit cancellation). Treat an ABSENT value as 'open' — a session that
   *  nobody has booked yet may not carry one.
   *  'pending_payment' (appointments only) = a paid-booking HOLD: the slot is
   *  reserved while the client completes Stripe checkout. Blocks the slot while
   *  live, is logically free once `hold_expires_at` passes (lazy expiry — see
   *  appointmentSlotBlocked), is never published publicly, and is skipped by the
   *  trackBookings recount (the checkout/webhook/sweeper own its lifecycle). */
  status?: 'open' | 'full' | 'cancelled' | 'pending_payment'
  /** When a 'pending_payment' hold stops blocking the slot (created +30 min).
   *  Deleted when the webhook confirms payment. */
  hold_expires_at?: Timestamp | null
  /** Denormalised from Activity.autoConfirm. When true a booking is written
   *  `status: 'confirmed'` immediately (the client's slot is theirs); when false
   *  it stays unconfirmed until the studio confirms/checks them in. Defaults by
   *  kind (appointments true, classes false) but is a FIELD, not a type rule —
   *  a class may auto-confirm and an appointment may require approval. */
  autoConfirm?: boolean
  // ── Appointment-specific fields (only populated when activityType === 'appointment') ──
  /** Back-link to the availability doc this appointment was booked from. */
  templateId?: string
  /** Subset of bookings_count where is_new_contact === true. */
  trial_bookings_count?: number
  /** Legacy free-trial flag. Superseded by the activity's `accessRule`. */
  isFreeTrial?: boolean
  // ── Staff "phone booking" fields (appointments/staffBooking.ts) — a manager
  // creates the appointment directly, settled offline or via a Stripe Connect
  // payment link, distinct from the public checkout's own 'pending_payment'
  // hold (which carries `hold_expires_at` instead). ──
  /** True while a manager-created hold (offline or payment-link) awaits
   *  payment. Deleted once markAppointmentPaid / the Connect webhook confirms. */
  payment_pending?: boolean
  /** How a `payment_pending` hold will be settled: 'offline' (cash/bank
   *  transfer, confirmed via markAppointmentPaid) or 'link' (Stripe Connect
   *  checkout link emailed to the client, confirmed by the Connect webhook). */
  payment_intent_mode?: 'offline' | 'link'
  /** The amount owed for a `payment_pending` hold, in MINOR units (Rappen/cents). */
  payment_amount?: number
  payment_currency?: string
  /** True for a manager's calendar block (no client) — see appointments/staffBooking.ts. */
  blocked_time?: boolean
  /** Denormalised booking contact so list views (e.g. the Payments page) can
   *  render a client name/link without an N+1 read into the bookings
   *  subcollection. Null for a `blocked_time` session. */
  contact_id?: string | null
  /** Denormalised "firstname lastname" (or the block's note) for display —
   *  same rationale as `contact_id`. */
  client_name?: string | null
}

export interface SessionPublicProfile {
  teamId: string
  activityId?: string
  activityName?: string
  activityType?: string
  start: Timestamp
  end: Timestamp
  allowBooking: boolean
  /** Booking is required for this session (no drop-ins) — drives the public chip. */
  bookingMandatory?: boolean
  /** Mirrored from `Session.headline` ONLY when `headlinePublic === true`. */
  headline?: string
  location?: string
  onlineUrl?: string
  /** UID + display name of the provider (class instructor or appointment provider). */
  providerId?: string
  providerName?: string
  locationAddress?: string
  locationMapsUrl?: string
  activitySlug?: string
  activityColor?: string
  activityImage?: string | null
  activityLevel?: string
  activityIsFreeTrial?: boolean
  // Appointment-specific public fields
  max_participants?: number
  bookings_count?: number
  isFreeTrial?: boolean
  templateId?: string
  status?: 'open' | 'full' | 'cancelled'
}

export interface Participant {
  contactId: string
  teamId: string
  checked_in_at: Timestamp
  checked_in_by?: string
}

/** Where a booking came from — the attribution axis.
 *  - 'online' → the visitor booked themselves on a public surface (booking
 *    page, appointment picker, Space). The default.
 *  - 'kiosk'  → taken at the door on the studio's own tablet (walk-in).
 *  - 'staff'  → entered by a team member on the client's behalf.
 *  Absent ⇒ treat as 'online' (bookings written before this field existed came
 *  from the public flow, which was the only writer). */
export type BookingSource = 'online' | 'kiosk' | 'staff'

export const BOOKING_SOURCES: readonly BookingSource[] = ['online', 'kiosk', 'staff']

/** Narrow an untrusted value to a BookingSource, else null. Used by the
 *  callables to validate client-supplied attribution. */
export function parseBookingSource(v: unknown): BookingSource | null {
  return typeof v === 'string' && (BOOKING_SOURCES as readonly string[]).includes(v)
    ? (v as BookingSource)
    : null
}

export interface Booking {
  id: string
  teamId: string
  contact: string
  session?: string
  email: string
  firstname: string
  lastname: string
  phone?: string
  is_new_contact: boolean
  joinedAt: Timestamp
  booking_token?: string
  /** Short human-readable code (e.g. "BK-7F3K9Q") for phone/desk lookups — never
   *  the auth mechanism (booking_token is). Not guaranteed collision-free. */
  booking_reference?: string
  /** Attribution — see `BookingSource`. Absent ⇒ 'online'. */
  source?: BookingSource
  /** Answers to the activity's `bookingQuestions`, keyed by FormField.id.
   *  Stored verbatim as given; the questions themselves live on the activity,
   *  so a label edit doesn't rewrite history — an answer whose field id no
   *  longer exists is simply not rendered. */
  question_answers?: Record<string, unknown>
  status?: 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'rebooked'
  rebooked_from?: string
  rebooked_to?: string
  // Drop-in payment (pay-per-class). A pending booking awaiting payment carries
  // payment_status 'required' + an expires_at hold; the Connect webhook flips it to
  // 'paid' + status 'confirmed'. Free bookings leave these unset.
  payment_status?: 'not_required' | 'required' | 'paid'
  payment_intent_id?: string
  expires_at?: Timestamp
}

export interface SessionSeries {
  id: string
  teamId: string
  activityId?: string
  recurrence: RecurrencePattern
  created_at: Timestamp
  createdBy: string
}

export interface RecurrencePattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  daysOfWeek?: number[]
  dayOfMonth?: number
  monthOfYear?: number
  duration: number
  startDate: Timestamp
  endCondition: 'date' | 'count' | 'never'
  endDate?: Timestamp
  maxOccurrences?: number
}
