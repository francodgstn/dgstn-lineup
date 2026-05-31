import type { Timestamp } from './common'

// Built-in event types — hardcoded, always available
export type BuiltinEventType = 'competition' | 'camp' | 'exam' | 'seminar' | 'workshop'
export const BUILTIN_EVENT_TYPES: BuiltinEventType[] = ['competition', 'camp', 'exam', 'seminar', 'workshop']

// EventType is open: built-in slug OR a custom event_type_id (e.g. 'fighting_cup' from plugin)
export type EventType = BuiltinEventType | string
export type EventStatus = 'open' | 'restricted' | 'closed' | 'cancelled'

export interface Event {
  id: string
  teamId?: string              // null for org-wide events
  orgId?: string               // set for org-wide events
  scope?: 'team' | 'org'      // defaults to 'team' when absent
  title: string
  type: EventType              // built-in slug or custom/plugin type ID
  start: Timestamp
  end: Timestamp
  location?: string
  description?: string
  fee?: number
  status?: EventStatus
  participants_count?: number
  completed_checkins_count?: number
  attendees_count?: number
  invitations_sent_count?: number
  last_invitation_sent_at?: Timestamp
  coachId?: string | null
  coachName?: string | null
  created_at?: Timestamp
  createdBy?: string
  deleted_at?: Timestamp | null
}

// ─── configurable event type (teams/{teamId}/event_types/{typeId}) ─────────────

export type EventTypeFieldType = 'text' | 'number' | 'select' | 'multiselect' | 'boolean'

export interface EventTypeField {
  key: string
  label: string
  type: EventTypeFieldType
  options?: string[]    // for select / multiselect
  required?: boolean
  placeholder?: string
}

export interface EventTypeConfig {
  id: string
  name: string
  icon?: string                // lucide icon name
  color?: string
  source: 'team' | 'org' | 'plugin'
  plugin_id?: string           // set when source === 'plugin'
  checkin_fields?: EventTypeField[]
  contact_requirements?: string[]  // e.g. ['weight', 'birthdate'] — contact fields that must be set
  created_at?: Timestamp
  created_by?: string
}

// ─── check-in document (/checkins/{checkinId}) ─────────────────────────────────

export interface EventCheckin {
  id: string
  teamId: string
  event: { id: string; title?: string; type?: string }
  contact: { id: string; firstname: string; lastname: string }
  is_completed: boolean
  checkin_data?: Record<string, unknown>   // type-specific payload (see below)
  checked_in_by?: string                   // uid of manager
  created_at?: Timestamp
  updated_at?: Timestamp
}

// checkin_data shapes per built-in type:
//   camp:         { join_as: 'participant' | 'staff' | 'coach' | 'volunteer' }
//   exam:         { disciplines: { [rankingSystemId: string]: number } }
//   fighting_cup: { categories: string[]; weight?: number }
//   others:       {}

// ─── per-event category (events/{eventId}/categories/{catId}) ─────────────────
// Used by the fighting_cup plugin and any plugin/type that declares hasCategories

export interface EventCategory {
  id: string
  name: string
  color?: string
  gender?: 'M' | 'F' | 'both'
  min_age?: number
  max_age?: number
  min_weight?: number
  max_weight?: number
  ranking_system_id?: string   // link to team ranking system for rank-based filtering
  min_rank?: number
  max_rank?: number
  sort_order?: number
}
