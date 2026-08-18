'use client'

import { Lock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePlanName } from '@/hooks/usePlanName'
import { useUpgradeModal } from '@/contexts/UpgradeModalContext'
import { Button } from '@/components/ui/button'
import type { SaasPlan, PlanFeature } from '@linyup/shared'

/**
 * THE ONE WAY AN ABOVE-TIER SETTING SPEAKS (UX-42).
 *
 * Before this component the app had three answers to "you are below the tier
 * this needs", and only one of them read as an upsell:
 *
 *  1. an actionable lock — `/settings/members` invite button: lock icon, one
 *     click opens the upgrade modal (the good one);
 *  2. a DEAD-END lock — the BYO sender domain panel in
 *     `/settings/team?tab=outreach`: a lock, upsell copy, and nothing to click,
 *     so the reader is told no and left holding it;
 *  3. NO GATE AT ALL — `/settings/roles` rendered a complete, saveable Coach
 *     permission editor on a plan where a second user cannot exist.
 *
 * The rule this settles on: **a setting that is visible must be honest about
 * why it cannot be used, and the honesty must be actionable.** So the notice
 * always NAMES the plan (never "a higher plan" — the reader cannot act on a
 * comparative) and always carries the one control that can change the answer.
 * Hiding the surface entirely is still legitimate — that is navigation, not a
 * refusal — but once it renders, it renders through here.
 *
 * `variant`:
 *  - `panel`  — replaces a block of controls (default).
 *  - `inline` — sits above controls that stay visible but disabled, for a
 *     screen whose shape is itself the explanation (the roles editor).
 */
export function PlanUpgradeNotice({
  minPlan,
  feature,
  title,
  description,
  variant = 'panel',
  className = '',
}: {
  minPlan: SaasPlan
  feature?: PlanFeature
  /** Defaults to "Available on {plan}". */
  title?: string
  description?: string
  variant?: 'panel' | 'inline'
  className?: string
}) {
  const t = useTranslations('PlanGate')
  const planName = usePlanName()
  const { openUpgradeModal } = useUpgradeModal()

  const heading = title ?? t('availableOnPlan', { plan: planName(minPlan) })

  return (
    <div
      className={`rounded-lg border border-dashed p-4 ${
        variant === 'panel' ? 'sm:p-6' : ''
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{heading}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {/* When a caller supplies its own title, the plan still has to be
              named — the whole point of the notice is that the reader can act. */}
          {title && (
            <p className="text-xs text-muted-foreground">
              {t('availableOnPlan', { plan: planName(minPlan) })}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => openUpgradeModal({ minPlan, feature })}
          >
            {t('seeUpgradeOptions')}
          </Button>
        </div>
      </div>
    </div>
  )
}
