'use client'

import { Lock } from 'lucide-react'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal } from '@/contexts/UpgradeModalContext'
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

function UpgradePrompt({ minPlan, feature }: { minPlan: SaasPlan; feature?: PlanFeature }) {
  const { openUpgradeModal } = useUpgradeModal()
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <Lock className="h-5 w-5 mx-auto mb-2 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">
        This feature requires a higher plan
      </p>
      <button
        onClick={() => openUpgradeModal({ minPlan, feature })}
        className="mt-2 text-xs text-primary hover:underline"
      >
        See upgrade options
      </button>
    </div>
  )
}

export function PlanGate({ minPlan, feature, children, fallback }: PlanGateProps) {
  const { plan, isLoading, hasAccess, isAtLeast, hasFeature, minimumPlanFor } = usePlan()

  if (isLoading) return null

  const requiredPlan: SaasPlan =
    minPlan ?? (feature ? minimumPlanFor(feature) : PLAN_ORDER[0])

  if (!plan || !hasAccess) {
    return <>{fallback ?? <UpgradePrompt minPlan={requiredPlan} feature={feature} />}</>
  }

  const allowed =
    (minPlan ? isAtLeast(minPlan) : true) &&
    (feature ? hasFeature(feature) : true)

  if (!allowed) {
    return <>{fallback ?? <UpgradePrompt minPlan={requiredPlan} feature={feature} />}</>
  }

  return <>{children}</>
}
