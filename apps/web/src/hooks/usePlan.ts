'use client'

import { useAuth } from '@/contexts/AuthContext'
import {
  planIsAtLeast,
  planHasFeature,
  minimumPlanForFeature,
  trialHasExpired,
  type SaasPlan,
  type PlanFeature,
} from '@linyup/shared'

export interface UsePlanResult {
  plan: SaasPlan | null
  isLoading: boolean
  isTrialing: boolean
  isActive: boolean
  /** Trial has lapsed (or status is 'expired') — app should be walled. */
  isExpired: boolean
  /** True when the team has an active plan (live trial counts; expired does not) */
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

  const plan = team?.plan ?? null
  const status = team?.plan_status ?? null

  const trialEndsAtMs = team?.trial_ends_at?.toMillis?.() ?? null
  const isExpired = trialHasExpired(status, trialEndsAtMs, Date.now())
  const isTrialing = status === 'trial' && !isExpired
  const isActive = status === 'active'
  const hasAccess = isActive || isTrialing

  return {
    plan,
    isLoading: loading,
    isTrialing,
    isActive,
    isExpired,
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
