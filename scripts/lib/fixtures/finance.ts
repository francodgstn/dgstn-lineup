/**
 * Shared finance seeding — the journal and the chart of accounts.
 *
 * Franco's decision 2 (2026-08-19): SANDBOX AND LEAD ONLY. Those are the two
 * surfaces a prospect looks at, and `/plugins/finance` opening as an empty shell
 * is the thing worth fixing. The emulator and staging stay lean.
 *
 * ── IT DOES NOT INVENT FINANCE ROWS. IT REPLAYS THE LEDGER. ──────────────────
 * The journal is derived from the `member_payments` rows the money fixture
 * already wrote, through `buildConnectChargeTxn` / `buildConnectRefundTxn` —
 * the SAME builders `connect/webhook.ts` uses — and written through
 * `recordFinanceTransaction`, the same writer. So a seeded journal row is a real
 * journal row: same deterministic id, same sign conventions, same month key.
 *
 * That matters more here than anywhere else in the seeds, because the finance
 * journal is the one place where a plausible-looking wrong number is
 * indistinguishable from a right one. A hand-built row that got `net` or the fee
 * sign backwards would look completely fine on a dashboard.
 *
 * ── WHAT IS DELIBERATELY NOT SEEDED ──────────────────────────────────────────
 *   • `finance_monthly_reports` and `accounting_period_summaries` — both are
 *     regenerated from the journal by cron and always overwritten. Seeding them
 *     would be seeding a cache.
 *   • `accounting_entries` — posted from the journal by the accounting module.
 *     The chart of accounts and the settings are seeded so the module has
 *     something to post INTO; posting itself is the module's job.
 */

import admin from 'firebase-admin'
import { buildConnectChargeTxn, buildConnectRefundTxn } from '@linyup/shared'
// The production seeder and the production journal writer — imported, never
// reproduced, for the reason in the header. Same convention as the sanitizer in
// lib/fixtures/documents.ts.
import { ensureAccountingSeeded } from '../../../packages/functions/src/accounting/seed'
import { recordFinanceTransaction } from '../../../packages/functions/src/finance/journal'

const TEAMS_COLLECTION = 'teams'
const MEMBER_PAYMENTS_SUBCOLLECTION = 'member_payments'
const ASSET_REGISTER_SUBCOLLECTION = 'asset_register'

/**
 * Install the finance plugin, seed the chart of accounts, and replay every
 * seeded `member_payments` row into the journal.
 *
 * Call it AFTER the money fixture — it reads that fixture's output.
 */
export async function seedTeamFinance(opts: {
  teamId: string
  uid: string
  installedDaysAgo?: number
}): Promise<{ accountsSeeded: boolean; journalRows: number; assets: number }> {
  const db = admin.firestore()
  const { teamId, uid } = opts
  const installedDaysAgo = opts.installedDaysAgo ?? 200
  const installedAt = new Date()
  installedAt.setDate(installedAt.getDate() - installedDaysAgo)

  await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection('installed_plugins')
    .doc('finance')
    .set({
      pluginId: 'finance',
      teamId,
      installedAt: admin.firestore.Timestamp.fromDate(installedAt),
      installedBy: uid,
      status: 'active',
      config: {},
      updated_at: admin.firestore.Timestamp.fromDate(installedAt),
    })

  // Settings + chart of accounts + starter entry templates, through the same
  // function plugin activation runs. It is create-only, so a re-seed never
  // clobbers an edited account name — and it picks the chart template and the
  // account language off the TEAM document (country / language / currency),
  // which is why this takes no locale of its own.
  await ensureAccountingSeeded(teamId)

  const assets = await seedTeamAssets(teamId, uid)

  const payments = await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_PAYMENTS_SUBCOLLECTION)
    .get()

  let journalRows = 0
  for (const doc of payments.docs) {
    const p = doc.data()
    // A failed intent moved no money and has no charge behind it, so it earns no
    // journal row — the journal is a log of money EVENTS, not of attempts.
    if (p.status === 'failed') continue

    const occurredAtMs = (p.created_at?.toMillis?.() as number | undefined) ?? Date.now()
    const wrote = await recordFinanceTransaction(
      buildConnectChargeTxn({
        teamId,
        paymentIntentId: p.paymentIntentId as string,
        amount: p.amount as number,
        currency: p.currency as string,
        applicationFeeAmount: (p.application_fee_amount as number) ?? 0,
        // null = no balance transaction was fetched, which is honest: no Stripe
        // object exists behind a seeded row, so the Stripe fee is unknown and
        // the builder records it as 0 with fee_source 'recorded'.
        fees: null,
        kind: (p.kind as string | null) ?? null,
        contactId: (p.contactId as string | null) ?? null,
        description: (p.comment as string | null) ?? null,
        occurredAtMs,
        eventId: 'seed',
      })
    )
    if (wrote) journalRows += 1

    const refunds = (p.refunds ?? []) as Array<{ refundId: string; amount: number; feeReversed: number }>
    for (const r of refunds) {
      const refundWrote = await recordFinanceTransaction(
        buildConnectRefundTxn({
          teamId,
          refundId: r.refundId,
          paymentIntentId: p.paymentIntentId as string,
          amount: r.amount,
          currency: p.currency as string,
          feeReversed: r.feeReversed,
          kind: (p.kind as string | null) ?? null,
          contactId: (p.contactId as string | null) ?? null,
          occurredAtMs,
          eventId: 'seed',
        })
      )
      if (refundWrote) journalRows += 1
    }
  }

  return { accountsSeeded: true, journalRows, assets }
}

/**
 * The asset register — the equipment behind the statement of assets.
 *
 * WHY IT IS SEEDED AT ALL: `/plugins/finance/assets` opening empty is the same
 * "empty shell" problem this module's header cites for the journal, and it is
 * worse here, because the page's whole point is arithmetic — a prospect looking
 * at an empty register learns nothing about what it does.
 *
 * ACQUISITION DATES ARE SPREAD ACROSS YEARS ON PURPOSE. Every row bought today
 * would show book value == cost, which is exactly the screen that makes the
 * depreciation look broken. These span "nearly new" to "fully written down", so
 * the indicative column visibly does something, and one row is past its useful
 * life so the floor-rounding lands on a real zero.
 *
 * Dates are relative to the run day (like the rest of the seeds) and ids are
 * deterministic, so a re-seed overwrites rather than duplicating.
 */
async function seedTeamAssets(teamId: string, uid: string): Promise<number> {
  const db = admin.firestore()
  const now = new Date()
  const monthsAgo = (months: number): Date => {
    const d = new Date(now)
    d.setMonth(d.getMonth() - months)
    return d
  }

  // cost_minor is the ROW TOTAL; quantity is how many things that total bought.
  const rows: Array<{
    id: string
    name: string
    category: 'equipment' | 'leasehold' | 'vehicles' | 'it' | 'other'
    monthsAgo: number
    cost_minor: number
    quantity: number
    useful_life_months: number
    location: string
    disposed?: { monthsAgo: number; kind: 'sold' | 'scrapped'; proceeds_minor: number }
  }> = [
    // Big-ticket, half-way through its life — the row the statement is for.
    { id: 'seed-asset-mats', name: 'Tatami mat flooring (120 m²)', category: 'leasehold',
      monthsAgo: 54, cost_minor: 1_240_000, quantity: 1, useful_life_months: 120,
      location: 'Main hall' },
    // The batch case: one purchase, many things.
    { id: 'seed-asset-gloves', name: 'Sparring gloves', category: 'equipment',
      monthsAgo: 14, cost_minor: 156_000, quantity: 24, useful_life_months: 60,
      location: 'Equipment store' },
    { id: 'seed-asset-shields', name: 'Kick shields', category: 'equipment',
      monthsAgo: 8, cost_minor: 78_000, quantity: 8, useful_life_months: 60,
      location: 'Equipment store' },
    // Past its useful life — book value must render as exactly 0.
    { id: 'seed-asset-bags', name: 'Heavy bags', category: 'equipment',
      monthsAgo: 78, cost_minor: 210_000, quantity: 6, useful_life_months: 60,
      location: 'Main hall' },
    // Short life, nearly new — the other end of the range.
    { id: 'seed-asset-laptop', name: 'Reception laptop', category: 'it',
      monthsAgo: 5, cost_minor: 129_000, quantity: 1, useful_life_months: 36,
      location: 'Reception' },
    { id: 'seed-asset-sound', name: 'PA system', category: 'equipment',
      monthsAgo: 27, cost_minor: 89_000, quantity: 1, useful_life_months: 60,
      location: 'Main hall' },
    // One already gone, so the disposed branch and the active-only totals are
    // both exercised by the seed rather than only by a human clicking.
    { id: 'seed-asset-treadmill', name: 'Treadmill', category: 'equipment',
      monthsAgo: 62, cost_minor: 320_000, quantity: 1, useful_life_months: 60,
      location: 'Conditioning room',
      disposed: { monthsAgo: 3, kind: 'sold', proceeds_minor: 40_000 } },
  ]

  const batch = db.batch()
  const col = db.collection(TEAMS_COLLECTION).doc(teamId).collection(ASSET_REGISTER_SUBCOLLECTION)
  for (const r of rows) {
    batch.set(col.doc(r.id), {
      id: r.id,
      teamId,
      name: r.name,
      category: r.category,
      acquired_at: admin.firestore.Timestamp.fromDate(monthsAgo(r.monthsAgo)),
      cost_minor: r.cost_minor,
      quantity: r.quantity,
      useful_life_months: r.useful_life_months,
      location: r.location,
      note: null,
      photoUrl: null,
      status: r.disposed ? 'disposed' : 'active',
      disposed_at: r.disposed
        ? admin.firestore.Timestamp.fromDate(monthsAgo(r.disposed.monthsAgo))
        : null,
      disposal_kind: r.disposed ? r.disposed.kind : null,
      disposal_proceeds_minor: r.disposed ? r.disposed.proceeds_minor : null,
      created_at: admin.firestore.Timestamp.fromDate(monthsAgo(r.monthsAgo)),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      created_by: uid,
    })
  }
  await batch.commit()
  return rows.length
}
