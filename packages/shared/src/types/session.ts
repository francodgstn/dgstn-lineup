import type { Timestamp } from './common'

export interface Session {
  id: string
  teamId: string
  activityId?: string
  activityName?: string
  start: Timestamp
  end: Timestamp
  location?: string
  tags?: string[]
  participants_count?: number
  allowBooking?: boolean
  notes?: string
  created_at?: Timestamp
  createdBy?: string
}

export interface SessionPublicProfile {
  teamId: string
  activityId?: string
  activityName?: string
  start: Timestamp
  end: Timestamp
  allowBooking: boolean
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
