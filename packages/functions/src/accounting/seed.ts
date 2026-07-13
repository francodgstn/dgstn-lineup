/* eslint-disable no-console */
// Accounting seeding — creates the settings doc + chart of accounts from the
// team's chart template on plugin activation (and after a template switch).
//
// Idempotent by design: the settings doc is only created when missing, and
// accounts are written with create() + swallow ALREADY_EXISTS — re-runs never
// clobber a studio's edits to account names or active flags.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  ACCOUNTING_ACCOUNTS_SUBCOLLECTION,
  ACCOUNTING_ENTRY_TEMPLATES_SUBCOLLECTION,
  ACCOUNTING_SETTINGS_DOC,
  ACCOUNTING_SETTINGS_SUBCOLLECTION,
  ACCOUNTING_SETTINGS_VERSION,
  CHART_TEMPLATES,
  STARTER_ENTRY_TEMPLATES,
  TEAMS_COLLECTION,
  normalizeCurrency,
  resolveAccountName,
  resolveTemplateName,
  templateForCountry,
  type AccountingSettings,
  type ChartTemplateId,
} from '@linyup/shared'

export function accountingSettingsRef(teamId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(ACCOUNTING_SETTINGS_SUBCOLLECTION)
    .doc(ACCOUNTING_SETTINGS_DOC)
}

export function accountsCollection(teamId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(ACCOUNTING_ACCOUNTS_SUBCOLLECTION)
}

export function entryTemplatesCollection(teamId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(ACCOUNTING_ENTRY_TEMPLATES_SUBCOLLECTION)
}

export async function loadAccountingSettings(teamId: string): Promise<AccountingSettings | null> {
  const snap = await accountingSettingsRef(teamId).get()
  return snap.exists ? (snap.data() as AccountingSettings) : null
}

/** Seed the chart-of-accounts docs for a template (create-only, never edits). */
export async function seedAccounts(
  teamId: string,
  templateId: ChartTemplateId,
  locale: string | undefined
): Promise<number> {
  const template = CHART_TEMPLATES[templateId]
  let created = 0
  for (const acc of template.accounts) {
    try {
      await accountsCollection(teamId)
        .doc(acc.code)
        .create({
          code: acc.code,
          name: resolveAccountName(acc, locale),
          type: acc.type,
          system: true,
          active: true,
          tax_code: null,
          description: null,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
          created_by: 'system',
        })
      created += 1
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 6) continue // exists — user data, never touch
      throw err
    }
  }
  return created
}

/** Seed the starter entry templates (create-only, fixed ids — re-runs never
 * clobber the owner's edits, deletions stay deleted only for non-system ids;
 * system templates the owner deactivated stay deactivated). */
export async function seedEntryTemplates(
  teamId: string,
  templateId: ChartTemplateId,
  locale: string | undefined
): Promise<number> {
  let created = 0
  for (const def of STARTER_ENTRY_TEMPLATES) {
    try {
      await entryTemplatesCollection(teamId)
        .doc(def.id)
        .create({
          id: def.id,
          name: resolveTemplateName(def, locale),
          debit_account_code: def.debit_by_chart[templateId],
          credit_account_code: def.credit_by_chart[templateId],
          amount_minor: null,
          recurrence: 'none',
          day_of_month: null,
          month_of_year: null,
          next_run_at: null,
          last_posted_period: null,
          last_posted_at: null,
          last_error: null,
          active: true,
          system: true,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
          created_by: 'system',
        })
      created += 1
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 6) continue // exists — user data, never touch
      throw err
    }
  }
  return created
}

/**
 * Ensure the team has accounting settings + a seeded chart + the starter entry
 * templates. Template comes from team.country (CH fallback); account/template
 * names from team.language. Returns the (possibly just-created) settings.
 */
export async function ensureAccountingSeeded(teamId: string): Promise<AccountingSettings> {
  const existing = await loadAccountingSettings(teamId)
  if (existing) {
    // Accounts + templates are create-only — safe to re-run for reinstalls (and
    // how installs from before a seed addition pick up new docs on rebuild).
    await seedAccounts(teamId, existing.chart_template, undefined)
    await seedEntryTemplates(teamId, existing.chart_template, undefined)
    return existing
  }

  const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(teamId).get()
  const team = teamSnap.data() ?? {}
  const templateId = templateForCountry(team.country as string | undefined)
  const settings: Omit<AccountingSettings, 'seeded_at'> = {
    base_currency: normalizeCurrency(team.default_currency as string | undefined),
    fiscal_year_start_month: 1,
    chart_template: templateId,
    mapping: CHART_TEMPLATES[templateId].mapping,
    closed_through_fiscal_year: null,
    last_rebuild: null,
    version: ACCOUNTING_SETTINGS_VERSION,
  }
  await accountingSettingsRef(teamId).set(
    { ...settings, seeded_at: FieldValue.serverTimestamp() },
    { merge: true } // races with a concurrent seed converge
  )
  const created = await seedAccounts(teamId, templateId, team.language as string | undefined)
  const templates = await seedEntryTemplates(
    teamId,
    templateId,
    team.language as string | undefined
  )
  console.log(
    `[accounting] seeded team=${teamId} template=${templateId} accounts=${created} entry_templates=${templates}`
  )
  return (await loadAccountingSettings(teamId))!
}
