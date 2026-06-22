import type { Timestamp } from './common'

// Places — a team's (or org's) physical locations. A location can have one
// sub-level of "rooms" so sessions/events can be pinned to a specific room.
//
// Storage:
//   • team places → teams/{teamId}/team_places/{placeId}            (scope: 'team')
//   • org places  → organizations/{orgId}/org_places/{placeId}      (scope: 'org')
// Org places are read-only shared resources every sub-studio can see + use; only
// the team's own places can be flagged `isPrimary` (the team's "Main Address").

export interface PlaceRoom {
  id: string
  name: string
}

export interface Place {
  id: string
  scope: 'team' | 'org'
  teamId?: string // set for team places
  orgId?: string // set for org places
  name: string
  address?: string // full single-line address — also used as the map query
  mapsLink?: string // external maps URL
  isPrimary?: boolean // the team's Main Address (team scope only)
  rooms?: PlaceRoom[] // one sub-level
  order?: number
  created_at?: Timestamp
  updated_at?: Timestamp
  createdBy?: string
}

// The primary place denormalised onto teams/{teamId}/public_profile so public
// surfaces (bio-link) can show the Main Address + map without reading team_places.
export interface PublicMainAddress {
  name: string
  address?: string
  mapsLink?: string
}

// Flat safeguard count cap — same for every plan (applies per team and per org).
export const MAX_PLACES = 25
