'use client'

import { useAuth } from '@/contexts/AuthContext'
import {
  planIsAtLeast,
  planHasFeature,
  minimumPlanForFeature,
  type SaasPlan,
  type PlanFeature,
} from '@linyup/shared'

export interface UsePlanResult {
  /** The EFFECTIVE plan: a lapsed trial (or a legacy 'expired' team) reports
   *  'free' immediately, before the daily cron persists the downgrade. */
  plan: SaasPlan | null
  isLoading: boolean
  isTrialing: boolean
  isActive: boolean
  /** True when the team has a usable plan. Free counts — there is no walled
   *  state any more; limits are enforced per-feature instead. */
  hasAccess: boolean
  /** True if the team's plan is at least `minPlan` */
  isAtLeast: (minPlan: SaasPlan) => boolean
  /** True if the feature is available on the current plan */
  hasFeature: (feature: PlanFeature) => boolean
  /** The minimum plan required to unlock a feature */
  minimumPlanFor: (feature: PlanFeature) => SaasPlan
}

export function usePlan(): UsePlanResult {
  const { team, loading } = useAuth()

  const storedPlan = team?.plan ?? null
  const status = team?.plan_status ?? null

  // Client-side immediacy: between the trial's end and the 01:00 cron that
  // writes plan='free', treat the team as already on Free. Legacy 'expired'
  // teams (wall era) are mapped the same way until the transitional sweep
  // converts them.
  const trialEndsAtMs = team?.trial_ends_at?.toMillis?.() ?? null
  const trialLapsed =
    status === 'expired' ||
    (status === 'trial' && trialEndsAtMs != null && trialEndsAtMs < Date.now())

  const plan: SaasPlan | null = trialLapsed ? 'free' : storedPlan
  const isTrialing = status === 'trial' && !trialLapsed
  const isActive = status === 'active' || trialLapsed
  const hasAccess = isActive || isTrialing

  return {
    plan,
    isLoading: loading,
    isTrialing,
    isActive,
    hasAccess,
    isAtLeast: (minPlan) => {
      if (!plan) return false
      return planIsAtLeast(plan, minPlan)
    },
    hasFeature: (feature) => {
      if (!plan) return false
      return planHasFeature(plan, feature)
    },
    minimumPlanFor: minimumPlanForFeature,
  }
}
