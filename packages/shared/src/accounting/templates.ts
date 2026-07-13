// Entry templates — pure helpers for the owner-managed manual-entry presets
// (rent, utilities, equipment, federation fees, owner loans, …) and their
// recurring auto-post. See types/accounting.ts (AccountingEntryTemplate) for the
// data model rationale: ONE amount, exactly TWO accounts — balanced by
// construction. Consumed by the web templates UI (validate + quick-use via
// createManualEntry) and the daily materializer (recurrence advance + posting).

import type {
  AccountingAccount,
  AccountingEntryLine,
  AccountingEntryTemplate,
  ChartTemplateId,
  EntryTemplateRecurrence,
} from '../types/accounting'
import type { ChartLocale } from './chartTemplates'

// ─── Validation ───────────────────────────────────────────────────────────────

export interface EntryTemplateDraft {
  name: string
  debit_account_code: string
  credit_account_code: string
  amount_minor: number | null
  recurrence: EntryTemplateRecurrence
  day_of_month: number | null
  month_of_year: number | null
}

export const ENTRY_TEMPLATE_MAX_NAME = 120

/**
 * Validate a template draft. Returns machine-readable error codes (empty =
 * valid) so the form maps them to i18n messages — same idiom as
 * validateManualEntryInput:
 *   name_required · debit_account_required · credit_account_required ·
 *   same_account · unknown_account:{code} · inactive_account:{code} ·
 *   amount_invalid · amount_required_for_recurrence · day_of_month_range ·
 *   month_of_year_range
 */
export function validateEntryTemplate(
  draft: EntryTemplateDraft,
  accounts: Pick<AccountingAccount, 'code' | 'active'>[]
): string[] {
  const errors: string[] = []

  if (!draft.name || !draft.name.trim() || draft.name.length > ENTRY_TEMPLATE_MAX_NAME) {
    errors.push('name_required')
  }
  if (!draft.debit_account_code) errors.push('debit_account_required')
  if (!draft.credit_account_code) errors.push('credit_account_required')
  if (
    draft.debit_account_code &&
    draft.debit_account_code === draft.credit_account_code
  ) {
    errors.push('same_account')
  }
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  for (const code of [draft.debit_account_code, draft.credit_account_code]) {
    if (!code) continue
    const account = byCode.get(code)
    if (!account) errors.push(`unknown_account:${code}`)
    else if (!account.active) errors.push(`inactive_account:${code}`)
  }

  if (draft.amount_minor != null) {
    if (!Number.isInteger(draft.amount_minor) || draft.amount_minor <= 0) {
      errors.push('amount_invalid')
    }
  }

  if (draft.recurrence !== 'none') {
    // Auto-post needs a fixed amount — recurrence without one is a footgun.
    if (draft.amount_minor == null) errors.push('amount_required_for_recurrence')
    const day = draft.day_of_month
    if (day == null || !Number.isInteger(day) || day < 1 || day > 28) {
      errors.push('day_of_month_range')
    }
    if (draft.recurrence === 'yearly') {
      const month = draft.month_of_year
      if (month == null || !Number.isInteger(month) || month < 1 || month > 12) {
        errors.push('month_of_year_range')
      }
    }
  }
  return errors
}

// ─── Posting lines ────────────────────────────────────────────────────────────

/** The template's two balanced lines: Dr debit_account / Cr credit_account. */
export function buildTemplateLines(
  tpl: Pick<AccountingEntryTemplate, 'debit_account_code' | 'credit_account_code'>,
  amountMinor: number
): AccountingEntryLine[] {
  return [
    { account_code: tpl.debit_account_code, debit: amountMinor, credit: 0 },
    { account_code: tpl.credit_account_code, debit: 0, credit: amountMinor },
  ]
}

// ─── Recurrence ───────────────────────────────────────────────────────────────

/**
 * Next occurrence STRICTLY after `afterMs`, at 12:00 UTC on the clamped day
 * (1..28 — Feb-safe by construction). Noon UTC is always mid-day in the finance
 * timezone (CET/CEST = UTC+1/+2), so the occurrence lands on the intended
 * calendar day in Europe/Zurich and `monthKey` buckets it into the intended
 * period. Calendar math is UTC-based — deterministic, no DST edge cases.
 */
export function computeNextRunMs(
  recurrence: Exclude<EntryTemplateRecurrence, 'none'>,
  dayOfMonth: number,
  monthOfYear: number | null,
  afterMs: number
): number {
  const day = Math.min(28, Math.max(1, Math.trunc(dayOfMonth)))
  const after = new Date(afterMs)

  if (recurrence === 'yearly') {
    const month = Math.min(12, Math.max(1, Math.trunc(monthOfYear ?? 1)))
    let year = after.getUTCFullYear()
    let candidate = Date.UTC(year, month - 1, day, 12)
    while (candidate <= afterMs) {
      year += 1
      candidate = Date.UTC(year, month - 1, day, 12)
    }
    return candidate
  }

  // monthly
  let year = after.getUTCFullYear()
  let month = after.getUTCMonth() // 0-based
  let candidate = Date.UTC(year, month, day, 12)
  while (candidate <= afterMs) {
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
    candidate = Date.UTC(year, month, day, 12)
  }
  return candidate
}

// ─── Starter templates ────────────────────────────────────────────────────────
// Seeded at plugin install (create-only, fixed ids) in the team's locale — the
// common studio flows out of the box. All start non-recurring with no fixed
// amount (recurrence/auto-post is the owner's explicit opt-in). The credit side
// of expense templates is the chart's bank account; the owner-loan pair moves
// money between bank and the owner-loan liability in both directions.

export interface StarterTemplateDef {
  /** Doc id (stable — create-only seeding keys on it). */
  id: string
  names: Partial<Record<ChartLocale, string>>
  debit_by_chart: Record<ChartTemplateId, string>
  credit_by_chart: Record<ChartTemplateId, string>
}

export const STARTER_ENTRY_TEMPLATES: StarterTemplateDef[] = [
  {
    id: 'tpl_rent',
    names: { en: 'Rent', de: 'Miete', fr: 'Loyer', it: 'Affitto' },
    debit_by_chart: { ch_kmu: '6000', de_skr04: '6310', it_standard: '4100' },
    credit_by_chart: { ch_kmu: '1020', de_skr04: '1800', it_standard: '1200' },
  },
  {
    id: 'tpl_utilities',
    names: {
      en: 'Utilities',
      de: 'Energie & Nebenkosten',
      fr: 'Énergie et charges',
      it: 'Utenze',
    },
    debit_by_chart: { ch_kmu: '6040', de_skr04: '6325', it_standard: '4110' },
    credit_by_chart: { ch_kmu: '1020', de_skr04: '1800', it_standard: '1200' },
  },
  {
    id: 'tpl_equipment',
    names: {
      en: 'Equipment purchase',
      de: 'Gerätekauf',
      fr: 'Achat d’équipement',
      it: 'Acquisto attrezzature',
    },
    debit_by_chart: { ch_kmu: '6100', de_skr04: '6470', it_standard: '4200' },
    credit_by_chart: { ch_kmu: '1020', de_skr04: '1800', it_standard: '1200' },
  },
  {
    id: 'tpl_federation_fees',
    names: {
      en: 'Federation fees',
      de: 'Verbandsbeiträge',
      fr: 'Cotisations fédération',
      it: 'Quote federazione',
    },
    debit_by_chart: { ch_kmu: '6520', de_skr04: '6420', it_standard: '4620' },
    credit_by_chart: { ch_kmu: '1020', de_skr04: '1800', it_standard: '1200' },
  },
  {
    id: 'tpl_owner_loan_in',
    names: {
      en: 'Owner loan received',
      de: 'Darlehen Inhaber erhalten',
      fr: 'Prêt du propriétaire reçu',
      it: 'Prestito titolare ricevuto',
    },
    debit_by_chart: { ch_kmu: '1020', de_skr04: '1800', it_standard: '1200' },
    credit_by_chart: { ch_kmu: '2400', de_skr04: '3560', it_standard: '2700' },
  },
  {
    id: 'tpl_owner_loan_repay',
    names: {
      en: 'Owner loan repayment',
      de: 'Darlehensrückzahlung Inhaber',
      fr: 'Remboursement du prêt propriétaire',
      it: 'Rimborso prestito titolare',
    },
    debit_by_chart: { ch_kmu: '2400', de_skr04: '3560', it_standard: '2700' },
    credit_by_chart: { ch_kmu: '1020', de_skr04: '1800', it_standard: '1200' },
  },
]

/** Resolve a starter template's seed name in the team's locale (en fallback). */
export function resolveTemplateName(def: StarterTemplateDef, locale?: string | null): string {
  const l = (locale ?? 'en').slice(0, 2) as ChartLocale
  return def.names[l] ?? def.names.en ?? def.id
}
