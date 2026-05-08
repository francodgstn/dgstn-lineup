import type { Timestamp } from './common'

// Generic event type — teams can define their own types via team settings
export type EventType = 'competition' | 'camp' | 'exam' | 'seminar' | 'workshop' | string

export interface Event {
  id: string
  title: string
  type: EventType
  start: Timestamp
  end: Timestamp
  location?: string
  description?: string
  participants_count?: number
  created_at?: Timestamp
  createdBy?: string
}
