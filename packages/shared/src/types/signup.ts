import type { Timestamp } from './common'

// Public, world-readable signup flag (app_settings/public). Drives client UX in
// apps/web; the authoritative enforcement is the beforeUserCreated blocking
// function. Whether signup is open is not sensitive.
export interface PublicAppSettings {
  public_signup_enabled: boolean
  updated_at?: Timestamp
  updated_by?: string // operator email that last toggled it
}

// An email authorized to create a Linyup account while public signup is closed.
// Doc id = normalizeEmail(email). Persistent — the operator removes entries.
export interface SignupAllowlistEntry {
  email: string
  added_by: string // operator email
  added_at: Timestamp
  note?: string
}

// Write-to-send queue: creating one of these triggers the invite email
// (onSignupInviteCreated), then the doc has served its purpose.
export interface SignupInvite {
  email: string
  created_by: string // operator email
  created_at: Timestamp
}
