'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { Check, ChevronRight, X, Rocket, AlertTriangle, PartyPopper } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCapabilities } from '@/hooks/useCapabilities'
import { setSetupDismissed } from '@/lib/onboarding'
import { useSetupChecklist, type SetupStepKey } from '@/hooks/useSetupChecklist'
import { Card, CardContent } from '@/components/ui/card'

/**
 * THE SETUP SURFACE (UX-45). A data-driven checklist at the top of the
 * dashboard; each step auto-completes from real data (`useSetupChecklist`).
 *
 * It is the only place the steps are rendered, and `teams/{id}.setup_dismissed`
 * (via `setSetupDismissed`) is the only thing that hides them. Setup used to be
 * presented in several places, each with its own dismissal model, so a studio
 * could dismiss it and still meet it two screens later:
 *
 *  - the Discover panel's "Setup" tab re-listed the same steps behind a
 *    per-BROWSER localStorage flag — deleted (the panel keeps Tips + Plugins);
 *  - the How-to page's "Setup checklist" card rendered a third copy that could
 *    never be dismissed — it is now a POINTER at this card, and the place where
 *    a dismissal can be undone.
 *
 * There is also a finish line: when every required step is done the card says
 * so once, with a control that closes it — it does not simply vanish, because a
 * surface that disappears silently never told anybody they had finished.
 */
export function SetupChecklist() {
  const t = useTranslations('Onboarding')
  const router = useRouter()
  const { currentTeamId, team } = useAuth()
  const { can } = useCapabilities()
  const {
    steps,
    requiredDone,
    requiredTotal,
    allRequiredDone,
    loading,
    sessionsNotActuallyBookable,
    nextUnbookableSessionId,
  } = useSetupChecklist(currentTeamId)
  // Local dismissal for non-owners (who can't write the team doc) and instant feedback.
  const [localDismissed, setLocalDismissed] = useState(false)

  const dismissed = team?.setup_dismissed === true || localDismissed

  async function handleDismiss() {
    setLocalDismissed(true)
    // Only owners may update the team doc (Firestore rules); persist for them.
    if (currentTeamId && can('team.settings')) {
      try {
        await setSetupDismissed(currentTeamId, true)
      } catch {
        /* non-fatal: card already hidden locally */
      }
    }
  }

  if (loading || dismissed) return null

  // The finish line. Everything required is done and nobody has closed the card
  // yet, so say it — once, with a way to put it away. The exception is UX-2's
  // interim warning: the "sessions" step completes on existence alone, so it
  // can report done for a class nobody can book. That is not a finish, and the
  // full checklist below must stay up to say why.
  if (allRequiredDone && !sessionsNotActuallyBookable) {
    return (
      <Card data-tour="setup-checklist" className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="flex flex-wrap items-center gap-3 p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PartyPopper className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{t('setup.doneTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('setup.doneBody')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={'/public-page' as Route}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              {t('setup.doneAction')}
            </Link>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t('setup.doneDismiss')}
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-tour="setup-checklist" className="border-primary/30 bg-primary/[0.03]">
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
              {/* UX-2 interim: the sessions step above can report "done" for a
                  class nobody on earth can book (existence-only completion +
                  allowBooking defaulting off). Say so, deep-linked to the
                  session so fixing it is one click. */}
              {step.key === 'sessions' && sessionsNotActuallyBookable && (
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      (nextUnbookableSessionId
                        ? `/sessions/${nextUnbookableSessionId}`
                        : step.href) as Route
                    )
                  }
                  className="mt-0.5 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t('setup.sessionsNotBookableWarning')}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
