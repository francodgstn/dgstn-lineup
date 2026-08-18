'use client'

// "Keep going" utilities under the How-to concepts: replay the guided tour,
// the live setup checklist (same data as the dashboard card — never dismissed
// here), a rotating tip, and a nudge to the plugin marketplace.
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Puzzle,
  RefreshCw,
  Rocket,
} from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { DynamicIcon } from '@/components/ui/icon-picker'
import { useAuth } from '@/contexts/AuthContext'
import { useSetupChecklist } from '@/hooks/useSetupChecklist'
import { START_TOUR_EVENT } from '@/components/onboarding/ProductTour'
import { TIPS } from '@/data/tips'

function UtilityCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </div>
  )
}

function TourCard() {
  const t = useTranslations('HowTo')
  return (
    <UtilityCard icon={<Compass className="h-4 w-4" />} title={t('utilities.tour.title')}>
      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
        {t('utilities.tour.body')}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 self-start"
        onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}
      >
        {t('utilities.tour.action')}
      </Button>
    </UtilityCard>
  )
}

// How many open steps to list before pointing at the rest with the progress bar.
const CHECKLIST_PREVIEW = 3

function ChecklistCard() {
  const t = useTranslations('HowTo')
  const tOnb = useTranslations('Onboarding')
  const { currentTeamId } = useAuth()
  const { steps, requiredDone, requiredTotal, allRequiredDone } = useSetupChecklist(
    currentTeamId ?? null
  )
  const open = steps.filter((s) => !s.done).slice(0, CHECKLIST_PREVIEW)

  return (
    <UtilityCard icon={<Rocket className="h-4 w-4" />} title={t('utilities.checklist.title')}>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('utilities.checklist.body')}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${requiredTotal ? (requiredDone / requiredTotal) * 100 : 0}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {tOnb('setup.progress', { done: requiredDone, total: requiredTotal })}
        </span>
      </div>
      {allRequiredDone ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-primary" />
          {t('utilities.checklist.allDone')}
        </p>
      ) : (
        <ul className="mt-2 flex-1 space-y-0.5">
          {open.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href as Route}
                className="group flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span>{tOnb(`setup.steps.${s.key}.label` as Parameters<typeof tOnb>[0])}</span>
                <ChevronRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </UtilityCard>
  )
}

function TipsCard() {
  const t = useTranslations('HowTo')
  const tDiscover = useTranslations('Discover')
  // Seed from the day so the first tip varies without being random per render.
  const [index, setIndex] = useState(() => new Date().getDate() % TIPS.length)
  const tip = TIPS[index]

  return (
    <UtilityCard
      icon={<DynamicIcon name={tip.icon} className="h-4 w-4" />}
      title={t('utilities.tips.title')}
    >
      <div className="flex-1 space-y-1">
        <p className="text-xs font-medium">
          {tDiscover(`tip_${tip.id}_title` as Parameters<typeof tDiscover>[0])}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {tDiscover(`tip_${tip.id}_body` as Parameters<typeof tDiscover>[0])}
        </p>
        {tip.href && (
          <Link
            href={tip.href as Route}
            className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline"
          >
            {tDiscover('learnMore')} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {tDiscover('tipCounter', { current: index + 1, total: TIPS.length })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setIndex((i) => (i + 1) % TIPS.length)}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {tDiscover('nextTip')}
        </Button>
      </div>
    </UtilityCard>
  )
}

function PluginsCard() {
  const t = useTranslations('HowTo')
  return (
    <UtilityCard icon={<Puzzle className="h-4 w-4" />} title={t('utilities.plugins.title')}>
      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
        {t('utilities.plugins.body')}
      </p>
      <Link
        href={'/settings/plugins' as Route}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {t('utilities.plugins.action')} <ArrowRight className="h-3 w-3" />
      </Link>
    </UtilityCard>
  )
}

export function HowToUtilities() {
  const t = useTranslations('HowTo')
  return (
    <section>
      <h2 className="text-lg font-semibold">{t('utilitiesTitle')}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TourCard />
        <ChecklistCard />
        <TipsCard />
        <PluginsCard />
      </div>
    </section>
  )
}
