import type { Timestamp } from './common'

export type ActivityLevel = 'all' | 'beginners' | 'intermediate' | 'advanced'

export interface Activity {
  id: string
  teamId: string
  name: string
  alternativeName?: string
  description?: string
  slug: string
  color?: string
  level?: ActivityLevel
  base_score?: number | null
  isFreeTrial?: boolean
  isActive?: boolean
  image_url?: string
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
  image_url?: string
}
