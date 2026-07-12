'use client'

// Finance plugin data hooks — react-query over the accounting subcollections
// (manager/owner-readable per rules) + httpsCallable wrappers for the
// function-gated actions. Pattern: online-courses/hooks.ts.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import {
  ACCOUNTING_ACCOUNTS_SUBCOLLECTION,
  ACCOUNTING_ENTRIES_SUBCOLLECTION,
  ACCOUNTING_PERIOD_SUMMARIES_SUBCOLLECTION,
  ACCOUNTING_SETTINGS_DOC,
  ACCOUNTING_SETTINGS_SUBCOLLECTION,
  FINANCE_MONTHLY_REPORTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
} from '@linyup/shared'
import type {
  AccountingAccount,
  AccountingEntry,
  AccountingPeriodSummary,
  AccountingSettings,
  ChartTemplateId,
  FinanceMonthlyReport,
} from '@linyup/shared'

// ─── Queries ────────────────────────────────────────────────────────────────

export function useAccountingSettings(teamId: string | null) {
  return useQuery<AccountingSettings | null>({
    queryKey: ['accounting-settings', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDoc(
        doc(db, TEAMS_COLLECTION, teamId!, ACCOUNTING_SETTINGS_SUBCOLLECTION, ACCOUNTING_SETTINGS_DOC)
      )
      return snap.exists() ? (snap.data() as AccountingSettings) : null
    },
  })
}

export function useAccounts(teamId: string | null) {
  return useQuery<AccountingAccount[]>({
    queryKey: ['accounting-accounts', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId!, ACCOUNTING_ACCOUNTS_SUBCOLLECTION)
      )
      return snap.docs
        .map((d) => d.data() as AccountingAccount)
        .sort((a, b) => a.code.localeCompare(b.code))
    },
  })
}

export function useEntries(teamId: string | null, period: string | null) {
  return useQuery<AccountingEntry[]>({
    queryKey: ['accounting-entries', teamId, period],
    enabled: !!teamId && !!period,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, ACCOUNTING_ENTRIES_SUBCOLLECTION),
          where('period', '==', period),
          orderBy('date', 'desc')
        )
      )
      return snap.docs.map((d) => ({ ...(d.data() as AccountingEntry), id: d.id }))
    },
  })
}

/** All period summaries up to (and including) `toPeriod` — the balance-sheet
 * substrate (cumulative from inception; ≤12 docs per year of history). */
export function usePeriodSummaries(teamId: string | null, toPeriod: string | null) {
  return useQuery<AccountingPeriodSummary[]>({
    queryKey: ['accounting-summaries', teamId, toPeriod],
    enabled: !!teamId && !!toPeriod,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, ACCOUNTING_PERIOD_SUMMARIES_SUBCOLLECTION),
          where('period', '<=', toPeriod!),
          orderBy('period', 'asc')
        )
      )
      return snap.docs.map((d) => d.data() as AccountingPeriodSummary)
    },
  })
}

export function useFinanceMonthlyReport(teamId: string | null, month: string | null) {
  return useQuery<FinanceMonthlyReport | null>({
    queryKey: ['finance-monthly-report', teamId, month],
    enabled: !!teamId && !!month,
    queryFn: async () => {
      const snap = await getDoc(
        doc(db, TEAMS_COLLECTION, teamId!, FINANCE_MONTHLY_REPORTS_SUBCOLLECTION, month!)
      )
      return snap.exists() ? (snap.data() as FinanceMonthlyReport) : null
    },
  })
}

// ─── Account writes (direct client writes — rules allow owner) ──────────────

export async function saveAccount(
  teamId: string,
  account: Pick<AccountingAccount, 'code' | 'name' | 'type' | 'active'> & { system?: boolean },
  isNew: boolean
): Promise<void> {
  const ref = doc(db, TEAMS_COLLECTION, teamId, ACCOUNTING_ACCOUNTS_SUBCOLLECTION, account.code)
  await setDoc(
    ref,
    {
      code: account.code,
      name: account.name,
      type: account.type,
      active: account.active,
      ...(isNew
        ? { system: false, tax_code: null, description: null, created_at: serverTimestamp() }
        : {}),
      updated_at: serverTimestamp(),
    },
    { merge: true }
  )
}

// ─── Callables ──────────────────────────────────────────────────────────────

export const callRebuildLedger = httpsCallable<
  { teamId: string },
  { entries_written: number; skipped_foreign_currency: number }
>(functions, 'rebuildAccountingLedger')

export const callCreateManualEntry = httpsCallable<
  {
    teamId: string
    dateMs: number
    description: string
    lines: Array<{ account_code: string; debit: number; credit: number; description?: string | null }>
  },
  { id: string; period: string }
>(functions, 'createManualEntry')

export const callReverseEntry = httpsCallable<{ teamId: string; entryId: string }, { id: string }>(
  functions,
  'reverseEntry'
)

export const callCloseFiscalYear = httpsCallable<
  { teamId: string; fiscalYear: number },
  { id: string; period: string }
>(functions, 'closeFiscalYear')

export const callSetChartTemplate = httpsCallable<
  { teamId: string; template: ChartTemplateId },
  { template: ChartTemplateId }
>(functions, 'setChartTemplate')

/** Invalidate everything accounting after a mutating callable. */
export function useInvalidateAccounting(teamId: string | null) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['accounting-settings', teamId] })
    void qc.invalidateQueries({ queryKey: ['accounting-accounts', teamId] })
    void qc.invalidateQueries({ queryKey: ['accounting-entries', teamId] })
    void qc.invalidateQueries({ queryKey: ['accounting-summaries', teamId] })
  }
}
