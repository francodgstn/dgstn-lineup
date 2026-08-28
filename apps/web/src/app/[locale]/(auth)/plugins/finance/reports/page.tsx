'use client'

// Accounting reports — trial balance / P&L / balance sheet, computed
// CLIENT-SIDE from the per-month accounting_period_summaries via the pure
// shared functions. Period picker: month / YTD / fiscal year; the balance
// sheet is always cumulative from inception → the as-of month. Owner can
// close an elapsed fiscal year.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, Download, Lock, Table2 } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import {
  computeBalanceSheet,
  computeProfitAndLoss,
  computeTrialBalance,
  fiscalYearOf,
  formatMinorUnits,
  monthKey,
  sumAccountTotals,
  type ReportAccountRef,
} from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  callCloseFiscalYear,
  useAccounts,
  useAccountingSettings,
  useInvalidateAccounting,
  usePeriodSummaries,
} from '@/plugins/finance/hooks'
import { FinanceBetaChip } from '@/components/finance/FinanceBetaChip'

type RangeKind = 'month' | 'ytd' | 'fy'

function recentMonths(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < 24; i += 1) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 15)))
  }
  return months
}

function downloadCsvRows(filename: string, header: string[], rows: string[][]) {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function AccountingReportsPage() {
  const t = useTranslations('Finance')
  const { currentTeamId, teamRole } = useAuth()
  const teamId = currentTeamId ?? null
  const isOwner = teamRole === 'owner'
  const { isInstalled, isLoading: pluginsLoading } = useInstalledPlugins()

  const months = useMemo(recentMonths, [])
  const [asOf, setAsOf] = useState(months[0])
  const [range, setRange] = useState<RangeKind>('month')
  const [closeTarget, setCloseTarget] = useState<number | null>(null)

  const { data: settings } = useAccountingSettings(teamId)
  const { data: accountsRaw = [] } = useAccounts(teamId)
  const { data: summaries = [], isLoading } = usePeriodSummaries(teamId, asOf)
  const invalidate = useInvalidateAccounting(teamId)

  const fyStart = settings?.fiscal_year_start_month ?? 1
  const accounts: ReportAccountRef[] = useMemo(
    () => accountsRaw.map((a) => ({ code: a.code, name: a.name, type: a.type })),
    [accountsRaw]
  )

  // Period-range totals (trial balance + P&L) vs cumulative (balance sheet).
  const { rangeTotals, cumulativeTotals } = useMemo(() => {
    const asOfFy = fiscalYearOf(asOf, fyStart)
    const inRange = summaries.filter((s) => {
      if (range === 'month') return s.period === asOf
      if (range === 'ytd') return s.period.slice(0, 4) === asOf.slice(0, 4) && s.period <= asOf
      return fiscalYearOf(s.period, fyStart) === asOfFy
    })
    return {
      rangeTotals: sumAccountTotals(inRange.map((s) => s.totals)),
      cumulativeTotals: sumAccountTotals(summaries.map((s) => s.totals)),
    }
  }, [summaries, range, asOf, fyStart])

  if (pluginsLoading) return <Skeleton className="m-6 h-40" />
  if (!teamId || !isInstalled('finance')) {
    return <p className="p-6 text-sm text-muted-foreground">{t('notInstalled')}</p>
  }

  const trialBalance = computeTrialBalance(rangeTotals, accounts)
  const pnl = computeProfitAndLoss(rangeTotals, accounts)
  const balanceSheet = computeBalanceSheet(cumulativeTotals, accounts)
  const currency = settings?.base_currency ?? 'CHF'
  const money = (v: number) => formatMinorUnits(v)

  const asOfFy = fiscalYearOf(asOf, fyStart)
  const closableYear =
    settings != null
      ? (settings.closed_through_fiscal_year != null ? settings.closed_through_fiscal_year + 1 : null)
      : null
  const currentFy = fiscalYearOf(monthKey(Date.now()), fyStart)
  // First close: derive from the earliest summary. Subsequent: closed+1.
  const firstFy = summaries.length > 0 ? fiscalYearOf(summaries[0].period, fyStart) : null
  const nextToClose = closableYear ?? firstFy
  const canClose = isOwner && nextToClose != null && nextToClose < currentFy

  const confirmClose = async () => {
    if (closeTarget == null) return
    try {
      await callCloseFiscalYear({ teamId, fiscalYear: closeTarget })
      invalidate()
      toast.success(t('yearClosed'))
    } catch (err) {
      console.error('[finance] close failed:', err)
      toast.error(t('actionFailed'))
    } finally {
      setCloseTarget(null)
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Link
        href={'/plugins/finance' as Route}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('backToOverview')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Table2 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('reports')}</h1>
          <FinanceBetaChip />
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => v && setRange(v as RangeKind)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">{t('range_month')}</SelectItem>
              <SelectItem value="ytd">{t('range_ytd')}</SelectItem>
              <SelectItem value="fy">{t('range_fy')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={asOf} onValueChange={(v) => v && setAsOf(v)}>
            <SelectTrigger size="sm" className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canClose && (
            <Button size="sm" variant="outline" onClick={() => setCloseTarget(nextToClose)}>
              <Lock className="h-4 w-4 mr-1" />
              {t('closeYear')} {nextToClose}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <Tabs defaultValue="trial-balance">
          <TabsList>
            <TabsTrigger value="trial-balance">{t('trialBalance')}</TabsTrigger>
            <TabsTrigger value="pnl">{t('profitAndLoss')}</TabsTrigger>
            <TabsTrigger value="balance-sheet">{t('balanceSheet')}</TabsTrigger>
          </TabsList>

          <TabsContent value="trial-balance" className="space-y-2">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  downloadCsvRows(
                    `trial-balance-${asOf}-${range}.csv`,
                    ['code', 'name', 'type', 'debit', 'credit', 'balance'],
                    trialBalance.rows.map((r) => [r.code, r.name, r.type, money(r.debit), money(r.credit), money(r.balance)])
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" />
                {t('downloadCsv')}
              </Button>
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{t('accountCode')}</TableHead>
                    <TableHead>{t('accountName')}</TableHead>
                    <TableHead className="w-28 text-right">{t('debit')}</TableHead>
                    <TableHead className="w-28 text-right">{t('credit')}</TableHead>
                    <TableHead className="w-28 text-right">{t('balance')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trialBalance.rows.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.debit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.credit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell colSpan={2}>{t('total')} ({currency})</TableCell>
                    <TableCell className="text-right tabular-nums">{money(trialBalance.total_debit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(trialBalance.total_credit)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="pnl" className="space-y-2">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  downloadCsvRows(
                    `pnl-${asOf}-${range}.csv`,
                    ['section', 'code', 'name', 'amount'],
                    [
                      ...pnl.revenue.map((r) => ['revenue', r.code, r.name, money(r.amount)]),
                      ...pnl.expenses.map((r) => ['expense', r.code, r.name, money(r.amount)]),
                      ['result', '', t('netProfit'), money(pnl.net_profit)],
                    ]
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" />
                {t('downloadCsv')}
              </Button>
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableBody>
                  <TableRow className="font-medium bg-muted/40">
                    <TableCell colSpan={3}>{t('type_revenue')}</TableCell>
                  </TableRow>
                  {pnl.revenue.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="w-20 font-mono text-xs">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="w-32 text-right tabular-nums">{money(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell colSpan={2}>{t('totalRevenue')}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(pnl.total_revenue)}</TableCell>
                  </TableRow>
                  <TableRow className="font-medium bg-muted/40">
                    <TableCell colSpan={3}>{t('type_expense')}</TableCell>
                  </TableRow>
                  {pnl.expenses.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="w-20 font-mono text-xs">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="w-32 text-right tabular-nums">{money(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell colSpan={2}>{t('totalExpenses')}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(pnl.total_expenses)}</TableCell>
                  </TableRow>
                  <TableRow className="font-semibold">
                    <TableCell colSpan={2}>{t('netProfit')} ({currency})</TableCell>
                    <TableCell className="text-right tabular-nums">{money(pnl.net_profit)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="balance-sheet" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('asOf')} {asOf}
            </p>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableBody>
                  <TableRow className="font-medium bg-muted/40">
                    <TableCell colSpan={3}>{t('assets')}</TableCell>
                  </TableRow>
                  {balanceSheet.assets.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="w-20 font-mono text-xs">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="w-32 text-right tabular-nums">{money(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell colSpan={2}>{t('total')} {t('assets').toLowerCase()}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(balanceSheet.total_assets)}</TableCell>
                  </TableRow>
                  <TableRow className="font-medium bg-muted/40">
                    <TableCell colSpan={3}>{t('liabilities')} & {t('equity')}</TableCell>
                  </TableRow>
                  {[...balanceSheet.liabilities, ...balanceSheet.equity].map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="w-20 font-mono text-xs">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="w-32 text-right tabular-nums">{money(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {balanceSheet.current_result !== 0 && (
                    <TableRow>
                      <TableCell className="w-20 font-mono text-xs">—</TableCell>
                      <TableCell className="italic">{t('currentResult')}</TableCell>
                      <TableCell className="w-32 text-right tabular-nums">{money(balanceSheet.current_result)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow className="font-semibold">
                    <TableCell colSpan={2}>{t('total')} ({currency})</TableCell>
                    <TableCell className="text-right tabular-nums">{money(balanceSheet.total_liabilities_equity)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      <AlertDialog open={closeTarget != null} onOpenChange={(open) => !open && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('closeYearConfirmTitle', { year: closeTarget ?? asOfFy })}</AlertDialogTitle>
            <AlertDialogDescription>{t('closeYearConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClose}>{t('closeYear')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
