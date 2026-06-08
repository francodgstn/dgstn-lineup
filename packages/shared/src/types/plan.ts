import type { SaasPlan } from './team'

// Ordered from lowest to highest — used for >= comparisons
export const PLAN_ORDER: SaasPlan[] = ['coach', 'club', 'organization']

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
