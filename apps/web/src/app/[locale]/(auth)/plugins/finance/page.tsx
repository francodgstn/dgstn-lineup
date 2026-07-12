'use client'

// Finance plugin — overview: the selected month's finance report + CSV export,
// accounting status (template, last rebuild, foreign-currency skips), and
// links to the accounting subpages. Functional, not polished (beta).

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { toast } from 'sonner'
import { BookOpenText, Calculator, ListOrdered, Loader2, RefreshCw, Table2 } from 'lucide-react'
import { formatMinorUnits, monthKey } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { ExportFinanceCsvButton } from '@/components/payments/ExportFinanceCsvButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  callRebuildLedger,
  useAccountingSettings,
  useFinanceMonthlyReport,
  useInvalidateAccounting,
} from '@/plugins/finance/hooks'

function recentMonths(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < 12; i += 1) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 15)))
  }
  return months
}

export default function FinanceOverviewPage() {
  const t = useTranslations('Finance')
  const { currentTeamId } = useAuth()
  const teamId = currentTeamId ?? null
  const { isInstalled, isLoading: pluginsLoading } = useInstalledPlugins()

  const months = useMemo(recentMonths, [])
  const [month, setMonth] = useState(months[0])
  const { data: report, isLoading: reportLoading } = useFinanceMonthlyReport(teamId, month)
  const { data: settings } = useAccountingSettings(teamId)
  const invalidate = useInvalidateAccounting(teamId)
  const [rebuilding, setRebuilding] = useState(false)

  if (pluginsLoading) return <Skeleton className="m-6 h-40" />
  if (!teamId || !isInstalled('finance')) {
    return (
      <div className="p-6 space-y-2">
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('notInstalled')}</p>
        <p className="text-sm text-muted-foreground">{t('installHint')}</p>
      </div>
    )
  }

  const rebuild = async () => {
    setRebuilding(true)
    try {
      const { data } = await callRebuildLedger({ teamId })
      invalidate()
      toast.success(t('rebuildDone', { count: data.entries_written }))
      if (data.skipped_foreign_currency > 0) {
        toast.warning(t('foreignCurrencySkipped', { count: data.skipped_foreign_currency }))
      }
    } catch (err) {
      console.error('[finance] rebuild failed:', err)
      toast.error(t('rebuildFailed'))
    } finally {
      setRebuilding(false)
    }
  }

  const currency = settings?.base_currency ?? 'CHF'
  const money = (v: number) => `${formatMinorUnits(v)} ${currency}`

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('title')}</h1>
        </div>
        <Button size="sm" variant="outline" onClick={rebuild} disabled={rebuilding}>
          {rebuilding ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {t('rebuildLedger')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('overviewIntro')}</p>

      {/* Monthly finance report */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('monthlyReport')}</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={month} onValueChange={(v) => v && setMonth(v)}>
              <SelectTrigger size="sm" className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ExportFinanceCsvButton teamId={teamId} />
          </div>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <Skeleton className="h-16" />
          ) : !report ? (
            <p className="text-sm text-muted-foreground">{t('noReportYet')}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {(
                  [
                    [t('grossLabel'), report.totals.gross],
                    [t('stripeFees'), report.totals.stripe_fees],
                    [t('platformFees'), report.totals.platform_fees],
                    [t('netLabel'), report.totals.net],
                    [t('refundsLabel'), -report.refunds.amount],
                    [t('payoutsLabel'), report.payouts.total],
                  ] as Array<[string, number]>
                ).map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-sm font-medium tabular-nums">{money(value)}</div>
                  </div>
                ))}
              </div>
              {report.reconciliation_check && !report.reconciliation_check.ok && (
                <p className="text-xs text-amber-600">{t('reconciliationWarning')}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accounting subpages */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['/plugins/finance/accounts', BookOpenText, t('accounts'), t('accountsDescription')],
            ['/plugins/finance/entries', ListOrdered, t('entries'), t('entriesDescription')],
            ['/plugins/finance/reports', Table2, t('reports'), t('reportsDescription')],
          ] as Array<[string, typeof BookOpenText, string, string]>
        ).map(([href, Icon, label, description]) => (
          <Link key={href} href={href as Route}>
            <Card className="h-full transition-colors hover:bg-accent/50">
              <CardContent className="flex items-start gap-3 p-4">
                <Icon className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {settings?.last_rebuild && (
        <p className="text-xs text-muted-foreground">
          {t('lastRebuild')}: {settings.last_rebuild.at?.toDate?.().toLocaleString?.() ?? '—'} ·{' '}
          {settings.last_rebuild.entries_written} {t('entries').toLowerCase()}
          {settings.last_rebuild.skipped_foreign_currency > 0 &&
            ` · ${t('foreignCurrencySkipped', { count: settings.last_rebuild.skipped_foreign_currency })}`}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('openingBalancesHint')}</p>
    </div>
  )
}
