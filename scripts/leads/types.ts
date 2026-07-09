/**
 * LeadProfile — the data contract between `scripts/seed-lead.ts` (the generic
 * lead-sandbox seeder) and the per-lead profile modules under
 * `scripts/leads/{lead}/profile.ts`.
 *
 * A "lead" is a prospective customer we demo to: the profile mirrors their REAL
 * public data (schedule, offerings, pricing, site copy — with their permission)
 * plus fully SYNTHETIC contacts (never real client names).
 *
 * Type vocabulary mirrors @linyup/shared (re-declared here because the seed
 * scripts compile under tsconfig.scripts.json, which does not resolve the
 * workspace import — same convention as scripts/lib/affiliations.ts).
 */

export type LeadRecurrence =
  | 'per_class'
  | 'one_time'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'annual'

export interface LeadStaffDef {
  /** id suffix → auth uid `lead-{leadId}-{key}` ('owner' key gets `lead-{leadId}-uid`). */
  key: string
  role: 'owner' | 'manager' | 'coach'
  firstname: string
  lastname: string
  email: string
}

export interface LeadPlaceDef {
  /** id suffix → `{teamId}-place-{key}`; referenced by LeadGridSlot.placeKey etc. */
  key: string
  name: string
  address: string
  mapsUrl?: string
  /** The team's Main Address (denormalised to the bio-link). Exactly one. */
  isPrimary?: boolean
}

export interface LeadCustomFieldDef {
  /** Stable id — the key used in Contact.custom_fields. */
  id: string
  label: string
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox'
  options?: string[] // for type 'select'
  required?: boolean
}

export interface LeadReminderStep {
  channel: 'email' | 'sms'
  /** Hours before session start (e.g. 168 = 1 week, 48 = 2 days, 24 = day before). */
  offsetHours: number
}

export interface LeadAutomationTemplateDef {
  /** id suffix → `{teamId}-tmpl-{key}`; referenced by rule actions' templateKey. */
  key: string
  name: string
  subject: string
  /** Markdown body; {{teamName}} / {{firstname}} placeholders supported. */
  body: string
  /** Library key (`lib_…:{lang}`) when the template mirrors a stock one. */
  systemKey?: string
}

export interface LeadAutomationRuleDef {
  /** id suffix → `{teamId}-rule-{key}`. */
  key: string
  name: string
  active?: boolean
  systemKey?: string
  /** Engine trigger, e.g. { type: 'session_ended', delayMinutes: 120 }. */
  trigger: Record<string, unknown>
  conditions?: Record<string, unknown>[]
  /** Engine actions; `templateKey` entries are resolved to seeded template ids. */
  actions: (Record<string, unknown> & { templateKey?: string })[]
}

export interface LeadActivityDef {
  name: string
  slug: string
  color: string
  level: 'all' | 'beginner' | 'intermediate' | 'advanced'
  isFreeTrial: boolean
  base_score: number
  description: string
  /** Group-class capacity shown/enforced on the public booking surface. */
  capacity: number | null
  /** Assets-folder base name for the cover image (e.g. 'activity-squad-technique'). */
  imageAsset?: string
  /** Display-only entry requirements shown on the public booking page. */
  prerequisites?: string
  /** Per-activity confirmation-email note (overrides the team-wide one). */
  confirmationInstructions?: string
  /** Paid-access gate; defaults derived from isFreeTrial when unset. */
  accessTier?: 'open' | 'members' | 'subscription'
  /** For accessTier 'subscription': LeadSubscriptionDef.keys that grant access. */
  accessSubKeys?: string[]
  /** Drop-in / pay-per-class price (major units) for uncovered contacts. */
  dropInPrice?: number
}

export interface LeadSubscriptionPriceDef {
  /** id suffix → `{teamId}-sub-{subKey}-price-{key}`. */
  key: string
  /** Shown in the price picker + shop, e.g. "x3 Starter Pack". */
  label?: string
  amount: number
  recurrence: LeadRecurrence
  /** For one_time prices: how long the purchase covers (months). */
  includedMonths?: number
  /** Lesson credits granted by the purchase (credit packs; Wave 3 feature). */
  credits?: number
  /** True when the price is a plausible assumption, not confirmed public data. */
  assumed?: boolean
}

export interface LeadSubscriptionDef {
  /** id suffix → `{teamId}-sub-{key}`. */
  key: string
  name: string
  description: string
  source: 'internal' | 'aggregator'
  recurrence: LeadRecurrence | null
  /** Major units in the team currency; null = price-less (e.g. aggregator passes). */
  price: number | null
  /** For one_time prices: how long the purchase covers (months). */
  includedMonths?: number
  /** True when the price is a plausible assumption, not confirmed public data. */
  priceAssumed?: boolean
  /** Multi-price types (e.g. single / 3-pack / 5-pack). When set, overrides the
   *  single price/recurrence/includedMonths fields above. */
  prices?: LeadSubscriptionPriceDef[]
}

export interface LeadGridSlot {
  /** Weekday, JS getDay() convention: 0=Sun … 6=Sat. */
  day: number
  hh: number
  mm: number
  durMin: number
  /** Index into LeadProfile.activities. */
  activityIdx: number
  /** Which staff member teaches it (LeadStaffDef.key). */
  staffKey: string
  /** Where it happens (LeadPlaceDef.key); falls back to LeadProfile.location. */
  placeKey?: string
  /** Only materialize in upcoming weeks (new offerings with no history). */
  upcomingOnly?: boolean
}

export interface LeadCoachingTemplate {
  staffKey: string
  durationMin: number
  isFreeTrial: boolean
  /** Recurrence days (JS getDay convention) + 'HH:MM' start, in the team timezone. */
  daysOfWeek: number[]
  time: string
  /** How many upcoming occurrences of daysOfWeek to materialize as bookable slots. */
  slotCount: number
  /** Indices (0-based, chronological) of slots seeded as already booked/full. */
  bookedSlots: number[]
  /** Where it happens (LeadPlaceDef.key); falls back to LeadProfile.location. */
  placeKey?: string
}

export interface LeadContactDef {
  firstname: string
  lastname: string
  gender: 'M' | 'F'
  birthYear: number | null
  birthplace: string | null
  type: 'student' | 'trial' | 'external'
  /** Authoring status — mapped to acquisition/affiliation fields, never written raw. */
  status: 'active' | 'almost_ready' | 'under_review' | 'expired' | 'requested' | 'guest'
  totalSessions: number
  /** LeadSubscriptionDef.key or null. */
  subKey: string | null
  /** Assign to a coach's own-scope view (LeadStaffDef.key). */
  assignedToStaffKey?: string
  /** Acquisition source override (default: seeded-random). */
  source?: 'website' | 'referral' | 'social' | 'event' | 'other'
  /** Free-text detail shown with the source (e.g. 'QR poster', 'Meta ads'). */
  sourceDetail?: string
  /** Values for the team's custom field definitions (keyed by definition id). */
  customFields?: Record<string, string | number | boolean>
  /** Mark this synthetic contact as the DEMO-LOGIN target: its `login_emails`
   *  gets the operator (+ profile `demoLoginEmails`), so you/the lead can sign in
   *  AS this member (shop, Space, courses) via the passwordless code flow. Pick a
   *  data-rich contact (subscription + credit pack + bookings) for a full POV. */
  demoLogin?: boolean
  /** Present for child contacts (baby/toddler classes): parent + guardian fields.
   *  Kids get no gamification, no goals, no leaderboard presence, no auth login. */
  kid?: {
    /** ISO date, e.g. '2024-11-03'. */
    birthdate: string
    parentName: string
    parentEmail: string
    parentPhone: string
    note: string
  }
}

export interface LeadEventDef {
  title: string
  type: string
  startOffset: number
  durationH: number
  fee: number
  location: string
  description: string
}

export interface LeadGoalDef {
  title: string
  description: string
  categories: string[]
}

export interface LeadCourseLessonDef {
  title: string
  type: 'text' | 'video'
  body: string
  media?: string
  dur?: number
}

export interface LeadCourseDef {
  /** id suffix → `{teamId}-course-{key}`. */
  key: string
  title: string
  summary: string
  access: 'free' | 'registered'
  /** Assets-folder base name for the cover image. */
  coverAsset?: string
  modules: { title: string; lessons: LeadCourseLessonDef[] }[]
}

export interface LeadProductDef {
  /** id suffix → `{teamId}-prod-{key}`. */
  key: string
  name: string
  description: string
  priceAmount: number
  variantLabel?: string
  variants?: { id: string; label: string }[]
}

export interface LeadDocumentDef {
  /** id suffix → `{teamId}-doc-{key}`. */
  key: string
  title: string
  slug: string
  kind: 'terms' | 'privacy' | 'regulation' | 'other'
  summary: string
  /** Rich-text body; ignored when externalUrl is set. */
  body: string
  /** Externally-hosted document (e.g. a SignWell agreement) → source 'external_link'. */
  externalUrl?: string
  /** Attach to the public signup flow (documents plugin config). */
  inSignup?: boolean
}

/**
 * Website sections, passed through to site_drafts/site_published verbatim after
 * asset resolution: `imageAsset` → `imageUrl`, `bgImageAsset` → `bgImageUrl`,
 * `imagesAssets` → `images` (each an assets-folder base name; missing files
 * resolve to null / are dropped).
 */
export type LeadSiteSection = Record<string, unknown> & {
  id: string
  type: string
  imageAsset?: string
  bgImageAsset?: string
  imagesAssets?: string[]
}

export interface LeadProfile {
  /** Lead id — folder name, workflow choice value, teamId `lead-{id}`. */
  id: string
  teamName: string
  slug: string
  description: string
  sportType: string
  language: 'en' | 'de' | 'fr' | 'it'
  currency: string
  /** IANA timezone the weekly grid times are expressed in (e.g. 'Europe/Zurich'). */
  timezone: string
  accentColor: string
  /** BIO_LINK_GRADIENTS key (apps/web/src/lib/bioLink.ts). */
  portalGradient: string
  /** Optional custom background for the branded public surfaces that read
   *  `bioLinkBackground` — the bio-link home, the shop, and the Space. A hex
   *  color (e.g. '#fde0dd') or a full CSS value (e.g. 'linear-gradient(…)').
   *  When set it overrides `portalGradient`. (Booking follows the app theme.) */
  publicBackground?: string
  /** How many FUTURE weeks of the weekly grid to materialize as bookable
   *  sessions (default 3). Raise it so a lead trying the system for a while has
   *  a schedule that lasts; the public booking window is derived from it. Keep
   *  it under ~11 weeks unless the grid is small (the booking query caps the
   *  number of upcoming sessions it lists). */
  scheduleWeeksAhead?: number
  socialLinks: { platform: string; url: string }[]
  /** Main venue, used on sessions + the site contact section. */
  location: { label: string; address: string; mapsUrl?: string }
  contactPhone: string
  contactEmail: string

  /** Physical locations (pools, gyms, studios). Slots reference them by key. */
  places?: LeadPlaceDef[]
  /** Account-wide extra contact fields (installs the custom-fields plugin). */
  customFieldDefinitions?: LeadCustomFieldDef[]
  /** Team-wide note appended to booking confirmation emails ("Important" box). */
  bookingConfirmationInstructions?: string
  /** Booking reminder schedule (settings.bookingReminderSteps; Wave 2 sends SMS). */
  reminders?: { steps: LeadReminderStep[] }
  /** SMS sender name (≤11 alphanumeric chars) → integrations/sms_sender. */
  smsSenderName?: string
  /** Profile-authored automations; replaces the stock welcome/win-back pair.
   *  The lib_trial_cleanup hygiene rule is always installed regardless. */
  automations?: { templates: LeadAutomationTemplateDef[]; rules: LeadAutomationRuleDef[] }
  /** Outbound-delivery policy (messaging_policies/{teamId}, operator-only).
   *  Default: allowlist of the owner's + the profile's contact email — the lead
   *  gets real OTP/confirmations while synthetic contacts stay silent. Extra
   *  entries extend the allowlist ('@domain.tld' entries allowed); phones are
   *  E.164 for SMS delivery. mode override for special cases (e.g. 'silent'). */
  messagingPolicy?: {
    mode?: 'live' | 'allowlist' | 'redirect' | 'silent'
    allowEmails?: string[]
    allowPhones?: string[]
    redirectEmail?: string
    note?: string
  }
  /** Extra REAL emails added to the demo-login contact's `login_emails` (the one
   *  flagged `demoLogin`), on top of the operator email the seeder always adds —
   *  e.g. the lead's own address so they can try the member POV. Delivery of the
   *  login code still obeys the messaging policy (allowlist/redirect the tester). */
  demoLoginEmails?: string[]

  staff: LeadStaffDef[]
  rankingSystem: {
    id: string
    name: string
    levels: { value: number; label: string; color: string }[]
  } | null
  /** settings.gamification payload (enabled, base score, multipliers, …). */
  gamification: Record<string, unknown>

  activities: LeadActivityDef[]
  coaching: {
    activityName: string
    slug: string
    description: string
    templates: LeadCoachingTemplate[]
  }
  subscriptions: LeadSubscriptionDef[]
  weeklyGrid: LeadGridSlot[]
  contacts: LeadContactDef[]
  goals: LeadGoalDef[]
  tasks: string[]
  events: LeadEventDef[]

  siteSections: LeadSiteSection[]
  courses: LeadCourseDef[]
  products: LeadProductDef[]
  documents: LeadDocumentDef[]

  /** Assets-folder base names for team branding (default 'profile' / 'hero'). */
  profileImageAsset?: string
  heroImageAsset?: string

  /**
   * Optional Stripe TEST connected account (acct_…) to wire for the "pay with
   * Linyup" flow, so the seeded team can take payments without re-onboarding.
   * Overridden by the --connect flag / STRIPE_CONNECT_TEST_ACCOUNT env. The acct
   * must already be onboarded in Stripe test mode (see scripts/connect-test-account.ts).
   */
  stripeConnectTestAccount?: string

  /** Caveats printed after seeding (e.g. which prices are assumptions). */
  notes?: string[]
}
