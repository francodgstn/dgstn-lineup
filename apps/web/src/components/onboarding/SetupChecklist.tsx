'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'
import type { Route } from 'next'
import { Check, ChevronRight, X, Rocket } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSetupChecklist, type SetupStepKey } from '@/hooks/useSetupChecklist'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Phase 5 (activation) of the onboarding initiative: a data-driven setup
 * checklist shown at the top of the dashboard. Each step auto-completes from
 * real data; the card hides once every required step is done, or when an owner
 * dismisses it (persisted on the team doc so co-managers don't see it again).
 */
export function SetupChecklist() {
  const t = useTranslations('Onboarding')
  const router = useRouter()
  const { currentTeamId, team, teamRole } = useAuth()
  const { steps, requiredDone, requiredTotal, allRequiredDone, loading } = useSetupChecklist(
    currentTeamId,
    team
  )
  // Local dismissal for non-owners (who can't write the team doc) and instant feedback.
  const [localDismissed, setLocalDismissed] = useState(false)

  const dismissed = team?.setup_dismissed === true || localDismissed

  // Hide until loaded, once everything required is done, or when dismissed.
  if (loading || allRequiredDone || dismissed) return null

  async function handleDismiss() {
    setLocalDismissed(true)
    // Only owners may update the team doc (Firestore rules); persist for them.
    if (currentTeamId && teamRole === 'owner') {
      try {
        await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), { setup_dismissed: true })
      } catch {
        /* non-fatal: card already hidden locally */
      }
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Rocket className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold leading-tight">{t('setup.title')}</p>
              <p className="text-sm text-muted-foreground">{t('setup.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('setup.dismiss')}
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress */}
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(requiredDone / requiredTotal) * 100}%` }}
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {t('setup.progress', { done: requiredDone, total: requiredTotal })}
          </span>
        </div>

        {/* Steps */}
        <ul className="mt-4 space-y-1">
          {steps.map((step) => (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => router.push(step.href as Route)}
                className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60 transition-colors"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    step.done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30 text-transparent'
                  }`}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`text-sm font-medium ${step.done ? 'text-muted-foreground line-through' : ''}`}>
                    {t(`setup.steps.${step.key as SetupStepKey}.label`)}
                    {step.optional && (
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground/70">
                        ({t('setup.optional')})
                      </span>
                    )}
                  </span>
                  {!step.done && (
                    <span className="block text-xs text-muted-foreground truncate">
                      {t(`setup.steps.${step.key as SetupStepKey}.desc`)}
                    </span>
                  )}
                </span>
                {!step.done && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
