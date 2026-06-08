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
  photoURL?: string
  currentTeam?: string
  orgIds?: string[]          // org IDs where user is an org_admin
  roles?: UserRoles
  onboarding?: OnboardingState
  created_at?: Timestamp
  disabled_at?: Timestamp | null
}

/**
 * Per-user onboarding progress. Drives the product tour (phase 3) and the
 * reopenable section intro panels (phase 4). Stored on the user profile so it
 * syncs across devices rather than living in localStorage.
 */
export interface OnboardingState {
  // The guided product tour has been completed or explicitly skipped.
  tourDone?: boolean
  tourDoneAt?: Timestamp | null
  // Section intro panels the user has already seen (keyed by section, e.g.
  // 'dashboard', 'contacts', 'calendar'). Used to auto-show each intro once.
  seenIntros?: string[]
}

export interface UserPublicProfile {
  displayName?: string
  firstname?: string
  lastname?: string
}
