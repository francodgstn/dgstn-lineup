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
  // ── Appointment-specific fields (only populated when activityType === 'appointment') ──
  /** Back-link to the availability template this appointment was booked from. */
  templateId?: string
  /** Hard booking cap for appointment sessions. */
  max_participants?: number
  /** Active booking count — maintained by trigger or set at migration time. */
  bookings_count?: number
  /** Subset of bookings_count where is_new_contact === true. */
  trial_bookings_count?: number
  /** Free trial flag — if false, members only (type !== 'trial'). */
  isFreeTrial?: boolean
  /** Booking status for appointment sessions; 'open' | 'full' | 'cancelled'. */
  status?: 'open' | 'full' | 'cancelled'
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
