import type { Timestamp } from './common'
// Type-only import — no runtime cycle (document.ts only imports Timestamp).
import type { DocumentKind } from './document'
// Type-only import — no runtime cycle (connect.ts imports SaasPlan from here).
import type { ConnectOnboardingModel, ConnectAccountStatus } from './connect'
import type { PublicMainAddress } from './place'
import type { EngagementThresholds } from './engagement'
// Type-only — capabilities.ts imports TeamRole from here; erased at compile (no cycle).
import type { Capability, DataScope } from './capabilities'
// Type-only — kiosk.ts imports nothing from here; no cycle.
import type { KioskPublicConfig } from './kiosk'

// Team roles. owner/manager/viewer are the fixed SYSTEM roles (capability sets in
// code, never customizable). 'coach' is a predefined-but-team-customizable role
// (its capability set lives at teams/{teamId}/role_config/coach) whose data access
// is own-scoped (see capabilities.ts). Custom roles are a later phase.
export type TeamRole = 'owner' | 'manager' | 'coach' | 'viewer'

export type SaasPlan = 'free' | 'coach' | 'studio' | 'organization'
// 'expired' is LEGACY: lapsed trials used to be walled then purged; they now
// downgrade to the free plan ('free'/'active'). Nothing writes 'expired' any
// more — the value remains so old docs still typecheck and admin filters work.
export type SaasStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired'

// Public surfaces a team can expose at `/public/{slug}/…`. 'bio-link' is the
// team root (renders inline at `/public/{slug}`); the others are sibling routes
// that the root redirects to when chosen as the default. Every member here has a
// single landing URL. Forms are deliberately absent: they're reached only via
// per-form `/public/{slug}/forms/{slug}` URLs (no `/forms` index), so there's
// nothing to land on.
export type PublicSurface =
  | 'bio-link'
  | 'site'
  | 'space'
  | 'booking'
  | 'shop'
  | 'signup'
  | 'documents'
  | 'kiosk'

// Denormalized onto TeamPublicProfile so the public root page (which may only
// read world-readable public_profile, never the private installed_plugins) can
// tell which non-bio-link surfaces are actually live before redirecting to one.
export interface ActivePublicSurfaces {
  site: boolean
  space: boolean
  booking: boolean
  // signup is a base surface (the subscription sign-up form at /public/{slug}/signup) —
  // available on every plan, so effectively always true. Present so the root can
  // redirect to it when chosen as the default landing.
  signup?: boolean
  // shop is live when a sellable channel is enabled (products / online-courses
  // plugin or Stripe Connect); the public shop aggregates whatever exists.
  shop?: boolean
  // ≥1 published Custom Form exists (custom-forms plugin active). Optional — forms
  // are reached via their own /public/{slug}/forms/{slug} URLs, not a default
  // surface, so this is a discovery signal (e.g. a bio-link entry), NOT a landing.
  forms?: boolean
  // ≥1 published + public Document exists (documents plugin active). Reached via the
  // /public/{slug}/documents index, so — unlike forms — it CAN be a default landing.
  documents?: boolean
  // kiosk plugin active — the entrance-tablet surface at /public/{slug}/kiosk.
  // Reached by its own URL (paired to a device), never a default landing.
  kiosk?: boolean
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

// ─── Booking reminders ────────────────────────────────────────────────────────
// A team's reminder schedule (settings.bookingReminderSteps): one entry per
// reminder sent before a booked session, e.g. email 168h + email 48h + SMS 24h.
// When unset, the legacy single-email behavior applies (settings.bookingReminderHours,
// default 24h). settings.bookingRemindersEnabled remains the master toggle.
export interface BookingReminderStep {
  id: string // stable per-step marker key on the booking's reminders_sent map
  channel: 'email' | 'sms'
  offsetHours: number // hours before session start
}

/** Steps for a team's settings — authored steps, else the legacy single email. */
export function resolveBookingReminderSteps(settings: {
  bookingReminderSteps?: BookingReminderStep[]
  bookingReminderHours?: number
}): BookingReminderStep[] {
  if (settings.bookingReminderSteps?.length) return settings.bookingReminderSteps
  return [
    { id: 'legacy', channel: 'email', offsetHours: settings.bookingReminderHours || 24 },
  ]
}

// A "page link" target — one of the team's own public surfaces, reachable at
// /public/{slug}/{route}. Replaces the former per-surface boolean flags
// (is{Booking,Membership,Courses,Shop}Link) with a single discriminator so new
// surfaces are one table entry, not a new flag + branches everywhere.
//  - booking          → /booking                (always available)
//  - signup           → /signup                 (membership signup; always available)
//  - shop             → /shop                    (whole self-checkout)
//  - shop-subscriptions → /shop?tab=subscriptions    (subscriptions section)
//  - shop-products    → /shop?tab=products        (products section)
//  - shop-courses     → /shop?tab=courses         (sellable courses section)
//  - space            → /space                   (member course library; online-courses plugin)
//  - site             → /site                    (studio website; website plugin)
//  - documents        → /documents               (studio's public documents; documents plugin)
// `route` may carry a query (e.g. 'shop?tab=products') — the public link is a plain
// <a href>, so the query rides through to deep-link the right shop tab.
export type SystemLinkTarget =
  | 'booking'
  | 'signup'
  | 'shop'
  | 'shop-subscriptions'
  | 'shop-products'
  | 'shop-courses'
  | 'space'
  | 'site'
  | 'documents'

export const SYSTEM_LINK_TARGETS: readonly SystemLinkTarget[] = [
  'booking',
  'signup',
  'shop',
  'shop-subscriptions',
  'shop-products',
  'shop-courses',
  'space',
  'site',
  'documents',
]

export interface SystemLinkMeta {
  route: string // sibling route (may include a query) under /public/{slug}/
  defaultIcon: string // lucide icon name, used when the link carries no custom icon
}

export const SYSTEM_LINK_META: Record<SystemLinkTarget, SystemLinkMeta> = {
  booking: { route: 'booking', defaultIcon: 'CalendarDays' },
  signup: { route: 'signup', defaultIcon: 'UserPlus' },
  shop: { route: 'shop', defaultIcon: 'ShoppingBag' },
  'shop-subscriptions': { route: 'shop?tab=subscriptions', defaultIcon: 'Ticket' },
  'shop-products': { route: 'shop?tab=products', defaultIcon: 'Tag' },
  'shop-courses': { route: 'shop?tab=courses', defaultIcon: 'GraduationCap' },
  space: { route: 'space', defaultIcon: 'BookOpen' },
  site: { route: 'site', defaultIcon: 'Globe' },
  documents: { route: 'documents', defaultIcon: 'FileText' },
}

// A bio-link entry: either a custom external link (`url`) or a "page link" to one
// of the team's own public surfaces (`target`). Exactly one is set — `target`
// takes precedence if both somehow appear.
export interface TeamLink {
  label: string
  description?: string
  url?: string // custom links only
  showInBioLink: boolean
  iconName?: string
  target?: SystemLinkTarget // page links only
}

// Back-compat: resolve a (possibly legacy) raw link to its page-link target. Reads
// the new `target` first, then falls back to the old is{Booking,Membership,Courses,
// Shop}Link booleans so pre-refactor data still resolves. null = custom link.
export function resolveSystemLinkTarget(link: {
  target?: unknown
  isBookingLink?: unknown
  isMembershipLink?: unknown
  isCoursesLink?: unknown
  isShopLink?: unknown
}): SystemLinkTarget | null {
  if (typeof link.target === 'string' && SYSTEM_LINK_TARGETS.includes(link.target as SystemLinkTarget)) {
    return link.target as SystemLinkTarget
  }
  if (link.isBookingLink) return 'booking'
  if (link.isMembershipLink) return 'signup'
  if (link.isCoursesLink) return 'space'
  if (link.isShopLink) return 'shop'
  return null
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
  // Day thresholds for the derived contact engagement band. Unset → defaults
  // (DEFAULT_ENGAGEMENT_THRESHOLDS). The band itself is never stored.
  engagement_thresholds?: EngagementThresholds
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
  // Studio-configurable modes for MANUAL payments (cash / bank transfer / TWINT / …).
  // Free-text labels the owner manages in Settings → Payments; the Record-payment
  // dialog offers them (a sensible default set is shown until customized).
  payment_modes?: string[]
  // Operational flags for launch / founder onboarding (see docs/launch/).
  flags?: {
    // Linyup-internal / synthetic tenant (e.g. the prod smoke-test studio).
    // Excluded from platform metrics AND exempt from trial auto-downgrade.
    internal?: boolean
    // Founder / pilot studio. Exempt from trial auto-downgrade so it cannot lapse
    // to Free mid-validation; still counted in platform metrics (a real customer).
    pilot?: boolean
    // Set by the promote tool when a team is copied from sandbox into prod.
    promotedFrom?: string // source environment, e.g. 'sandbox'
    promotedAt?: Timestamp
  }
  // Stripe Connect (member → studio payments) — compact mirror written by the
  // Connect Cloud Functions. The feature flag (connectEnabled) is operator-only;
  // full account state lives in connect_accounts/{connectAccountId}.
  payments?: {
    connectEnabled?: boolean
    connectAccountId?: string
    connectModel?: ConnectOnboardingModel
    connectStatus?: ConnectAccountStatus
  }
  // Organization membership. `org_id` is the legacy single-parent link (still the
  // primary). `organization_ids` is the multi-org set (DB structure only this round
  // — a team may belong to more than one org; the OrgTeam join is the source of
  // truth, this mirrors it for affiliation lookups). Keep both in sync going forward.
  org_id?: string
  organization_ids?: string[]
  // Affiliation axis opt-in (Studio tier up — see planSupportsAffiliations). Off by
  // default; gates the affiliation UI + callables.
  affiliations_enabled?: boolean
  // Which public surface `/public/{slug}` resolves to. Defaults to 'bio-link'
  // (always present, every plan) when unset. See PublicSurface.
  default_public_surface?: PublicSurface
  // Opt-in: publish this team's coach roster (name + optional photo) to the
  // world-readable public_profile, so an organization website can list coaches
  // across its clubs. Default OFF (staff PII stays private until the team opts in).
  // The roster is the members flagged `is_coach !== false` (same set as /coaches).
  public_coaches_enabled?: boolean
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
  // Effective capabilities + data scope, DENORMALIZED here by the Admin SDK
  // (on member create / role change, and by syncMemberCapabilities when a team's
  // role_config changes). Firestore rules read these off this doc — which they
  // already fetch for role checks — so capability enforcement adds no extra read.
  // Never client-written (team_members writes are owner/SDK-only). Optional for
  // back-compat: absent ⇒ rules fall back to the role → capability defaults.
  capabilities?: Capability[]
  scope?: DataScope
  // Per-member coach flag: whether this member is part of the coach roster (shown
  // in the /coaches list + the session instructor picker, and assignable as a
  // contact's coach). Absent ⇒ coach (all members are coaches by default); set
  // `false` to opt a member out. A relationship/roster flag only — it does NOT
  // change capabilities or data scope. Managed via the manageTeamMember callable
  // (team_members writes are owner/SDK-only). Replaced the role-level coachRoles.
  is_coach?: boolean
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

/** A coach as exposed on the world-readable team public_profile (opt-in). */
export interface PublicCoach {
  uid: string
  name: string
  photoUrl?: string
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
  // Opt-in coach roster (name + optional photo), maintained by
  // syncTeamCoachesPublicProfile when `public_coaches_enabled` is true. Consumed by
  // the organization website's coaches section. Absent/empty ⇒ not opted in.
  coaches?: PublicCoach[]
  // Denormalized from teams/{id}.plan by syncTeamPublicProfile — true on the
  // free plan, where the bio-link shows a "Powered by Linyup" badge. The bio-link
  // must never read teams/, so the flag lives here.
  showBranding?: boolean
  // Denormalized from teams/{id}.default_currency by syncTeamPublicProfile so the
  // public website pricing table can format prices without reading teams/.
  default_currency?: string
  // The team's primary place (Main Address), denormalized by
  // syncPrimaryPlaceToPublicProfile so the public bio-link can show address + map.
  mainAddress?: PublicMainAddress | null
  // Which surface the team root `/public/{slug}` resolves to (mirrors
  // teams/{id}.default_public_surface). Unset → 'bio-link'.
  default_public_surface?: PublicSurface
  // Which non-bio-link surfaces are currently live (plugin active + published
  // content). Computed by syncTeamPublicProfile; the public root reads this to
  // avoid redirecting to a dead surface and to fall back to the bio-link.
  active_public_surfaces?: ActivePublicSurfaces
  // Public subset of the kiosk plugin config (installed_plugins/kiosk.config),
  // denormalized by syncTeamPublicProfile MINUS the PIN, so the public kiosk page
  // reads layout/features from one world-readable doc. Present only when installed.
  kiosk?: KioskPublicConfig
  // Documents the studio attached to the signup consent checkbox (documents
  // plugin config). Denormalized by syncTeamPublicProfile from the published +
  // public documents referenced in installed_plugins/documents.config so the
  // ANONYMOUS signup form can render consent links from a single world-readable
  // doc (never the private installed_plugins nor the root `documents` collection).
  signup_documents?: Array<{ slug: string; title: string; kind: DocumentKind }>
  // Denormalized from teams/{id}.settings.space.signup_nudge (absent ⇒ true): whether
  // the Space shows the "complete your signup" reminder to contacts who haven't
  // finished the full registration. The Space only ever reads public_profile.
  space_signup_nudge?: boolean
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
