'use client'

/**
 * THE PULSE — three numbers, and the page's seam.
 *
 * It sits BELOW the working row, not above it, and that placement is the
 * argument: a studio does not open this app to read its MRR, it opens it to see
 * the day and the people waiting. The numbers are the answer to a slower
 * question — *is the business alright?* — so they close the working half of the
 * page and introduce the analytical half rather than heading it.
 *
 * Bare numbers on the background, no frames: the incumbent's second material,
 * adopted unchanged. Three of them, because three is what one glance holds.
 *
 * DEGRADATION IS BY SUBTRACTION. Money is Studio-tier, so Free and Coach get a
 * two-figure rail — a shorter page, not a holed one, and no upgrade nag in a
 * row whose job is to be read in one second.
 */

import type React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { Banknote, TrendingDown, TrendingUp, UserCheck, Users } from 'lucide-react'
import type { Contact } from '@linyup/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlan } from '@/hooks/usePlan'
import { useMonthlyRevenue } from '@/hooks/useMonthlyRevenue'
import { formatMoneyMinor } from '@/lib/payments'
import { cn } from '@/lib/utils'
import { startOfWeek } from './preview-data'

function PulseFigure({
  icon: Icon,
  caption,
  value,
  note,
  loading,
  href,
}: {
  icon: React.ElementType
  caption: string
  value: React.ReactNode
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
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="text-3xl font-black leading-none tracking-tight tabular-nums transition-colors group-hover/figure:text-primary">
          {value}
        </p>
      )}
      <div className="mt-1 h-4 text-xs text-muted-foreground">{loading ? null : note}</div>
    </Link>
  )
}

function RevenueFigure({ teamId }: { teamId: string | null }) {
  const t = useTranslations('NewDashboard')
  const { data, isLoading } = useMonthlyRevenue(teamId)
  const delta = data?.deltaPercent ?? null
  const up = delta !== null && delta >= 0

  return (
    <PulseFigure
      icon={Banknote}
      caption={t('pulseRevenue')}
      value={formatMoneyMinor(data?.thisMonth ?? 0, data?.currency ?? 'CHF')}
      loading={isLoading}
      href={'/payments' as Route}
      note={
        delta !== null ? (
          <span
            className={cn(
              'flex items-center gap-1',
              up ? 'text-emerald-600' : 'text-amber-600'
            )}
          >
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {t('pulseRevenueDelta', { percent: Math.abs(delta) })}
          </span>
        ) : (
          t('pulseRevenueNoBaseline')
        )
      }
    />
  )
}

export function PulseRail({
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
  const seesMoney = isAtLeast('studio')

  const live = (contacts ?? []).filter((c) => !c.archived_at)
  const members = live.filter((c) => c.affiliation_summary?.has_active).length
  const weekStart = startOfWeek().getTime()
  const attended = live.filter((c) => {
    const ts = c.last_session_at as { toDate(): Date } | null | undefined
    return !!ts && ts.toDate().getTime() >= weekStart
  }).length

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-4',
        seesMoney ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        // One row at `sm` and up, so an adjacent-sibling rule is safe here.
        'sm:gap-x-0 sm:[&>*+*]:border-l sm:[&>*+*]:border-border sm:[&>*+*]:pl-6',
        'sm:[&>*:not(:last-child)]:pr-6'
      )}
    >
      {seesMoney && <RevenueFigure teamId={teamId} />}
      <PulseFigure
        icon={Users}
        caption={t('pulseMembers')}
        value={loading ? '' : members}
        loading={loading}
        href={'/contacts' as Route}
        note={t('pulseMembersNote', { count: live.length })}
      />
      <PulseFigure
        icon={UserCheck}
        caption={t('pulseAttended')}
        value={loading ? '' : attended}
        loading={loading}
        href={'/bookings' as Route}
        note={t('pulseAttendedNote')}
      />
    </div>
  )
}
