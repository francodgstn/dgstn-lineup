import type { Timestamp } from './common'

export type TeamRole = 'owner' | 'manager' | 'viewer'

export type SaasPlan = 'free' | 'coach' | 'studio' | 'organization'
// 'expired' is LEGACY: lapsed trials used to be walled then purged; they now
// downgrade to the free plan ('free'/'active'). Nothing writes 'expired' any
// more — the value remains so old docs still typecheck and admin filters work.
export type SaasStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired'

export interface RankLevel {
  value: number
  label: string
  color?: string
}

export interface RankingSystem {
  id: string
  name: string
  levels: RankLevel[]
  is_primary?: boolean
}

export interface TeamLink {
  label: string
  description?: string
  url: string
  showInPortal: boolean
  iconName?: string
  isBookingLink?: boolean
  isMembershipLink?: boolean
}

export type SocialPlatform =
  | 'instagram' | 'facebook' | 'youtube' | 'tiktok'
  | 'x' | 'linkedin' | 'whatsapp' | 'website' | 'review'

export interface SocialLink {
  platform: SocialPlatform
  url: string
}

export type PortalTheme = 'light' | 'dark' | 'auto'

export interface PortalBackground {
  type: 'solid' | 'gradient'
  color: string
}

export interface Team {
  id: string
  name: string
  slug: string
  description?: string
  primaryContact?: string
  sport_type?: string
  ranking_systems?: RankingSystem[]
  links?: TeamLink[]
  language?: 'en' | 'de' | 'fr' | 'it'
  settings?: Record<string, unknown>
  // Portal / link-in-bio
  profileImage?: string
  heroImage?: string
  socialLinks?: SocialLink[]
  portalTheme?: PortalTheme
  portalAccentColor?: string
  portalBackground?: PortalBackground
  // Outreach / email template custom variables
  outreach_placeholders?: Record<string, string>
  // Onboarding: team-level dismissal of the setup checklist (data-driven; the
  // steps themselves auto-complete from collection contents)
  setup_dismissed?: boolean
  // SaaS plan fields (new in Linyup)
  plan?: SaasPlan
  plan_status?: SaasStatus
  trial_ends_at?: Timestamp
  trial_extended?: boolean   // one-time self-service trial extension has been used
  downgraded_from_trial_at?: Timestamp  // trial lapsed → moved to the free plan (drives the in-app banner)
  suspended_at?: Timestamp   // LEGACY (wall era) — deleted on downgrade; nothing writes it
  purge_at?: Timestamp       // LEGACY (purge era) — deleted on downgrade; nothing writes it
  stripe_customer_id?: string
  max_contacts?: number
  // Organization membership
  org_id?: string
  // Timestamps
  created: Timestamp
  createdBy: string
  disabled_at?: Timestamp | null
}

export interface TeamMember {
  userId: string
  teamId: string
  role: TeamRole
  joined: Timestamp
  addedBy: string
  roleUpdatedAt?: Timestamp
}

export interface BookingSettings {
  flowType: 'activity-first' | 'date-first'
  windowMonths: number
  showPhone: boolean
  showActivityDescription?: boolean
  showFitnessAppField?: boolean
  ctaUrl?: string | null
  ctaLabel?: string | null
  coachingEnabled?: boolean
}

export interface TeamPublicProfile {
  name: string
  description?: string
  slug: string
  links?: TeamLink[]
  sport_type?: string
  profileImage?: string
  heroImage?: string
  socialLinks?: SocialLink[]
  portalTheme?: PortalTheme
  portalAccentColor?: string
  portalBackground?: PortalBackground
  bookingSettings?: BookingSettings
  // Denormalized from teams/{id}.plan by syncTeamPublicProfile — true on the
  // free plan, where the portal shows a "Powered by Linyup" badge. The portal
  // must never read teams/, so the flag lives here.
  showBranding?: boolean
}

export interface TeamInvitation {
  id: string
  teamId: string
  email: string
  role: TeamRole
  token: string
  invitedBy: string
  created: Timestamp
  accepted_at?: Timestamp
  expired_at?: Timestamp
}
