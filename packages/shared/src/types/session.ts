import type { Timestamp } from './common'

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
   *  nobody has booked yet may not carry one. */
  status?: 'open' | 'full' | 'cancelled'
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
