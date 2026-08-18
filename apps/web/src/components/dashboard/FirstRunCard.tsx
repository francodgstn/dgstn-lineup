'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { ArrowRight, BarChart3, Banknote, CalendarClock, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
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
 * So on day one the dashboard is the setup checklist, this card and the
 * discovery panel. This card is the honest version of what it replaces: it
 * NAMES what will appear and what has to happen first, and points at the next
 * open step rather than at a skeleton.
 */
export function FirstRunCard({ steps }: { steps: SetupStep[] }) {
  const t = useTranslations('Dashboard')
  const tOnb = useTranslations('Onboarding')

  const nextStep = steps.find((s) => !s.done) ?? null

  const rows: { icon: React.ElementType; key: 'agenda' | 'figures' | 'money' | 'trends' }[] = [
    { icon: CalendarClock, key: 'agenda' },
    { icon: Users, key: 'figures' },
    { icon: Banknote, key: 'money' },
    { icon: BarChart3, key: 'trends' },
  ]

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col p-5">
        <p className="font-semibold leading-tight">{t('firstRunTitle')}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('firstRunBody')}</p>

        <ul className="mt-4 flex-1 space-y-2.5">
          {rows.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t(`firstRun_${key}_title` as Parameters<typeof t>[0])}
                </span>{' '}
                — {t(`firstRun_${key}_body` as Parameters<typeof t>[0])}
              </p>
            </li>
          ))}
        </ul>

        {nextStep && (
          <Link
            href={nextStep.href as Route}
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {tOnb(`setup.steps.${nextStep.key}.label` as Parameters<typeof tOnb>[0])}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
