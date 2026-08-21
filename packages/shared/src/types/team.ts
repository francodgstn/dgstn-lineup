import type { Timestamp } from './common'
// Type-only import — no runtime cycle. document.ts imports only types
// (Timestamp, WaiverConfig), and waiver.ts's only runtime import is
// utils/identity, which imports nothing from here.
import type { DocumentKind } from './document'
// Type-only — waiver.ts imports SaasPlan from here; erased at compile (no cycle).
import type { PublicRequiredWaiver } from './waiver'
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
  | 'events'

/** Runtime companion to `PublicSurface`, for validating untrusted values. */
export const PUBLIC_SURFACES: readonly PublicSurface[] = [
  'bio-link',
  'site',
  'space',
  'booking',
  'shop',
  'signup',
  'documents',
  'kiosk',
  'events',
]

/** Type guard for an untrusted surface value (query params, stored config). */
export function isPublicSurface(value: unknown): value is PublicSurface {
  return typeof value === 'string' && (PUBLIC_SURFACES as readonly string[]).includes(value)
}

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
  // shop is live when the studio can BE PAID (a chargeable Stripe Connect
  // account, kill-switch up) — every shop item, membership / product / course /
  // gift card alike, is bought through Connect. The plugins decide what is on
  // the shelves; this decides whether there is a till (UX-33).
  //
  // IT IS NOT THE ROUTING ANSWER, and this is the one flag here where the two
  // differ: without a till the shop route renders a READ-ONLY PRICE LIST, so it
  // is still a destination. Anything asking "may I link there?" reads it
  // through `routableSurfaces` (publicRoutes.ts), which is the only place that
  // correction is made; anything asking "can this studio be paid?" should read
  // `TeamPublicProfile.payments_enabled` directly.
  shop?: boolean
  // ≥1 event has been explicitly published (Event.publicVisibility === 'public').
  // Events are private by default, so this is false for most studios.
  events?: boolean
  // ≥1 published Custom Form exists (custom-forms plugin active). Optional — forms
  // are reached via their own /public/{slug}/forms/{slug} URLs, not a default
  // surface, so this is a discovery signal (e.g. a bio-link entry), NOT a landing.
  forms?: boolean
  // ≥1 public_profile MIRROR exists for one of the team's documents. Documents is
  // no longer a plugin, so there is no install to probe — and the probe is
  // deliberately over the MIRRORS rather than over the root `documents`
  // collection: a team that was torn down by a downgrade still has its documents,
  // only its mirrors were deleted, so a root-collection probe would flip the
  // surface live over a page that renders empty. Reached via the
  // /public/{slug}/documents index, so — unlike forms — it CAN be a default landing.
  documents?: boolean
  // kiosk plugin active — the entrance-tablet surface at /public/{slug}/kiosk.
  // Reached by its own URL (paired to a device), never a default landing.
  kiosk?: boolean
  // ── THE APPOINTMENT PICKER (/public/{slug}/appointments) — HALF AN ANSWER,
  // and it says so in its own doc comment because the other half is on this very
  // document and must NOT be copied into this flag.
  //
  // THIS FLAG IS THE CONTENT HALF: is there anything bookable behind the picker?
  // It mirrors what `listAvailability` would return — ≥1 `status: 'active'`
  // availability window whose `activityIds` resolve to ≥1 `type: 'appointment'`
  // activity of this team with a bookable duration menu (priced-only durations
  // drop out when the studio has no chargeable Connect account, exactly as they
  // do there). Hours with no appointment activity yield zero slots, and an
  // activity nobody published hours for is equally unbookable, so neither on its
  // own is a live surface.
  //
  // THE OTHER HALF IS `bookingSettings.appointmentsEnabled`, the studio's own
  // toggle, and it is deliberately NOT folded in here: it is written straight to
  // this public_profile document by Settings → Booking, which does not touch the
  // team document, so `syncTeamPublicProfile` never sees the write. A stored
  // copy would be silently stale from the moment a studio flipped the switch —
  // which is the one failure mode this flag was added to avoid. It is read LIVE
  // from the same document instead, in the same read, at no cost.
  //
  // COMPOSE THE TWO THROUGH `appointmentPickerLive` (publicRoutes.ts) and
  // nowhere else. Absent ⇒ not computed ⇒ treated as not live, which is the
  // safe direction: an absent row beats a row with a guessed live state.
  //
  // Not a `PublicSurface` member: the picker has a landing URL, but making it
  // one would also put it in the default-landing choices, the website header
  // link derivation and the bio-link page-link picker. It is a deep-link
  // destination (activity/provider/date presets), not a front door.
  appointments?: boolean
}

// ─── Documents settings (teams/{teamId}/settings/documents) ──────────────────
// Documents is a DEFAULT FEATURE, not a plugin, so its per-team config cannot
// live in `installed_plugins/documents.config` any more. This is its new home.
export interface TeamDocumentsSettings {
  /** Published documents attached to the public signup consent checkbox. */
  signupDocumentIds: string[]
}

/**
 * The ONE dual read for the signup-consent selection, used by every reader —
 * the sync that denormalises it and the panel that edits it — so the two cannot
 * disagree about which location wins while teams are being migrated.
 *
 * New location first, retired plugin config second. It stays until the backfill
 * has run everywhere; deleting the fallback before then blanks `signup_documents`
 * for un-migrated teams, which silently drops the consent links off the anonymous
 * signup form.
 */
export function resolveSignupDocumentIds(input: {
  settings?: Partial<TeamDocumentsSettings> | null
  legacyPluginConfig?: { signupDocumentIds?: unknown } | null
}): string[] {
  const pick = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : null
  return pick(input.settings?.signupDocumentIds) ?? pick(input.legacyPluginConfig?.signupDocumentIds) ?? []
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
  /**
   * May this field be ASKED on the public booking form?
   *
   * OFF BY DEFAULT, AND THAT IS THE WHOLE POINT. A custom field is a studio's
   * private annotation on a person — "payment risk", "complaint history" — and
   * the definitions live on the team document, which only members can read. The
   * public booking form is anonymous, so asking one there means MIRRORING its
   * label, type and options into the world-readable public profile.
   *
   * Blanket mirroring would publish the SHAPE of a studio's private notes even
   * with no values attached, and publishing is not reversible for anyone who
   * already scraped it. So each definition opts in explicitly, and
   * `publicCustomFields` on the team's public profile carries only the ticked
   * ones (Franco's call, 2026-08-20).
   */
  publicOnBookingForm?: boolean
}

/** The world-readable half of a custom field definition — mirrored to
 *  `TeamPublicProfile.publicCustomFields` for exactly those definitions that set
 *  `publicOnBookingForm`. Carries what the form needs to RENDER the input and
 *  nothing else; never a stored value. */
export interface PublicCustomFieldDefinition {
  id: string
  label: string
  type: CustomFieldType
  options?: string[]
}

// ─── Booking form: CONTACT fields ─────────────────────────────────────────────
//
// TWO KINDS OF QUESTION SHARE THE BOOK FORM, and they are told apart by WHERE
// THE ANSWER LIVES — not by how they look:
//
//   · a CONTACT FIELD is a fact about the PERSON. The answer is written to the
//     contact, survives the booking, is filterable on /contacts and readable by
//     the automation engine. Phone, address, swim level, a ranking.
//   · a BOOKING QUESTION (`Activity.bookingQuestions`) is a fact about THIS
//     SEAT. It is stored on the booking, shows on the day sheet, and is never
//     copied to the contact. "How old is the child today", "which lane".
//
// Nothing converts one into the other, deliberately. Asking a per-person fact as
// a booking question is the mistake this split exists to prevent: the answer
// lands on a booking, the studio can never filter by it, and it is re-asked at
// every booking.

/** One field the book form collects INTO THE CONTACT. */
export interface BookingContactField {
  /**
   * A base contact field name (`phone`, `address`, `birthdate`), or a custom
   * field as `custom:{definitionId}`.
   *
   * The prefix is what keeps the two namespaces from colliding: a studio may
   * legitimately create a custom field called "phone", and without it that
   * definition would silently take over the base field's slot.
   */
  key: string
  /** Blocks submit when unanswered. A value already on the contact satisfies it
   *  — the form prefills and does not re-ask. */
  required?: boolean
}

export const BOOKING_CONTACT_FIELD_CUSTOM_PREFIX = 'custom:'

/** Base contact fields a studio may add to the book form. Deliberately small:
 *  firstname/lastname/email are always collected and are not listed here. */
export const BOOKING_CONTACT_BASE_FIELDS = ['phone', 'birthdate', 'address'] as const
export type BookingContactBaseField = (typeof BOOKING_CONTACT_BASE_FIELDS)[number]

/**
 * THE resolution of "what does this activity's book form ask for", and the only
 * place the team default and the activity list are combined.
 *
 * The activity EXTENDS the team default rather than replacing it (Franco's call,
 * 2026-08-20): a studio asks phone + level everywhere, and a kids class ADDS the
 * child's name. That differs from `confirmationInstructions`, which overrides —
 * the difference is deliberate, because a list of fields composes and a block of
 * prose does not.
 *
 * Dedupe is by key, ACTIVITY WINS, so an activity can promote a team-optional
 * field to required without restating the rest.
 *
 * `showPhone` is read here as a FALLBACK and nowhere else. It predates this list
 * and says the same thing a `phone` entry says; two writers for one fact is the
 * drift this codebase keeps paying for. A team that has never edited the new
 * list still gets its phone behaviour from the old boolean; one that has, does
 * not consult it again.
 */
export function resolveBookingContactFields(
  // Deliberately accepts a PARTIAL: callers hand it whatever
  // `loadBookingSettings` returned, and an absent `showPhone` means the same
  // thing here as everywhere else — true, ask for a phone number.
  bookingSettings:
    | { contactFields?: BookingContactField[]; showPhone?: boolean }
    | null
    | undefined,
  activityFields?: BookingContactField[] | null
): BookingContactField[] {
  const teamFields = bookingSettings?.contactFields
  const base: BookingContactField[] = teamFields?.length
    ? teamFields
    : // Legacy shape: showPhone !== false meant "ask for a phone number".
      bookingSettings?.showPhone !== false
      ? [{ key: 'phone' }]
      : []

  const byKey = new Map<string, BookingContactField>()
  for (const f of base) if (f?.key) byKey.set(f.key, f)
  for (const f of activityFields ?? []) if (f?.key) byKey.set(f.key, f)
  return [...byKey.values()]
}

/** Is this key a custom field, and which definition does it name? */
export function bookingContactFieldCustomId(key: string): string | null {
  return key.startsWith(BOOKING_CONTACT_FIELD_CUSTOM_PREFIX)
    ? key.slice(BOOKING_CONTACT_FIELD_CUSTOM_PREFIX.length) || null
    : null
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

// ─── Nav pins seeding ─────────────────────────────────────────────────────────
// Team-seedable DEFAULT for the admin sidebar's pinned "Shortcuts" (see
// NavPinsContext / DEFAULT_PINNED_IDS in apps/web). Lets a demo/seeded tenant
// ship with its own pin set + order that survives a fresh browser on any
// machine, instead of relying on the per-browser localStorage default. Array
// order IS the pin order (same convention as the localStorage payload). Only
// applied by NavPinsProvider when the signed-in user has no pins of their own
// yet (no `linyup_nav_pins` / legacy `linyup_settings_pins` key in
// localStorage) — once the user pins/unpins/reorders anything, their choice
// is persisted and wins permanently, even if this default later changes.
// Ids are the same catalogue keys the sidebar already resolves pins against
// (main nav ids, settings ids from SETTINGS_ITEMS, or plugin-scoped
// `plugin:{pluginId}:{href}`); an id that doesn't currently resolve (e.g. a
// plugin that isn't installed for this team) is silently skipped, so a stale
// or not-yet-installed id degrades gracefully rather than breaking the list.
export interface TeamNavDefaults {
  defaultNavPins?: string[]
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
//  - documents        → /documents               (studio's public documents; every plan)
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
  | 'events'

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
  'events',
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
  events: { route: 'events', defaultIcon: 'CalendarRange' },
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

/**
 * Operational flags shared by both billable tenants — a `Team` and an
 * `Organization`. Declared ONCE, because the trial sweep asks the same question
 * of both (`tenantExemptFromTrialSweep`) and two copies of the shape are how the
 * two tiers start disagreeing about who may lapse.
 */
export interface TenantFlags {
  /** Linyup-internal / synthetic tenant (e.g. the prod smoke-test studio).
   *  Excluded from platform metrics AND exempt from trial auto-downgrade. */
  internal?: boolean
  /** Founder / pilot studio. Exempt from trial auto-downgrade so it cannot lapse
   *  to Free mid-validation; still counted in platform metrics (a real customer). */
  pilot?: boolean
  /**
   * A REAL customer the platform has agreed to bill nothing, indefinitely.
   *
   * Exempt from the trial sweep like `pilot`, and COUNTED in platform metrics
   * like `pilot` — this is real usage, and Linyup's first migrated organisation
   * is about to be its largest tenant, so hiding it (as `internal` would) would
   * corrupt every usage number on the platform.
   *
   * It is deliberately NOT `pilot`: that one means "founder validation in
   * progress" and is temporary by construction, so overloading it would make
   * "how many pilots do we have" unanswerable and would sweep a comped customer
   * into any future pilot-graduation job.
   *
   * Expected to sit on `plan_status: 'active'` with no Stripe subscription. The
   * flag is the RECORD of why there is no subscription — without it, the first
   * billing reconciliation reports the tenant as broken rather than as a
   * decision somebody made. Operator-set only; never client-writable.
   */
  comped?: boolean
  /** Why, in one line — e.g. 'founding customer, migrated 2026'. */
  comped_reason?: string
  comped_since?: Timestamp
}

/**
 * Is this tenant exempt from the daily trial-lapse sweep?
 *
 * THE one reader of these flags for that decision, so a team and an organisation
 * can never answer it differently — they used to each spell the check out, and
 * adding a third flag meant finding both. Nothing else about the three flags is
 * the same: `internal` also hides the tenant from platform metrics, `comped`
 * deliberately does not.
 */
export function tenantExemptFromTrialSweep(flags?: TenantFlags): boolean {
  return Boolean(flags?.internal || flags?.pilot || flags?.comped)
}

/**
 * Is this tenant hidden from platform metrics?
 *
 * THE one reader of the flags for that decision, for the same reason
 * `tenantExemptFromTrialSweep` exists: the check used to be spelled out inline,
 * and the copies did not agree. The daily snapshot skipped internal TEAMS but
 * not internal ORGANISATIONS, and the operator console's overview skipped
 * neither — so the console and `platform_metrics/{date}` reported different
 * numbers for the same platform, while a comment in the snapshot called the
 * shared reducer "single source of truth".
 *
 * Only `internal` hides a tenant. `pilot` and `comped` are REAL usage and
 * belong in every count — `comped` only leaves the MRR line, which the reducer
 * handles from its own flag.
 *
 * Hidden from METRICS, never from the console's account list: an operator who
 * cannot see the demo tenant cannot manage it.
 */
export function tenantHiddenFromPlatformMetrics(flags?: TenantFlags): boolean {
  return flags?.internal === true
}

/** Which exemption applied, for the sweep's log line. Null when none did. */
export function trialSweepExemption(flags?: TenantFlags): 'internal' | 'pilot' | 'comped' | null {
  if (flags?.internal) return 'internal'
  if (flags?.pilot) return 'pilot'
  if (flags?.comped) return 'comped'
  return null
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
  // Free-form settings bag (booking, gamification, referral, …). Untyped at
  // this level because it's a grab-bag of unrelated feature settings; typed
  // sub-shapes (e.g. TeamNavDefaults for `defaultNavPins`, BookingSettings)
  // live alongside their feature and get cast at the read site — see
  // TeamNavDefaults above for the nav-pins-seeding key.
  //
  // `settings.experimentalFeatures` is one such sub-shape:
  // ExperimentalFeatureSettings in types/experimental.ts, read through
  // resolveExperimentalFeatures / isExperimentalFeatureEnabled. Owner-write,
  // like every other key in this bag.
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
  flags?: TenantFlags & {
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

/**
 * How the studio's booking flow behaves. Stored in exactly ONE place:
 * `teams/{teamId}/public_profile/{teamId}.bookingSettings` — world-readable (the
 * public booking page and the mobile app need it) and team-member writable (the
 * admin Settings → Booking form). The booking callables read it there too.
 *
 * There used to be a second copy on the team doc (`settings.booking`). It is
 * gone: the team doc is owner-only, so a manager's mirror write was denied while
 * her public write succeeded, and the cutoff she had just set was enforced on the
 * public page and nowhere else (UX-6). See
 * packages/functions/src/booking/bookingSettings.ts.
 */
export interface BookingSettings {
  flowType: 'activity-first' | 'date-first'
  windowMonths: number
  /** LEGACY. Superseded by `contactFields`; read only as a fallback, and only
   *  through `resolveBookingContactFields`. Never read it directly. */
  showPhone: boolean
  /** Contact fields the book form collects team-wide. An activity's own list
   *  EXTENDS this one — see `resolveBookingContactFields`. */
  contactFields?: BookingContactField[]
  showActivityDescription?: boolean
  showFitnessAppField?: boolean
  ctaUrl?: string | null
  ctaLabel?: string | null
  appointmentsEnabled?: boolean
  /** Minutes before a session's start that online booking closes. Absent/0 = no
   *  cutoff (bookable right up to start, today's behaviour). Enforced
   *  authoritatively by the booking callables — see `isPastBookingCutoff`
   *  (types/session.ts); this setting only configures the threshold. */
  cutoffMinutes?: number
  /**
   * Whether the studio uses waitlists at all — a VISIBILITY switch, not an
   * enforcement one.
   *
   * Off (and absent, the default) hides the per-activity waitlist toggle, so a
   * new studio never meets the concept while setting up its first class. Most
   * will never want a queue, and the ones who do go looking for it.
   *
   * It deliberately does NOT close queues that already exist: an activity keeps
   * its stored `waitlistEnabled`, and people already waiting keep their place
   * and their offers. Turning this off declutters the authoring surface; it does
   * not strand somebody who is third in line. Same shape as the plan gate on the
   * same control, and as the plugin gates in connect/pluginGate.test.ts.
   */
  waitlistEnabled?: boolean
  /** How long a waitlist offer stays claimable, in minutes. Absent = 120.
   *  It is a MAXIMUM, not a guarantee: the claim window is also clamped by the
   *  booking cutoff and the session start, and an offer is simply not made when
   *  what survives that clamp is too short to reach checkout. */
  waitlistClaimMinutes?: number
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
  // Which organisation this studio belongs to. Public surfaces need it to list
  // the parent org's published events alongside the studio's own — an org event
  // has no teamId, so a teamId query can never find it. Null when independent.
  org_id?: string | null
  links?: TeamLink[]
  sport_type?: string
  profileImage?: string
  heroImage?: string
  socialLinks?: SocialLink[]
  bioLinkTheme?: BioLinkTheme
  bioLinkAccentColor?: string
  bioLinkBackground?: BioLinkBackground
  bookingSettings?: BookingSettings
  /** Opt-in custom field definitions the public book form may render — only
   *  those flagged `publicOnBookingForm`. See CustomFieldDefinition. */
  publicCustomFields?: PublicCustomFieldDefinition[]
  // Team-wide cancellation policy shown on public booking pages and appended to
  // confirmation emails when the activity has no `cancellationPolicy` of its
  // own. Denormalized by syncTeamPublicProfile from
  // teams/{id}.settings.bookingCancellationPolicy (owner-editable, same home as
  // the existing bookingConfirmationInstructions default).
  bookingCancellationPolicy?: string
  // The no-show policy's PUBLIC TERMS — the fee and the number of strikes that
  // triggers it, denormalized by syncTeamPublicProfile from
  // teams/{id}.settings.noShowPolicy via resolveNoShowPolicy.
  //
  // This is here because it is the only booking money a visitor can incur AFTER
  // they commit: `markNoShowBookings` auto-flips an un-checked-in `fromBioLink`
  // booking to 'no_show', and at the threshold `processNoShowStrike` creates a
  // real PolicyFee and emails a payment link. Telling somebody about that only
  // once they owe it is the defect this field exists to close.
  //
  // ABSENT/NULL MEANS OFF — `enabled` is deliberately not mirrored, so there is
  // one way for a public surface to ask the question and no way to read a fee
  // off a disabled policy. Nothing private here: the fee and the threshold are
  // terms the visitor is subject to.
  noShowPolicy?: { feeAmount: number; threshold: number } | null
  // Opt-in coach roster (name + optional photo), maintained by
  // syncTeamCoachesPublicProfile when `public_coaches_enabled` is true. Consumed by
  // the organization website's coaches section. Absent/empty ⇒ not opted in.
  coaches?: PublicCoach[]
  // Denormalized from teams/{id}.plan by syncTeamPublicProfile — true on the
  // free plan, where the bio-link shows a "Powered by Linyup" badge. The bio-link
  // must never read teams/, so the flag lives here.
  showBranding?: boolean
  // Whether the studio can actually BE PAID online right now — its Stripe
  // Connect account is chargeable AND the operator kill-switch is not down.
  // Computed by syncTeamPublicProfile from the same two facts
  // `loadEnabledTeam` + `requireChargeableAccount` enforce server-side
  // (packages/functions/src/connect/access.ts), so the public surface and the
  // callable cannot disagree about whether a checkout would open.
  //
  // It is here because a public surface may not read teams/, and it exists so
  // that A DOOR NOBODY CAN PAY THROUGH IS NOT OFFERED: the drop-in door, the
  // priced trial, the shop. It is NOT a "this studio is closed" flag — free
  // and members-only doors are governed by their own rules and stay open when
  // this is false. ABSENT/FALSE means cannot charge (fail closed): a profile
  // written before this field existed advertises no priced door until its next
  // sync, which is the safe direction.
  payments_enabled?: boolean
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
  // Documents the studio attached to the signup consent checkbox. Denormalized by
  // syncTeamPublicProfile from the published + public documents named in
  // `teams/{id}/settings/documents` (TeamDocumentsSettings) — read through
  // resolveSignupDocumentIds, which still falls back to the retired
  // installed_plugins/documents.config for un-migrated teams — so the ANONYMOUS
  // signup form can render consent links from one world-readable doc (never a
  // private team subcollection, never the root `documents` collection).
  //
  // `documentId` and `version` are what turn the signup tick into a REAL
  // acceptance. Before waivers, the form sent `version: ''` for every document
  // and the server wrote it into an advisory blob nothing read — a consent
  // record that recorded nothing. `completeSignup` now writes a ledger event per
  // document, and it needs the id (to find the document without trusting a
  // client-supplied slug) and the version the visitor was ACTUALLY SHOWN (to
  // avoid recording a signature against text published a minute later).
  // `version: null` marks a document published before versioning existed and not
  // yet covered by scripts/backfill-document-versions.ts — no ledger row is
  // written for one, because there is nothing to pin it to.
  signup_documents?: Array<{
    documentId: string
    slug: string
    title: string
    kind: DocumentKind
    version: number | null
  }>
  // Whether this team's PUBLIC pages may be indexed by search engines. Computed by
  // syncTeamPublicProfile from `publicPagesIndexable(team)`; denormalized because
  // the pages that need it are rendered from public_profile alone and must not
  // read the private team doc. See the predicate for why a trial reads as
  // not-indexable.
  public_pages_indexable?: boolean
  // The team's required waivers, SUMMARY ONLY (id, slug, title, version, minors
  // flag) — never the body: this document is served by an
  // unauthenticated collection-group read, so anything put here is
  // world-readable by anyone. Computed by syncTeamPublicProfile FROM
  // teams/{id}/waiver_policy/current.
  //
  // IT IS A RENDERING HINT AND NEVER A DECISION. The public surface calls
  // resolveWaiverRequirement if and only if this list is non-empty, so a tenant
  // with no waiver pays zero extra round-trips on the acquisition path; the
  // AUTHORIZATION answer always comes from the policy document, which fails
  // closed. A briefly-stale empty list therefore degrades to a server refusal
  // the surface can act on, never to a compliance hole — and the publish path
  // touches the team document in the same transaction so it is never stale by
  // more than one sync.
  required_waivers?: PublicRequiredWaiver[]
  // Denormalized from teams/{id}.settings.space.signup_nudge (absent ⇒ true): whether
  // the Space shows the "complete your signup" reminder to contacts who haven't
  // finished the full registration. The Space only ever reads public_profile.
  space_signup_nudge?: boolean
  // The team-wide default answer to "how do I get it?" for a product sale,
  // denormalized by syncTeamPublicProfile from
  // teams/{id}.settings.productCollectionNote (owner-editable, the same home and
  // the same shape as bookingCancellationPolicy above).
  //
  // Public for the same reason that one is: it is shown BEFORE the buyer pays,
  // on a surface that reads public_profile alone. The per-product override
  // travels on the mirrored product entry (`products[].collectionNote`); the
  // shop resolves the pair through `resolveProductCollectionNote` so that the
  // card, the checkout modal and the receipt cannot disagree.
  productCollectionNote?: string | null
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
