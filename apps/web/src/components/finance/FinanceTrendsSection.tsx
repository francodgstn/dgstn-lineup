'use client'

// Finance trends — the three classic accounting charts, computed client-side
// from the monthly accounting summaries (same substrate as the reports page):
//   income vs expenses (bars) · net result (area) · cash balance (area).
// Cash = bank + cash + clearing accounts (from settings.mapping), cumulative
// from inception. Fiscal-year close entries are subtracted from their month so
// a close doesn't show the whole year reversed (see computeMonthlySeries).

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { computeMonthlySeries, formatMinorUnits, monthKey } from '@linyup/shared'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAccountingSettings,
  useAccounts,
  useClosingEntries,
  usePeriodSummaries,
} from '@/plugins/finance/hooks'

const INCOME_COLOR = '#10B981'
const EXPENSE_COLOR = '#EF4444'
const NET_COLOR = '#6366F1'
const CASH_COLOR = '#0EA5E9'

/** Last 12 'YYYY-MM' periods, ascending (charts read left → right). */
function last12MonthsAsc(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i -= 1) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 15)))
  }
  return months
}

interface TooltipRow {
  name?: string
  value?: number | string
  color?: string
  fill?: string
}

// Rendered by recharts via element cloning — active/payload/label are injected.
function ChartTip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: TooltipRow[]
  label?: string | number
  currency: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border bg-background p-3 text-xs shadow-lg">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: p.color ?? p.fill ?? 'currentColor' }}
          />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">
            {formatMinorUnits(Number(p.value ?? 0))} {currency}
          </span>
        </div>
      ))}
    </div>
  )
}

export function FinanceTrendsSection({ teamId }: { teamId: string }) {
  const t = useTranslations('Finance')
  const locale = useLocale()

  const months = useMemo(last12MonthsAsc, [])
  const toPeriod = months[months.length - 1]
  const { data: summaries = [], isLoading: loadingSummaries } = usePeriodSummaries(teamId, toPeriod)
  const { data: accounts = [], isLoading: loadingAccounts } = useAccounts(teamId)
  const { data: settings } = useAccountingSettings(teamId)
  const { data: closingEntries = [] } = useClosingEntries(teamId)

  const currency = settings?.base_currency ?? 'CHF'

  const points = useMemo(() => {
    if (!settings) return []
    const moneyCodes = Array.from(
      new Set([
        settings.mapping.bank_account,
        ...Object.values(settings.mapping.clearing_by_source),
      ])
    )
    const series = computeMonthlySeries(
      summaries.map((s) => ({ period: s.period, totals: s.totals })),
      accounts.map((a) => ({ code: a.code, name: a.name, type: a.type })),
      moneyCodes,
      months,
      closingEntries
    )
    // Short locale month label for the X axis ('Jul', 'Aug', …; 'Jan 27' on year starts).
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short' })
    return series.map((p) => {
      const [y, m] = p.period.split('-').map((v) => parseInt(v, 10))
      const label =
        m === 1
          ? `${fmt.format(new Date(y, 0, 15))} ${String(y).slice(2)}`
          : fmt.format(new Date(y, m - 1, 15))
      return { ...p, label }
    })
  }, [summaries, accounts, settings, closingEntries, months, locale])

  const hasData = summaries.length > 0
  const compact = (v: number) =>
    new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v / 100)

  if (loadingSummaries || loadingAccounts) return <Skeleton className="h-56" />

  const chartChrome = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        interval="preserveStartEnd"
      />
      <YAxis
        tick={{ fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={compact}
      />
    </>
  )

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">{t('trendsTitle')}</h2>
      {!hasData ? (
        <p className="text-sm text-muted-foreground">{t('noChartData')}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('chartIncomeVsExpenses')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  {chartChrome}
                  <Tooltip
                    content={<ChartTip currency={currency} />}
                    cursor={{ fillOpacity: 0.06 }}
                  />
                  <Bar
                    dataKey="income"
                    name={t('incomeLabel')}
                    fill={INCOME_COLOR}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="expenses"
                    name={t('expensesLabel')}
                    fill={EXPENSE_COLOR}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('chartNetResult')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gradNetResult" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={NET_COLOR} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={NET_COLOR} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {chartChrome}
                  <Tooltip content={<ChartTip currency={currency} />} />
                  <Area
                    dataKey="net"
                    name={t('netResultLabel')}
                    type="monotone"
                    stroke={NET_COLOR}
                    strokeWidth={2}
                    fill="url(#gradNetResult)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('chartCashBalance')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gradCashBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CASH_COLOR} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={CASH_COLOR} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {chartChrome}
                  <Tooltip content={<ChartTip currency={currency} />} />
                  <Area
                    dataKey="cash_balance"
                    name={t('cashBalanceLabel')}
                    type="monotone"
                    stroke={CASH_COLOR}
                    strokeWidth={2}
                    fill="url(#gradCashBalance)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
