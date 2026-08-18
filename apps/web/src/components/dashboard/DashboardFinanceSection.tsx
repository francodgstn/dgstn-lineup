'use client'

// Finance block on the dashboard (Studio+). Two layers, deliberately separable:
//
//  1. Payment cards — always shown. They read the payment collections directly
//     (member_payments + payment_events), so a studio taking money sees its
//     takings here whether or not the finance plugin is installed.
//  2. The finance charts — only once the finance plugin is on, because they read
//     the accounting_* collections the plugin builds. Without it they'd render an
//     empty frame, which reads as "broken" rather than "not enabled".

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { ArrowRight, Banknote, Receipt, TrendingDown, TrendingUp, UserRoundX } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMemberPayments, usePaymentEvents } from '@/hooks/useConnect'
import { useMonthlyRevenue } from '@/hooks/useMonthlyRevenue'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import {
  byoToUnified,
  connectToUnified,
  formatMoneyMinor,
  formatPaymentDate,
  mergePaymentRows,
  paymentLabel,
  type UnifiedPaymentRow,
} from '@/lib/payments'
import { FinanceTrendsSection } from '@/components/finance/FinanceTrendsSection'
import { Figure, FigureNumber, FigureRail } from '@/components/dashboard/Figure'

const RECENT_COUNT = 5

/** Money that actually arrived. The card shows an amount with no status chip, so
 * a failed or still-pending charge listed here reads as income the studio never
 * got — same rule the revenue total uses. BYO rows are always 'paid' (they exist
 * because money arrived). */
function isSettled(row: UnifiedPaymentRow): boolean {
  return row.status === 'succeeded' || row.status === 'partially_refunded' || row.status === 'paid'
}

function RevenueCard({ teamId }: { teamId: string | null }) {
  const t = useTranslations('DashboardFinance')
  const { data, isLoading } = useMonthlyRevenue(teamId)

  const delta = data?.deltaPercent ?? null
  const up = delta !== null && delta >= 0

  // Rendered through the shared figure shell, which means text-4xl — money used
  // to render at text-3xl, one step SMALLER than every other figure on the page
  // including the count of payments nobody has filed yet, so takings were the
  // smallest number on a dashboard opened to look at takings.
  return (
    <Figure title={t('revenueTitle')} icon={Banknote} href="/payments">
      <FigureNumber
        value={formatMoneyMinor(data?.thisMonth ?? 0, data?.currency ?? 'CHF')}
        subtitle={t('revenueSubtitle')}
        loading={isLoading}
        note={
          !isLoading && delta !== null ? (
            <p
              className={`flex items-center gap-1 text-xs ${up ? 'text-emerald-600' : 'text-amber-600'}`}
            >
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {t('vsLastMonth', { percent: Math.abs(delta) })}
            </p>
          ) : undefined
        }
      />
    </Figure>
  )
}

function RecentPaymentsCard({
  rows,
  isLoading,
}: {
  rows: UnifiedPaymentRow[]
  isLoading: boolean
}) {
  const t = useTranslations('DashboardFinance')
  const recent = rows.filter(isSettled).slice(0, RECENT_COUNT)

  // A CARD, because it is a bounded list you click into — not a figure. It wore
  // the figure shell (same accent frame, same caption) beside the real figures,
  // so a five-row mini-table read as a headline number.
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5">
            <Receipt className="h-4 w-4 shrink-0 text-primary/60" />
            {t('recentTitle')}
          </CardTitle>
          <Link
            href={'/payments' as Route}
            className="flex shrink-0 items-center gap-0.5 text-xs text-primary hover:underline"
          >
            {t('recentViewAll')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2 py-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : recent.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">{t('recentEmpty')}</p>
        ) : (
          <div className="space-y-1">
            {recent.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{paymentLabel(r)}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatMoneyMinor(r.amount, r.currency)}
                </span>
              </div>
            ))}
            <p className="pt-0.5 text-[10px] text-muted-foreground/60">
              {formatPaymentDate(recent[recent.length - 1].createdAt)} —{' '}
              {formatPaymentDate(recent[0].createdAt)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UnassignedCard({ rows, isLoading }: { rows: UnifiedPaymentRow[]; isLoading: boolean }) {
  const t = useTranslations('DashboardFinance')
  // Settled only: a failed charge with no contact isn't a filing task, and
  // counting it here would send the studio to /payments to "fix" a non-payment.
  const count = rows.filter((r) => isSettled(r) && !r.assigned).length

  return (
    <Figure title={t('unassignedTitle')} icon={UserRoundX} href="/payments">
      <FigureNumber
        value={count}
        subtitle={count === 0 ? t('unassignedEmpty') : t('unassignedSubtitle')}
        loading={isLoading}
        note={
          !isLoading && count > 0 ? (
            <p className="flex items-center gap-1 text-xs text-primary">
              {t('unassignedAction')}
              <ArrowRight className="h-3 w-3" />
            </p>
          ) : undefined
        }
      />
    </Figure>
  )
}

export function DashboardFinanceSection({ teamId }: { teamId: string | null }) {
  const { isInstalled } = useInstalledPlugins()

  // Same paging as the /payments page, so "recent" and "unassigned" here agree
  // with what the studio sees when it follows the card through.
  const { data: memberPayments = [], isLoading: loadingConnect } = useMemberPayments(teamId)
  const { data: paymentEvents = [], isLoading: loadingByo } = usePaymentEvents(teamId)

  const rows = useMemo(
    () => mergePaymentRows(connectToUnified(memberPayments), byoToUnified(paymentEvents)),
    [memberPayments, paymentEvents]
  )
  const isLoading = loadingConnect || loadingByo

  // ONE gutter (gap-6, was gap-4) and ONE breakpoint (lg, was md — finance was
  // the only block on the page that went three-up at md, so the layout reflowed
  // twice on the way down). The two money FIGURES sit on the background as a
  // hairline rail; recent payments is the card beside them.
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <FigureRail cols={2} className="lg:col-span-2">
          <RevenueCard teamId={teamId} />
          <UnassignedCard rows={rows} isLoading={isLoading} />
        </FigureRail>
        <RecentPaymentsCard rows={rows} isLoading={isLoading} />
      </div>

      {teamId && isInstalled('finance') && <FinanceTrendsSection teamId={teamId} />}
    </div>
  )
}
