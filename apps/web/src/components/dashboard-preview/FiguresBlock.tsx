'use client'

/**
 * THE SNAPSHOT — six figures, two columns, top right.
 *
 * ── WHERE THIS CAME FROM ─────────────────────────────────────────────────────
 *
 * The incumbent's six: four stats (engaged, bookings ahead, subscribed,
 * affiliation) plus the two money figures (revenue, unassigned), each with the
 * SUBTITLE AND NOTE that tell it apart from its neighbour. That pairing is the
 * point of the block and the reason it is worth six cells: a bare "84" beside a
 * bare "96" is the confusion this page has now failed to fix twice.
 *
 * It replaced a four-fact column whose subscription/affiliation pair was
 * explained by a proportion bar. The bar is GONE by decision (Franco,
 * 2026-08-18) — he has seen both and prefers the subtitles carrying it, which
 * is what the incumbent always did. Do not reintroduce it: the two subtitles
 * below (`figSubscribedSub`, `figAffiliationSub`) are now the only thing
 * distinguishing those two numbers, so they are load-bearing copy, not
 * decoration, and they may not be shortened into labels.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────
 *
 * Value and subtitle share a BASELINE, with the note under the subtitle. That
 * is the incumbent's own figure geometry and it is what makes six of these fit
 * a ~417px column: a caption-over-number-over-two-lines cell costs 85px, this
 * one costs ~56px and wraps to ~72px only for a long money value.
 *
 * Unframed, on the background — the page's second material. It sits opposite a
 * framed agenda and does NOT take the accent frame: the frame marks work, not
 * position and not importance.
 *
 * "Snapshot" stays set at `text-2xl font-black`, the loudest WORD on the page,
 * in a different channel from the loudest NUMBERS beneath it. It is the only
 * thing carried over from the column this block replaced.
 *
 * DEGRADATION IS BY SUBTRACTION. The two money figures are Studio-tier, so Free
 * and Coach get a four-figure block — two rows instead of three, and no upgrade
 * nag in a block meant to be read in one glance.
 */

import type React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import {
  Banknote,
  BookOpen,
  CreditCard,
  TrendingDown,
  TrendingUp,
  UserRoundX,
  Users,
} from 'lucide-react'
import type { Contact, SubscriptionType } from '@linyup/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlan } from '@/hooks/usePlan'
import { useMonthlyRevenue } from '@/hooks/useMonthlyRevenue'
import { useAffiliationTerm } from '@/hooks/useAffiliationTerm'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { formatMoneyMinor } from '@/lib/payments'
import { cn } from '@/lib/utils'
import {
  startOfWeek,
  useUnassignedPaymentCount,
  usePreviewUpcomingSessions,
} from './preview-data'

/**
 * One figure: caption, then a value sharing a baseline with its subtitle, then
 * the note. `flex-wrap` is what lets a long money value drop its subtitle to a
 * second line instead of overflowing a ~196px column.
 */
function Figure({
  icon: Icon,
  caption,
  value,
  subtitle,
  note,
  loading,
  href,
}: {
  icon: React.ElementType
  caption: string
  value: React.ReactNode
  subtitle: React.ReactNode
  note?: React.ReactNode
  loading?: boolean
  href: Route
}) {
  return (
    <Link href={href} className="group/figure block">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary/60" />
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {caption}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p className="text-3xl font-black leading-none tracking-tight tabular-nums transition-colors group-hover/figure:text-primary">
            {value}
          </p>
        )}
        <div className="min-w-0">
          <p className="text-xs leading-snug text-muted-foreground">{subtitle}</p>
          {!loading && note ? (
            <div className="text-[11px] leading-snug text-muted-foreground/70">{note}</div>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

function RevenueFigure({ teamId }: { teamId: string | null }) {
  const t = useTranslations('NewDashboard')
  const { data, isLoading } = useMonthlyRevenue(teamId)
  const delta = data?.deltaPercent ?? null
  const up = delta !== null && delta >= 0

  return (
    <Figure
      icon={Banknote}
      caption={t('figRevenue')}
      value={formatMoneyMinor(data?.thisMonth ?? 0, data?.currency ?? 'CHF')}
      subtitle={t('figRevenueSub')}
      loading={isLoading}
      href={'/payments' as Route}
      note={
        delta !== null ? (
          <span
            className={cn('flex items-center gap-1', up ? 'text-emerald-600' : 'text-amber-600')}
          >
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {t('figRevenueDelta', { percent: Math.abs(delta) })}
          </span>
        ) : undefined
      }
    />
  )
}

function UnassignedFigure({ teamId }: { teamId: string | null }) {
  const t = useTranslations('NewDashboard')
  const { count, isLoading } = useUnassignedPaymentCount(teamId)
  return (
    <Figure
      icon={UserRoundX}
      caption={t('figUnassigned')}
      value={count}
      subtitle={count === 0 ? t('figUnassignedEmpty') : t('figUnassignedSub')}
      loading={isLoading}
      href={'/payments' as Route}
      note={count > 0 ? <span className="text-primary">{t('figUnassignedAction')}</span> : undefined}
    />
  )
}

export function FiguresBlock({
  teamId,
  contacts,
  loading,
}: {
  teamId: string | null
  contacts: Contact[] | undefined
  loading: boolean
}) {
  const t = useTranslations('NewDashboard')
  const { isAtLeast } = usePlan()
  const affiliationTerm = useAffiliationTerm()
  const seesMoney = isAtLeast('studio')

  const { data: sessions, isLoading: sessionsLoading } = usePreviewUpcomingSessions(teamId)
  const { data: subTypes = [] } = useSubscriptionTypes(teamId)

  const live = (contacts ?? []).filter((c) => !c.archived_at)

  // ── attendance: this week, and the DIFFERENT people whose last visit was the
  // week before. Deliberately not phrased as a comparison — `last_session_at`
  // holds one date, so somebody who came both weeks appears only in this one,
  // and "vs last week" off these two counts would understate every returning
  // member. The two sets are disjoint by construction; the copy says so.
  const thisWeek = startOfWeek()
  const prevWeek = new Date(thisWeek)
  prevWeek.setDate(prevWeek.getDate() - 7)
  const lastSessionMs = (c: Contact) => {
    const ts = c.last_session_at as { toDate(): Date } | null | undefined
    return ts ? ts.toDate().getTime() : null
  }
  const engaged = live.filter((c) => {
    const ms = lastSessionMs(c)
    return ms !== null && ms >= thisWeek.getTime()
  }).length
  const engagedPrev = live.filter((c) => {
    const ms = lastSessionMs(c)
    return ms !== null && ms >= prevWeek.getTime() && ms < thisWeek.getTime()
  }).length

  // ── what is booked on the sessions ahead
  const booked = (sessions ?? []).reduce((sum, s) => sum + (s.bookings_count ?? 0), 0)
  const trials = (sessions ?? []).reduce((sum, s) => sum + (s.trial_bookings_count ?? 0), 0)

  // ── subscriptions: YOUR plans, with aggregator-sourced ones counted apart.
  // A ClassPass-style type is a subscription the studio did not sell, so
  // folding it into "on one of your own plans" would make the subtitle false.
  const aggregatorIds = new Set(
    (subTypes as SubscriptionType[]).filter((s) => s.source === 'aggregator').map((s) => s.id)
  )
  const withSub = live.filter((c) => !!c.subscription_type_id)
  const internalSubs = withSub.filter((c) => !aggregatorIds.has(c.subscription_type_id!)).length
  const aggregatorSubs = withSub.length - internalSubs

  const affiliated = live.filter((c) => c.affiliation_summary?.has_active).length

  return (
    <div>
      <h2 className="font-heading mb-5 text-2xl font-black leading-none tracking-tight text-heading">
        {t('snapshotTitle')}
      </h2>

      {/* TWO COLUMNS, three rows of them at Studio (two below it). `gap-y-6`
          rather than a divider — nothing in this block is ruled off. */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-6">
        <Figure
          icon={TrendingUp}
          caption={t('figEngaged')}
          value={loading ? '' : engaged}
          subtitle={t('figEngagedSub')}
          loading={loading}
          href={'/contacts' as Route}
          note={engagedPrev > 0 ? t('figEngagedPrev', { count: engagedPrev }) : undefined}
        />
        <Figure
          icon={BookOpen}
          caption={t('figBookings')}
          value={sessionsLoading ? '' : booked}
          subtitle={t('figBookingsSub')}
          loading={sessionsLoading}
          href={'/bookings' as Route}
          note={trials > 0 ? t('figBookingsTrial', { count: trials }) : undefined}
        />
        <Figure
          icon={CreditCard}
          caption={t('figSubscribed')}
          value={loading ? '' : internalSubs}
          subtitle={t('figSubscribedSub')}
          loading={loading}
          href={'/subscriptions' as Route}
          note={aggregatorSubs > 0 ? t('figSubscribedAgg', { count: aggregatorSubs }) : undefined}
        />
        <Figure
          icon={Users}
          caption={affiliationTerm}
          value={loading ? '' : affiliated}
          subtitle={t('figAffiliationSub')}
          loading={loading}
          href={'/affiliations' as Route}
        />
        {seesMoney && (
          <>
            <RevenueFigure teamId={teamId} />
            <UnassignedFigure teamId={teamId} />
          </>
        )}
      </div>
    </div>
  )
}
