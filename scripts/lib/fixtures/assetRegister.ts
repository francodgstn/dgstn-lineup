/**
 * Asset register seeding — the equipment list behind the statement of assets.
 *
 * ITS OWN FIXTURE because the register is its own PLUGIN (`asset-register`),
 * not a finance feature. It used to ride inside `seedTeamFinance`, which made
 * it invisible to any tenant that has the register without the ledger — the
 * exact tenant the split exists to serve.
 *
 * WHY IT IS SEEDED AT ALL: `/plugins/asset-register` opening empty is the
 * "empty shell" problem the finance fixture's header cites for the journal, and
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

import admin from 'firebase-admin'

const TEAMS_COLLECTION = 'teams'
const INSTALLED_PLUGINS_SUBCOLLECTION = 'installed_plugins'
const ASSET_REGISTER_SUBCOLLECTION = 'asset_register'
const ASSET_REGISTER_PLUGIN_ID = 'asset-register'

/** Install the plugin and seed the register. Safe to call for any plan tier. */
export async function seedTeamAssetRegister(opts: {
  teamId: string
  uid: string
  installedDaysAgo?: number
}): Promise<{ assets: number }> {
  const db = admin.firestore()
  const { teamId, uid } = opts
  const installedAt = new Date()
  installedAt.setDate(installedAt.getDate() - (opts.installedDaysAgo ?? 200))

  await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
    .doc(ASSET_REGISTER_PLUGIN_ID)
    .set({
      pluginId: ASSET_REGISTER_PLUGIN_ID,
      teamId,
      installedAt: admin.firestore.Timestamp.fromDate(installedAt),
      installedBy: uid,
      status: 'active',
      config: {},
      updated_at: admin.firestore.Timestamp.fromDate(installedAt),
    })

  const assets = await seedTeamAssets(teamId, uid)
  return { assets }
}

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
