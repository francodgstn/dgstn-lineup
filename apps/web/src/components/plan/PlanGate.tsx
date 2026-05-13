'use client'

import { usePlan } from '@/hooks/usePlan'
import type { SaasPlan, PlanFeature } from '@lineup/shared'
import { PLAN_ORDER } from '@lineup/shared'

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

const PLAN_LABELS: Record<SaasPlan, string> = {
  coach: 'Coach',
  club: 'Club',
  organization: 'Organization',
}

function UpgradePrompt({ requiredPlan }: { requiredPlan: SaasPlan }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium text-foreground">
        Available on the <span className="font-semibold">{PLAN_LABELS[requiredPlan]}</span> plan
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Upgrade to unlock this feature
      </p>
    </div>
  )
}

export function PlanGate({ minPlan, feature, children, fallback }: PlanGateProps) {
  const { plan, isLoading, hasAccess, isAtLeast, hasFeature, minimumPlanFor } = usePlan()

  if (isLoading) return null

  // Resolve the required plan for the fallback label
  const requiredPlan: SaasPlan =
    minPlan ?? (feature ? minimumPlanFor(feature) : PLAN_ORDER[0])

  // No plan at all (shouldn't happen in practice — trial is always set on signup)
  if (!plan || !hasAccess) {
    return <>{fallback ?? <UpgradePrompt requiredPlan={requiredPlan} />}</>
  }

  const allowed =
    (minPlan ? isAtLeast(minPlan) : true) &&
    (feature ? hasFeature(feature) : true)

  if (!allowed) {
    return <>{fallback ?? <UpgradePrompt requiredPlan={requiredPlan} />}</>
  }

  return <>{children}</>
}
