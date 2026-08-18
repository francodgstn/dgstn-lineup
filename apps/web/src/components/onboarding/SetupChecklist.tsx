'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import {
  Check,
  ChevronDown,
  ChevronRight,
  X,
  Rocket,
  AlertTriangle,
  PartyPopper,
} from 'lucide-react'
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
/**
 * The checklist keeps its 3% primary wash and NOTHING ELSE. `ring-0` drops the
 * default card ring, so the tint is the whole signal — one tinted block beside
 * the section header bands, which use the same token.
 *
 * The `border-primary/30` that used to sit here PAINTED NOTHING. Tailwind v4
 * preflight sets `border: 0 solid` and no width utility was ever applied, so it
 * only ever set a colour on a zero-width border; what this card actually looked
 * like was the flat wash. Do NOT "fix" that by adding a border width — that
 * would be a new decision, not a repair.
 */
/**
 * COMPACT BY DEFAULT. It cost 110px — the first 110px of the studio's best
 * band — to say something a line can say. Franco: "It does [belong on the first
 * screen], as the studio can close it, but should be rather smaller."
 *
 * So it stays first and it stays for everyone (dismissal is the studio's lever,
 * and gating it on completeness would be a second, invisible one). What changed
 * is what it spends: ONE ROW — where you are, what is next, and the two
 * controls — with the full list one click away. The tint does the "this is a
 * thing" work, so the row needs no other chrome; `py-0` hands the whole box to
 * `CardContent`'s `p-3`.
 *
 * `sessionsNotActuallyBookable` renders OUTSIDE the collapsed region on
 * purpose. It is not a setup step, it is a defect notice — one of the few things
 * on this page a studio can act on today — and a fold that can hide it is the
 * one failure this compaction could have introduced.
 */
const CHECKLIST_SHELL = 'bg-primary/[0.03] ring-0 py-0'

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
  const [expanded, setExpanded] = useState(false)

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
      <Card data-tour="setup-checklist" className={CHECKLIST_SHELL}>
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PartyPopper className="h-4 w-4" />
          </div>
          <p className="min-w-0 flex-1 text-sm font-semibold leading-tight">
            {t('setup.doneTitle')}
            <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">
              {t('setup.doneBody')}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={'/public-page' as Route}
              className="rounded-md border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
            >
              {t('setup.doneAction')}
            </Link>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t('setup.doneDismiss')}
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // The one step the studio should do next — required steps first, because an
  // optional one is never what "next" means.
  const nextStep = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done)

  return (
    <Card data-tour="setup-checklist" className={CHECKLIST_SHELL}>
      <CardContent className="p-3">
        {/* ── THE ROW: where you are, what is next, and the two controls ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Rocket className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold leading-tight">
            {t('setup.title')}
            <span className="ml-2 hidden font-normal text-muted-foreground lg:inline">
              {t('setup.subtitle')}
            </span>
          </p>

          <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(requiredDone / requiredTotal) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {t('setup.progress', { done: requiredDone, total: requiredTotal })}
          </span>

          {nextStep && !expanded && (
            <button
              type="button"
              onClick={() => router.push(nextStep.href as Route)}
              className="ml-auto inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
            >
              <span className="text-muted-foreground">{t('setup.next')}</span>
              <span className="truncate">
                {t(`setup.steps.${nextStep.key as SetupStepKey}.label`)}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? t('setup.hideSteps') : t('setup.showSteps')}
            className={`shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground ${
              nextStep && !expanded ? '' : 'ml-auto'
            }`}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('setup.dismiss')}
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* UX-2 interim, and it lives OUT HERE. The sessions step can report
            "done" for a class nobody on earth can book (existence-only
            completion + allowBooking defaulting off); that is a defect notice,
            not a step, so collapsing the list must never take it with it. */}
        {sessionsNotActuallyBookable && (
          <button
            type="button"
            onClick={() =>
              router.push(
                (nextUnbookableSessionId
                  ? `/sessions/${nextUnbookableSessionId}`
                  : '/schedule') as Route
              )
            }
            className="mt-2 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('setup.sessionsNotBookableWarning')}</span>
          </button>
        )}

        {/* Steps — one click away, not 110px away. */}
        <ul className={`mt-3 space-y-1 ${expanded ? '' : 'hidden'}`}>
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
