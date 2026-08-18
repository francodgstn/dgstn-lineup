'use client'

import { usePlan } from '@/hooks/usePlan'
import { PlanUpgradeNotice } from '@/components/plan/PlanUpgradeNotice'
import type { SaasPlan, PlanFeature } from '@linyup/shared'
import { PLAN_ORDER } from '@linyup/shared'

interface PlanGateProps {
  /** Require at least this plan tier */
  minPlan?: SaasPlan
  /** Require a specific feature */
  feature?: PlanFeature
  /** Rendered when access is granted */
  children: React.ReactNode
  /** Rendered when access is denied — defaults to upgrade prompt */
  fallback?: React.ReactNode
}

// The default refusal is the shared one (UX-42) — it names the plan and carries
// the control that changes the answer. Never re-inline a lock panel here.
export function PlanGate({ minPlan, feature, children, fallback }: PlanGateProps) {
  const { plan, isLoading, hasAccess, isAtLeast, hasFeature, minimumPlanFor } = usePlan()

  if (isLoading) return null

  const requiredPlan: SaasPlan =
    minPlan ?? (feature ? minimumPlanFor(feature) : PLAN_ORDER[0])

  if (!plan || !hasAccess) {
    return <>{fallback ?? <PlanUpgradeNotice minPlan={requiredPlan} feature={feature} />}</>
  }

  const allowed =
    (minPlan ? isAtLeast(minPlan) : true) &&
    (feature ? hasFeature(feature) : true)

  if (!allowed) {
    return <>{fallback ?? <PlanUpgradeNotice minPlan={requiredPlan} feature={feature} />}</>
  }

  return <>{children}</>
}
