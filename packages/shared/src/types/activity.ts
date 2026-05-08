import type { Timestamp } from './common'

export interface Activity {
  id: string
  teamId: string
  name: string
  description?: string
  slug: string
  color?: string
  created_at?: Timestamp
  createdBy?: string
  archived_at?: Timestamp | null
}

export interface ActivityPublicProfile {
  teamId: string
  name: string
  description?: string
  slug: string
  color?: string
}
