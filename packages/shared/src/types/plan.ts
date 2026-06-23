import type { SaasPlan } from './team'

// Ordered from lowest to highest — used for >= comparisons
export const PLAN_ORDER: SaasPlan[] = ['free', 'coach', 'studio', 'organization']

// Trial: new self-service teams start on a full-access Studio trial
// of this length. NOTE: plan IDs are stable machine identifiers — display names
// live in the `Plans` i18n namespace, see usePlanName().
// The trial is a flat 30 days with no opt-in extension (the old 14-day +
// one-time extension model was retired in the 2026-06 pricing overhaul).
export const TRIAL_DAYS = 30
// When the trial lapses the team is downgraded to the Free plan (see
// handleTrialLifecycle); there is no wall or data purge.

// Base subscription pricing per plan. Declarative source for scripts/stripe-sync.ts
// (the whole Stripe catalogue — plans + add-ons — lives in the repo).
// Amounts are INDICATIVE base prices in CHF/month; the authoritative amount is the
// Stripe Price for the lookup key. `stripe:sync` only *creates* missing prices —
// it never repriced an existing one unless run with --reprice.
// Lookup-key convention matches the gateway: `linyup_<plan>_monthly`.
export interface PlanPrice {
  baseMonthly: number
  /** null = the plan is never billed (free) and stripe:sync skips it. */
  stripeLookupKey: string | null
  /**
   * Included contacts. The cap counts ACTIVE (non-archived) contacts only —
   * archived contacts never count and are auto-anonymised after 2 years (see
   * the retention policy). The cap is acquisition-stage-neutral: a contact at any
   * stage (trial_booked / trial_attended / joined) counts the same — `archived_at`
   * is the sole input. null = unlimited (organisation). Over-cap behaviour is
   * per-tier and carries NO per-contact charge — see `contactOverageForPlan`.
   */
  includedContacts: number | null
}

export const PLAN_PRICING: Record<SaasPlan, PlanPrice> = {
  free: { baseMonthly: 0, stripeLookupKey: null, includedContacts: 15 },
  coach: {
    baseMonthly: 9,
    stripeLookupKey: 'linyup_coach_monthly',
    includedContacts: 50,
  },
  studio: {
    baseMonthly: 35,
    stripeLookupKey: 'linyup_studio_monthly',
    includedContacts: 250,
  },
  // Organisation is NOT flat-published: the `baseMonthly` here is the org BASE
  // fee only. The real price is base + per-studio (see ORG_PER_STUDIO /
  // orgMonthlyForStudios) and is quoted on a call ("From CHF 103 · Talk to us").
  organization: {
    baseMonthly: 79,
    stripeLookupKey: 'linyup_organization_monthly',
    includedContacts: null,
  },
}

// Free has no payment method to bill against, so its contact cap is HARD:
// manual contact creation is blocked at the limit (public bio-link submissions
// still land — the breach is the upgrade prompt). Paid tiers are never
// hard-blocked; they get a tier-specific over-cap prompt (contactOverageForPlan).
export function planHasHardContactCap(plan: SaasPlan | null): boolean {
  return plan === 'free'
}

// ─── Over-cap behaviour (NO per-contact metering) ───────────────────────────────
// When a team exceeds includedContacts the response depends on the tier — there
// is no per-head overage charge:
//   free   → hard cap, prompt to upgrade (planHasHardContactCap).
//   coach  → prompt to upgrade to Studio (grown past a solo coach).
//   studio → buy optional +N-contact blocks (STUDIO_CONTACT_BLOCK) for more
//            room, or upgrade to Organisation. Never hard-blocked mid-month.
//   org    → unlimited.
export interface ContactBlock {
  /** Contacts added per block. */
  size: number
  /** Flat CHF/month per block. */
  monthly: number
  /** Stripe Price lookup key (provisioned by scripts/stripe-sync.ts). */
  stripeLookupKey: string
}

/** Studio add-on: buy room in predictable flat blocks, not per-head. */
export const STUDIO_CONTACT_BLOCK: ContactBlock = {
  size: 250,
  monthly: 10,
  stripeLookupKey: 'linyup_studio_contact_block_monthly',
}

// ─── Organisation pricing (base + per-studio, sales-led) ────────────────────────
// Organisation is NOT flat-published and NOT self-serve checkout: it's quoted on
// a call ("From CHF 103 · Talk to us"). The total is a base fee
// (PLAN_PRICING.organization.baseMonthly) plus a per-studio fee, with a
// 2-studio minimum. The base fee is deliberate — it makes the org wrapper cost
// something, so unrelated studios can't group up purely to undercut individual
// Studio plans. Stripe models this as two recurring items: the org base price
// (PLAN_PRICING.organization.stripeLookupKey) at quantity 1, plus ORG_PER_STUDIO
// at quantity = number of studios. Eligibility (common ownership / a single
// federating body) and the exact quote are handled by sales, not in code.
export const ORG_MIN_STUDIOS = 2

export const ORG_PER_STUDIO: { monthly: number; stripeLookupKey: string } = {
  monthly: 12,
  stripeLookupKey: 'linyup_organization_studio_monthly',
}

/** Monthly total for an organisation with `studios` studios (min enforced). */
export function orgMonthlyForStudios(studios: number): number {
  const n = Math.max(ORG_MIN_STUDIOS, Math.floor(studios) || 0)
  return PLAN_PRICING.organization.baseMonthly + n * ORG_PER_STUDIO.monthly
}

/** The public "From CHF X" entry price (the 2-studio minimum) — e.g. 103. */
export function orgPriceFrom(): number {
  return orgMonthlyForStudios(ORG_MIN_STUDIOS)
}

export type ContactOverage =
  | { kind: 'hard' } // free: blocked, upgrade
  | { kind: 'upgrade'; to: SaasPlan } // coach: prompt next tier
  | { kind: 'block'; block: ContactBlock } // studio: buy blocks (or upgrade)
  | { kind: 'unlimited' } // organisation

export function contactOverageForPlan(plan: SaasPlan | null): ContactOverage {
  switch (plan) {
    case 'coach':
      return { kind: 'upgrade', to: 'studio' }
    case 'studio':
      return { kind: 'block', block: STUDIO_CONTACT_BLOCK }
    case 'organization':
      return { kind: 'unlimited' }
    default:
      return { kind: 'hard' } // free / unknown
  }
}

// ─── Contact usage (cap meter) ──────────────────────────────────────────────────
// Usage is tracked and surfaced in the UI. Counting basis is ACTIVE
// (non-archived, non-deleted) contacts; archived contacts never count. What the
// app does at/over the cap is tier-specific (contactOverageForPlan) — only Free
// hard-blocks.

export interface ContactUsage {
  used: number
  included: number | null // null = unlimited
  isUnlimited: boolean
  remaining: number | null
  overBy: number
  atOrOverLimit: boolean
  percent: number // 0..100 for the meter (clamped)
}

export function contactUsageForPlan(plan: SaasPlan | null, used: number): ContactUsage {
  const included = plan ? PLAN_PRICING[plan].includedContacts : null
  if (included == null) {
    return {
      used,
      included: null,
      isUnlimited: true,
      remaining: null,
      overBy: 0,
      atOrOverLimit: false,
      percent: 0,
    }
  }
  return {
    used,
    included,
    isUnlimited: false,
    remaining: Math.max(0, included - used),
    overBy: Math.max(0, used - included),
    atOrOverLimit: used >= included,
    percent: included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 100,
  }
}

export type PlanFeature =
  // Coach
  | 'contacts'
  | 'sessions'
  | 'public_booking'
  | 'qr_checkin'
  | 'public_profile'
  | 'signup_forms'
  | 'basic_dashboard'
  | 'basic_alerts'
  | 'subscriptions'
  | 'payment_tracking'
  | 'goals'
  | 'coaching'
  // Studio
  | 'student_app'
  | 'gamification'
  | 'outreach_templates'
  | 'automation_flows'
  | 'advanced_alerts'
  | 'advanced_dashboard'
  | 'ai_insights'
  | 'multiple_managers'
  | 'referral_program'
  | 'courses'
  // Organization
  | 'multi_team'
  | 'central_admin'
  | 'unified_data'
  | 'cross_team_events'
  | 'cross_team_messaging'
  | 'api_access'
  | 'advanced_permissions'

// NOTE: features delivered by plugins (gamification, referral_program, courses,
// ai_insights) are now gated by plugin INSTALL state, not these flags — see
// pluginAccessForPlan + useInstalledPlugins. The flags remain for reference /
// non-UI logic; do not re-introduce feature-flag gates for plugin features.
export const PLAN_FEATURES: Record<SaasPlan, PlanFeature[]> = {
  // Free = the full Coach feature set. The tier is differentiated by limits
  // (10-contact hard cap, single user, no plugin add-ons, bio-link branding),
  // not by feature flags.
  free: [
    'contacts',
    'sessions',
    'public_booking',
    'qr_checkin',
    'public_profile',
    'signup_forms',
    'basic_dashboard',
    'basic_alerts',
    'subscriptions',
    'payment_tracking',
    'goals',
    'coaching',
  ],
  coach: [
    'contacts',
    'sessions',
    'public_booking',
    'qr_checkin',
    'public_profile',
    'signup_forms',
    'basic_dashboard',
    'basic_alerts',
    'subscriptions',
    'payment_tracking',
    'goals',
    'coaching',
    // The member app is available from Coach up (a basic booking/check-in portal
    // on Coach, enriched by add-ons). Never offered on Free. (2026-06 overhaul.)
    'student_app',
  ],
  studio: [
    'contacts',
    'sessions',
    'public_booking',
    'qr_checkin',
    'public_profile',
    'signup_forms',
    'basic_dashboard',
    'basic_alerts',
    'subscriptions',
    'payment_tracking',
    'goals',
    'coaching',
    'student_app',
    'gamification',
    'outreach_templates',
    'automation_flows',
    'advanced_alerts',
    'advanced_dashboard',
    'ai_insights',
    'multiple_managers',
    'referral_program',
    'courses',
    // API access is available from Studio up (2026-06). NOTE: this is currently a
    // declarative flag only — the API itself is not built yet, so there is no
    // runtime gate to relax; minimumPlanForFeature('api_access') now returns 'studio'.
    'api_access',
  ],
  organization: [
    'contacts',
    'sessions',
    'public_booking',
    'qr_checkin',
    'public_profile',
    'signup_forms',
    'basic_dashboard',
    'basic_alerts',
    'subscriptions',
    'payment_tracking',
    'goals',
    'coaching',
    'student_app',
    'gamification',
    'outreach_templates',
    'automation_flows',
    'advanced_alerts',
    'advanced_dashboard',
    'ai_insights',
    'multiple_managers',
    'referral_program',
    'courses',
    'multi_team',
    'central_admin',
    'unified_data',
    'cross_team_events',
    'cross_team_messaging',
    'api_access',
    'advanced_permissions',
  ],
}

// ─── Plugin packaging ─────────────────────────────────────────────────────────
// Studio/Org include all internal plugins. Coach can activate a curated subset
// (plugins with an `addon`) as paid monthly add-ons; non-curated plugins are
// upgrade-locked for coaches. See docs/product-strategy-addons-proposal.md.

export type PluginAccess =
  | { kind: 'included' }
  | { kind: 'addon'; priceMonthly: number }
  | { kind: 'upgrade'; minPlan: SaasPlan }

// Minimal shape needed to decide access — satisfied by PluginManifest.
interface PluginAccessInput {
  minPlan: SaasPlan
  addon?: { coachPriceMonthly: number; stripeLookupKey: string }
}

export function pluginAccessForPlan(
  manifest: PluginAccessInput,
  plan: SaasPlan | null
): PluginAccess {
  if (plan === 'studio' || plan === 'organization') return { kind: 'included' }
  // Free: no add-ons (nothing to bill against) — everything is upgrade-locked.
  if (plan === 'free') return { kind: 'upgrade', minPlan: 'coach' }
  // Coach (or unknown/trialing coach):
  //  • plugins standard from Coach (minPlan ≤ coach, no paid add-on) → included
  //    (e.g. Contact Groups, Custom Fields — de-pettified in the 2026-06 pricing
  //    overhaul; they install client-side with no charge).
  //  • curated paid add-ons → addon (Website, Online Courses, Products,
  //    Gamification, Referral).
  //  • Studio-only plugins → upgrade.
  if (!manifest.addon && planIsAtLeast('coach', manifest.minPlan)) return { kind: 'included' }
  if (manifest.addon) return { kind: 'addon', priceMonthly: manifest.addon.coachPriceMonthly }
  return { kind: 'upgrade', minPlan: manifest.minPlan }
}

export function planIsAtLeast(current: SaasPlan, minimum: SaasPlan): boolean {
  return PLAN_ORDER.indexOf(current) >= PLAN_ORDER.indexOf(minimum)
}

export function planHasFeature(plan: SaasPlan, feature: PlanFeature): boolean {
  return PLAN_FEATURES[plan].includes(feature)
}

// The minimum plan required for a given feature
export function minimumPlanForFeature(feature: PlanFeature): SaasPlan {
  for (const plan of PLAN_ORDER) {
    if (PLAN_FEATURES[plan].includes(feature)) return plan
  }
  return 'organization'
}

// Affiliations (the belonging axis: club / federation licence / grading) are an
// opt-in surface for Verein-structured and licence-bound clubs. Available from the
// Studio tier up, off by default per team (see Team.affiliations_enabled). Phase 2.
export function planSupportsAffiliations(plan: SaasPlan | null): boolean {
  return plan === 'studio' || plan === 'organization'
}
