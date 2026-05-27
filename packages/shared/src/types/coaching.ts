import type { Timestamp } from './common'

export interface CoachAvailabilityRecurrence {
  daysOfWeek: number[]  // 0 = Sun … 6 = Sat
  time: string          // 'HH:MM' in Europe/Zurich timezone
  startDate: Timestamp
  endDate?: Timestamp | null
}

export interface CoachAvailability {
  teamId: string
  coachId: string
  coachName: string
  title: string
  description?: string
  isFreeTrial?: boolean
  duration_minutes: number
  max_participants: number
  location?: string
  onlineUrl?: string
  recurrence: CoachAvailabilityRecurrence
  status: 'active' | 'paused' | 'archived'
  created_at?: Timestamp
  updated_at?: Timestamp
  createdBy: string
}

export interface CoachSlot {
  teamId: string
  templateId: string
  coachId: string
  coachName: string
  title: string
  description?: string
  isFreeTrial?: boolean
  start: Timestamp
  end: Timestamp
  duration_minutes: number
  max_participants: number
  bookings_count: number
  location?: string
  onlineUrl?: string
  status: 'open' | 'full' | 'cancelled'
  created_at?: Timestamp
  cancelled_at?: Timestamp | null
}

export interface CoachBooking {
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
