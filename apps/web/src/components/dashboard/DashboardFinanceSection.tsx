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
import { Card, CardContent } from '@/components/ui/card'
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

const RECENT_COUNT = 5

/** Money that actually arrived. The card shows an amount with no status chip, so
 * a failed or still-pending charge listed here reads as income the studio never
 * got — same rule the revenue total uses. BYO rows are always 'paid' (they exist
 * because money arrived). */
function isSettled(row: UnifiedPaymentRow): boolean {
  return row.status === 'succeeded' || row.status === 'partially_refunded' || row.status === 'paid'
}

/** Shared shell so the three cards line up regardless of what's inside them. */
function FinanceCard({
  title,
  icon: Icon,
  children,
  href,
}: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
  href?: string
}) {
  const inner = (
    <Card
      variant="accent"
      size="sm"
      className={`h-full ${href ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
    >
      <CardContent className="py-1">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <Icon className="h-4 w-4 shrink-0 text-primary/60" />
        </div>
        {children}
      </CardContent>
    </Card>
  )
  return href ? (
    <Link href={href as Route} className="h-full">
      {inner}
    </Link>
  ) : (
    inner
  )
}

function RevenueCard({ teamId }: { teamId: string | null }) {
  const t = useTranslations('DashboardFinance')
  const { data, isLoading } = useMonthlyRevenue(teamId)

  const delta = data?.deltaPercent ?? null
  const up = delta !== null && delta >= 0

  return (
    <FinanceCard title={t('revenueTitle')} icon={Banknote} href="/payments">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {isLoading ? (
          <Skeleton className="h-10 w-28" />
        ) : (
          <p className="text-3xl font-black leading-none">
            {formatMoneyMinor(data?.thisMonth ?? 0, data?.currency ?? 'CHF')}
          </p>
        )}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t('revenueSubtitle')}</p>
          {!isLoading && delta !== null && (
            <p
              className={`flex items-center gap-1 text-xs ${up ? 'text-emerald-600' : 'text-amber-600'}`}
            >
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {t('vsLastMonth', { percent: Math.abs(delta) })}
            </p>
          )}
        </div>
      </div>
    </FinanceCard>
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

  return (
    <FinanceCard title={t('recentTitle')} icon={Receipt} href="/payments">
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
    </FinanceCard>
  )
}

function UnassignedCard({ rows, isLoading }: { rows: UnifiedPaymentRow[]; isLoading: boolean }) {
  const t = useTranslations('DashboardFinance')
  // Settled only: a failed charge with no contact isn't a filing task, and
  // counting it here would send the studio to /payments to "fix" a non-payment.
  const count = rows.filter((r) => isSettled(r) && !r.assigned).length

  return (
    <FinanceCard title={t('unassignedTitle')} icon={UserRoundX} href="/payments">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {isLoading ? (
          <Skeleton className="h-10 w-16" />
        ) : (
          <p className="text-4xl font-black leading-none">{count}</p>
        )}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {count === 0 ? t('unassignedEmpty') : t('unassignedSubtitle')}
          </p>
          {!isLoading && count > 0 && (
            <p className="flex items-center gap-1 text-xs text-primary">
              {t('unassignedAction')}
              <ArrowRight className="h-3 w-3" />
            </p>
          )}
        </div>
      </div>
    </FinanceCard>
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <RevenueCard teamId={teamId} />
        <RecentPaymentsCard rows={rows} isLoading={isLoading} />
        <UnassignedCard rows={rows} isLoading={isLoading} />
      </div>

      {teamId && isInstalled('finance') && <FinanceTrendsSection teamId={teamId} />}
    </div>
  )
}
