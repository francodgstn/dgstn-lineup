import type { Timestamp } from './common'
// Type-only import — no runtime cycle (connect.ts imports SaasPlan from here).
import type { ConnectOnboardingModel, ConnectAccountStatus } from './connect'

export type TeamRole = 'owner' | 'manager' | 'viewer'

export type SaasPlan = 'free' | 'coach' | 'studio' | 'organization'
// 'expired' is LEGACY: lapsed trials used to be walled then purged; they now
// downgrade to the free plan ('free'/'active'). Nothing writes 'expired' any
// more — the value remains so old docs still typecheck and admin filters work.
export type SaasStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired'

// Public surfaces a team can expose at `/public/{slug}/…`. 'bio-link' is the
// team root (renders inline at `/public/{slug}`); the others are sibling routes
// that the root redirects to when chosen as the default.
export type PublicSurface = 'bio-link' | 'site' | 'space' | 'booking'

// Denormalized onto TeamPublicProfile so the public root page (which may only
// read world-readable public_profile, never the private installed_plugins) can
// tell which non-bio-link surfaces are actually live before redirecting to one.
export interface ActivePublicSurfaces {
  site: boolean
  space: boolean
  booking: boolean
}

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

// ─── Custom Fields plugin ─────────────────────────────────────────────────────
// Account-wide definitions of extra contact fields. Defined here (team config);
// the per-contact values live on Contact.custom_fields keyed by definition id.

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox'

export interface CustomFieldDefinition {
  id: string // stable slug/uuid — the key used in Contact.custom_fields
  label: string
  type: CustomFieldType
  options?: string[] // for type 'select'
  required?: boolean
}

export interface TeamLink {
  label: string
  description?: string
  url: string
  showInBioLink: boolean
  iconName?: string
  isBookingLink?: boolean
  isMembershipLink?: boolean
  // System link to the public Space (online courses). Only meaningful when the
  // online-courses plugin is active; routes to /public/space/{slug}.
  isCoursesLink?: boolean
  // System link to the public Shop (self-checkout). Only meaningful when the team
  // has Stripe Connect enabled; routes to /public/{slug}/shop.
  isShopLink?: boolean
}

export type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'linkedin'
  | 'whatsapp'
  | 'website'
  | 'review'

export interface SocialLink {
  platform: SocialPlatform
  url: string
}

export type BioLinkTheme = 'light' | 'dark' | 'auto'

export interface BioLinkBackground {
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
  // Custom Fields plugin — account-wide extra contact field definitions
  custom_field_definitions?: CustomFieldDefinition[]
  links?: TeamLink[]
  language?: 'en' | 'de' | 'fr' | 'it'
  settings?: Record<string, unknown>
  // Bio-link / link-in-bio
  profileImage?: string
  heroImage?: string
  socialLinks?: SocialLink[]
  bioLinkTheme?: BioLinkTheme
  bioLinkAccentColor?: string
  bioLinkBackground?: BioLinkBackground
  // Outreach / email template custom variables
  outreach_placeholders?: Record<string, string>
  // Onboarding: team-level dismissal of the setup checklist (data-driven; the
  // steps themselves auto-complete from collection contents)
  setup_dismissed?: boolean
  // SaaS plan fields (new in Linyup)
  plan?: SaasPlan
  plan_status?: SaasStatus
  trial_ends_at?: Timestamp
  trial_extended?: boolean // one-time self-service trial extension has been used
  downgraded_from_trial_at?: Timestamp // trial lapsed → moved to the free plan (drives the in-app banner)
  suspended_at?: Timestamp // LEGACY (wall era) — deleted on downgrade; nothing writes it
  purge_at?: Timestamp // LEGACY (purge era) — deleted on downgrade; nothing writes it
  stripe_customer_id?: string
  max_contacts?: number
  // Billing currency for subscription-type prices (ISO 4217, e.g. 'CHF').
  // Pre-filled from the configured payment gateway's currency when one exists.
  default_currency?: string
  // Stripe Connect (member → studio payments) — compact mirror written by the
  // Connect Cloud Functions. The feature flag (connectEnabled) is operator-only;
  // full account state lives in connect_accounts/{connectAccountId}.
  payments?: {
    connectEnabled?: boolean
    connectAccountId?: string
    connectModel?: ConnectOnboardingModel
    connectStatus?: ConnectAccountStatus
  }
  // Organization membership
  org_id?: string
  // Which public surface `/public/{slug}` resolves to. Defaults to 'bio-link'
  // (always present, every plan) when unset. See PublicSurface.
  default_public_surface?: PublicSurface
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
  bioLinkTheme?: BioLinkTheme
  bioLinkAccentColor?: string
  bioLinkBackground?: BioLinkBackground
  bookingSettings?: BookingSettings
  // Denormalized from teams/{id}.plan by syncTeamPublicProfile — true on the
  // free plan, where the bio-link shows a "Powered by Linyup" badge. The bio-link
  // must never read teams/, so the flag lives here.
  showBranding?: boolean
  // Denormalized from teams/{id}.default_currency by syncTeamPublicProfile so the
  // public website pricing table can format prices without reading teams/.
  default_currency?: string
  // Which surface the team root `/public/{slug}` resolves to (mirrors
  // teams/{id}.default_public_surface). Unset → 'bio-link'.
  default_public_surface?: PublicSurface
  // Which non-bio-link surfaces are currently live (plugin active + published
  // content). Computed by syncTeamPublicProfile; the public root reads this to
  // avoid redirecting to a dead surface and to fall back to the bio-link.
  active_public_surfaces?: ActivePublicSurfaces
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
