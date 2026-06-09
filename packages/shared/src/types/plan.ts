import type { SaasPlan } from './team'

// Ordered from lowest to highest — used for >= comparisons
export const PLAN_ORDER: SaasPlan[] = ['coach', 'club', 'organization']

// Base subscription pricing per plan. Declarative source for scripts/stripe-sync.ts
// (the whole Stripe catalogue — plans + add-ons — lives in the repo).
// Amounts are INDICATIVE base prices in CHF/month; the authoritative amount is the
// Stripe Price for the lookup key. `stripe:sync` only *creates* missing prices —
// it never repriced an existing one unless run with --reprice.
// Lookup-key convention matches the gateway: `linyup_<plan>_monthly`.
export interface PlanPrice {
  baseMonthly: number
  stripeLookupKey: string
}

export const PLAN_PRICING: Record<SaasPlan, PlanPrice> = {
  coach:        { baseMonthly: 19,  stripeLookupKey: 'linyup_coach_monthly' },
  club:         { baseMonthly: 39,  stripeLookupKey: 'linyup_club_monthly' },
  organization: { baseMonthly: 149, stripeLookupKey: 'linyup_organization_monthly' },
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
  // Club
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
  ],
  club: [
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
// Club/Org include all internal plugins. Coach can activate a curated subset
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

export function pluginAccessForPlan(manifest: PluginAccessInput, plan: SaasPlan | null): PluginAccess {
  if (plan === 'club' || plan === 'organization') return { kind: 'included' }
  // Coach (or unknown/trialing coach): paid add-on if curated, else upgrade.
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
