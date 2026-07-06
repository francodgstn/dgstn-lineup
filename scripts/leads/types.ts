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
  kind: 'terms' | 'privacy' | 'regulation'
  summary: string
  body: string
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
  socialLinks: { platform: string; url: string }[]
  /** Main venue, used on sessions + the site contact section. */
  location: { label: string; address: string; mapsUrl?: string }
  contactPhone: string
  contactEmail: string

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

  /** Caveats printed after seeding (e.g. which prices are assumptions). */
  notes?: string[]
}
