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
  plan: SaasPlan | null
  isLoading: boolean
  isTrialing: boolean
  isActive: boolean
  /** True when the team has an active plan (trial counts) */
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

  const isTrialing = status === 'trial'
  const isActive = status === 'active'
  const hasAccess = isTrialing || isActive

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
