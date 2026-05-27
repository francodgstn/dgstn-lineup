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

// CoachSlot has been merged into Session (packages/shared/src/types/session.ts).
// Use Session with activityType === 'coaching' for coaching slots going forward.

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
