'use client'

import { useTranslations } from 'next-intl'
import { ArrowRight, Rocket } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { OPEN_SETUP_GUIDE_EVENT } from '@/components/onboarding/SetupGuide'
import type { SetupStep } from '@/hooks/useSetupChecklist'

/**
 * What the dashboard shows a studio on its FIRST day (UX-46).
 *
 * Before this, day one rendered the WHOLE dashboard — the agenda, the figures
 * strip, the finance cards, the roster breakdown and the trend charts — against
 * no data at all. Almost none of it had anything to say: empty axes, dashes and
 * zeroes, with two of the trend charts having no empty state whatsoever, so
 * they drew a flat line and read as broken. A dashboard that is blank in almost
 * every card does not say "you haven't started yet", it says "this product is
 * empty".
 *
 * ── IT ANSWERS ONE QUESTION, AND HANDS OVER FOR THE OTHER ───────────────────
 * This card used to do two jobs: explain the emptiness AND carry the work. It
 * listed four things that would appear once data existed, each with its
 * precondition, and then deep-linked the next open step — which is the same
 * one-step-with-no-overview problem the dashboard queue had (canary item 8).
 *
 * Since 2026-08-23 the work has an owner: `SetupGuide`, a minimizable overlay
 * the shell mounts on every page. So this card is down to one question — *why
 * is this page empty?* — answered in a sentence, with the progress and one
 * button that raises the guide. Four rows explaining what a dashboard is were
 * a lot of reading for somebody who has not started yet, and the studio can see
 * for themselves what appears the moment it does (Franco, 2026-08-23).
 */
export function FirstRunCard({ steps }: { steps: SetupStep[] }) {
  const t = useTranslations('Dashboard')
  const tOnb = useTranslations('Onboarding')

  const required = steps.filter((s) => !s.optional)
  const done = required.filter((s) => s.done).length
  const total = required.length
  const pct = total ? (done / total) * 100 : 0

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold leading-tight">{t('firstRunTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('firstRunSetupBody')}</p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {/* The progress rides WITH the button, not above the text: on day one
              it usually reads 0 of 5, and a zeroed bar spanning the card is the
              same "this product is empty" impression the card exists to undo. */}
          <div className="hidden items-center gap-2 sm:flex">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {tOnb('setup.progress', { done, total })}
            </span>
          </div>
          <Button onClick={() => window.dispatchEvent(new Event(OPEN_SETUP_GUIDE_EVENT))}>
            <Rocket className="h-4 w-4" />
            {tOnb('setup.title')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
