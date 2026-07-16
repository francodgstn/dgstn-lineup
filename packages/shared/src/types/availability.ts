import type { Timestamp } from './common'

export interface AvailabilityRecurrence {
  daysOfWeek: number[]  // 0 = Sun … 6 = Sat
  time: string          // 'HH:MM' in Europe/Zurich — the slot time (fixed_slots)
  startDate: Timestamp
  endDate?: Timestamp | null
}

/** How a provider advertises availability:
 *  - 'fixed_slots' (default): exact recurring times → pre-generated Session slots.
 *  - 'open_window': a daily time range the client self-books within (Calendly-style);
 *    NO slots are pre-generated — a Session is created lazily at booking time. */
export type AvailabilityMode = 'fixed_slots' | 'open_window'

/** Daily bookable time range (open_window mode), Europe/Zurich, 'HH:MM'. */
export interface AvailabilityWindow {
  start: string
  end: string
}

export interface Availability {
  teamId: string
  /** UID of the provider whose time this availability publishes. */
  providerId: string
  /** Denormalised provider display name. */
  providerName: string
  title: string
  description?: string
  isFreeTrial?: boolean
  /** fixed_slots: the slot length. open_window: the default/first offered duration. */
  duration_minutes: number
  max_participants: number
  location?: string
  onlineUrl?: string
  recurrence: AvailabilityRecurrence
  status: 'active' | 'paused' | 'archived'
  /** Defaults to 'fixed_slots' when unset (existing templates). */
  mode?: AvailabilityMode
  // ── open_window fields (mode === 'open_window'); recurrence.daysOfWeek +
  // startDate/endDate still say WHICH days and for how long the window is live. ──
  /** The daily bookable range clients pick a start within. */
  window?: AvailabilityWindow
  /** Session lengths the client may choose (minutes), e.g. [30, 60, 90]. */
  durationsMinutes?: number[]
  /** Step between selectable start times (minutes), provider-set. */
  granularityMinutes?: number
  /** Gap enforced before/after each appointment (minutes). Default 0. */
  bufferMinutes?: number
  created_at?: Timestamp
  updated_at?: Timestamp
  createdBy: string
}

// CoachSlot has been merged into Session (packages/shared/src/types/session.ts).
// Use Session with activityType === 'appointment' for appointment sessions.

export interface AppointmentBooking {
  slotId: string
  teamId: string
  firstname: string
  lastname: string
  fullname: string
  email: string
  phone?: string | null
  cancel_token: string
  status: 'confirmed' | 'cancelled'
  booked_at?: Timestamp
  cancelled_at?: Timestamp | null
  notes?: string
}
