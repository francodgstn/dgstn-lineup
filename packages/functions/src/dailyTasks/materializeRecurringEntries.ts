/* eslint-disable no-console */
// Recurring entry-template materializer — the daily task that auto-posts
// due recurring accounting templates (e.g. rent on the 1st of the month).
//
// Sweep pattern mirrors runScheduledRules (collectionGroup over team
// subcollections) + expirePendingBookings (timestamp-due filter): one query
// for templates whose next_run_at is due, grouped by team, per-item try/catch.
//
// Correctness properties:
// - IDEMPOTENT: entries use the deterministic id `manual:tpl:{id}:{period}`
//   and create() — a re-run (or a crash before the template doc update) posts
//   nothing twice. The summary recompute runs even on ALREADY_EXISTS so a
//   crash between create and recompute heals on the next sweep.
// - SKIP-AND-ADVANCE on validation errors (closed fiscal year, deactivated
//   account): the occurrence is skipped, `last_error` is stamped for the UI,
//   and the recurrence still advances — a permanently failing occurrence must
//   never wedge the template.
// - SKIP-WITHOUT-ADVANCING for archived teams / uninstalled plugin: the books
//   are frozen, not wrong. The catch-up loop is capped so a later reinstall
//   replays at most a bounded backlog instead of flooding the ledger.

import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  ACCOUNTING_ENTRY_TEMPLATES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  buildTemplateLines,
  computeNextRunMs,
  fiscalYearOf,
  monthKey,
  templateEntryId,
  validateManualEntryInput,
  type AccountingEntryTemplate,
} from '@linyup/shared'
import { accountsCollection, loadAccountingSettings } from '../accounting/seed'
import { createEntry, recomputePeriodSummary } from '../accounting/store'
import { isFinancePluginActive } from '../finance/access'

/** Max occurrences posted per template per sweep (bounds reinstall catch-up). */
const MAX_CATCHUP_OCCURRENCES = 12

export async function materializeRecurringEntries(): Promise<{
  teams: number
  templates: number
  posted: number
  skipped: number
  errors: number
}> {
  const db = admin.firestore()
  const now = Timestamp.now()
  const nowMs = now.toMillis()

  const dueSnap = await db
    .collectionGroup(ACCOUNTING_ENTRY_TEMPLATES_SUBCOLLECTION)
    .where('next_run_at', '<=', now)
    .get()
  if (dueSnap.empty) return { teams: 0, templates: 0, posted: 0, skipped: 0, errors: 0 }

  // Group due templates by team (ref path: teams/{teamId}/accounting_entry_templates/{id}).
  const byTeam = new Map<string, typeof dueSnap.docs>()
  for (const doc of dueSnap.docs) {
    const teamId = doc.ref.parent.parent?.id
    if (!teamId) continue
    const list = byTeam.get(teamId) ?? []
    list.push(doc)
    byTeam.set(teamId, list)
  }

  let posted = 0
  let skipped = 0
  let errors = 0
  let templates = 0

  for (const [teamId, docs] of byTeam) {
    try {
      const teamSnap = await db.collection(TEAMS_COLLECTION).doc(teamId).get()
      if (!teamSnap.exists || teamSnap.data()?.archived_at != null) continue // frozen — don't advance
      if (!(await isFinancePluginActive(teamId))) continue // uninstalled — don't advance
      const settings = await loadAccountingSettings(teamId)
      if (!settings) continue
      const accountsSnap = await accountsCollection(teamId).get()
      const accounts = accountsSnap.docs.map((d) => ({
        code: d.data().code as string,
        active: d.data().active !== false,
      }))

      for (const doc of docs) {
        templates += 1
        try {
          const t = doc.data() as AccountingEntryTemplate
          // Defensive belt: the sweep already filters on next_run_at, but the
          // doc may have been edited between query and processing.
          if (
            !t.active ||
            t.recurrence === 'none' ||
            t.amount_minor == null ||
            t.next_run_at == null
          ) {
            continue
          }

          let runMs = t.next_run_at.toMillis()
          let lastError: string | null = null
          let lastPostedPeriod: string | null = null
          let iterations = 0
          while (runMs <= nowMs && iterations < MAX_CATCHUP_OCCURRENCES) {
            const period = monthKey(runMs)
            const lines = buildTemplateLines(t, t.amount_minor)
            const errs = validateManualEntryInput(
              { dateMs: runMs, description: t.name, lines },
              accounts,
              settings,
              Date.now(),
              period
            )
            if (errs.length > 0) {
              // Skip this occurrence but keep advancing — surfaced via last_error.
              lastError = errs[0]
              skipped += 1
            } else {
              const entryId = templateEntryId(t.id ?? doc.id, period)
              try {
                await createEntry({
                  id: entryId,
                  teamId,
                  date_ms: runMs,
                  period,
                  fiscal_year: fiscalYearOf(period, settings.fiscal_year_start_month),
                  source: 'manual',
                  finance_txn_id: null,
                  description: t.name,
                  currency: settings.base_currency,
                  lines,
                  total_debit: t.amount_minor,
                  total_credit: t.amount_minor,
                  created_by: 'system',
                })
                posted += 1
              } catch (err: unknown) {
                if ((err as { code?: number }).code !== 6) throw err // 6 = ALREADY_EXISTS → no-op
              }
              // Recompute even on ALREADY_EXISTS: heals a crash between the
              // entry create and the summary recompute of a previous sweep.
              await recomputePeriodSummary(teamId, period)
              lastError = null
              lastPostedPeriod = period
            }
            runMs = computeNextRunMs(t.recurrence, t.day_of_month ?? 1, t.month_of_year, runMs)
            iterations += 1
          }

          // Advance AFTER posting: if this update fails, tomorrow replays the
          // occurrences — entries are create-only, so replay is a no-op.
          await doc.ref.update({
            next_run_at: Timestamp.fromMillis(runMs),
            last_error: lastError,
            ...(lastPostedPeriod
              ? {
                  last_posted_period: lastPostedPeriod,
                  last_posted_at: Timestamp.now(),
                }
              : {}),
          })
        } catch (err) {
          errors += 1
          console.error(`[accounting] recurring template ${teamId}/${doc.id} failed:`, err)
        }
      }
    } catch (err) {
      errors += 1
      console.error(`[accounting] recurring sweep failed for team ${teamId}:`, err)
    }
  }

  const result = { teams: byTeam.size, templates, posted, skipped, errors }
  console.log('[accounting] materializeRecurringEntries:', result)
  return result
}
