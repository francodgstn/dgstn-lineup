import type { Timestamp } from './common'

export interface UserRoles {
  admin?: boolean
  superadmin?: boolean
  [key: string]: boolean | undefined
}

export interface UserProfile {
  id: string
  email?: string
  displayName?: string
  firstname?: string
  lastname?: string
  currentTeam?: string
  orgIds?: string[]          // org IDs where user is an org_admin
  roles?: UserRoles
  created_at?: Timestamp
  disabled_at?: Timestamp | null
}

export interface UserPublicProfile {
  displayName?: string
  firstname?: string
  lastname?: string
}
