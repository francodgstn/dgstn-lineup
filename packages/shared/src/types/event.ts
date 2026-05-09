import type { Timestamp } from './common'

export type EventType = 'competition' | 'camp' | 'exam' | 'seminar' | 'workshop'
export type EventStatus = 'open' | 'restricted' | 'closed' | 'cancelled'

export interface Event {
  id: string
  teamId: string
  title: string
  type: EventType
  start: Timestamp
  end: Timestamp
  location?: string
  description?: string
  fee?: number
  status?: EventStatus
  participants_count?: number
  created_at?: Timestamp
  createdBy?: string
  deleted_at?: Timestamp | null
}
