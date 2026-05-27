import type { Timestamp } from './common'

export type ActivityLevel = 'all' | 'beginners' | 'intermediate' | 'advanced'

/** Top-level category that determines the session model and booking flow. */
export type ActivityType = 'group_class' | 'coaching'

export interface Activity {
  id: string
  teamId: string
  name: string
  alternativeName?: string
  description?: string
  slug: string
  color?: string
  level?: ActivityLevel
  /** Session category — default 'group_class'. 'coaching' uses 1:1 slot model. */
  type?: ActivityType
  /** Assigned coach uid — populated when type === 'coaching'. */
  coachId?: string
  /** Denormalised coach display name. */
  coachName?: string
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
