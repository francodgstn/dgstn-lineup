/**
 * Shared Stripe Connect wiring for the dev/seed scripts.
 *
 * Writes the two Firestore docs the "pay with Linyup" (member → studio) flow reads:
 *   • connect_accounts/{acct}       — the webhook's account → team map + status mirror
 *   • teams/{teamId}.payments       — the compact mirror checkout gates on
 *     (requireChargeableAccount() needs connectStatus === 'enabled')
 *
 * No Stripe call by default: it TRUSTS that the given acct_ id is an already-onboarded
 * TEST account and marks it chargeable (ASSUMED_ENABLED). Pass a real status (fetched
 * from Stripe) to override. The actual charge later runs against the real Stripe test
 * account via the Functions, so the acct must genuinely be onboarded.
 *
 * The SEEDERS don't call linkConnectAccount directly — they use the
 * planSeedConnectAccounts / linkSeedConnectAccount / reportSeedConnectAccounts
 * trio at the bottom of this file, which adds the "no account configured ⇒ write
 * nothing, say so once" rule. Read that section's header for the one-time setup.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { TEAMS_COLLECTION, CONNECT_ACCOUNTS_COLLECTION } from '@linyup/shared'

export type ConnectModel = 'byo' | 'managed'

export interface ConnectStatus {
  status: 'pending' | 'restricted' | 'enabled' | 'rejected'
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  capabilities: Record<string, string>
  requirements_currently_due: string[]
}

/** Force-enabled status for a known-onboarded test account (no Stripe call). */
export const ASSUMED_ENABLED: ConnectStatus = {
  status: 'enabled',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: 'active', twint_payments: 'active' },
  requirements_currently_due: [],
}

/** Wire a Stripe connected account to a team (both docs). Idempotent (merge). */
export async function linkConnectAccount(params: {
  db: admin.firestore.Firestore
  teamId: string
  accountId: string
  model?: ConnectModel
  status?: ConnectStatus
}): Promise<void> {
  const { db, teamId, accountId } = params
  const model = params.model ?? 'managed'
  const status = params.status ?? ASSUMED_ENABLED
  const now = FieldValue.serverTimestamp()

  // 1) connect_accounts/{acct} — account → team map + status mirror.
  await db
    .collection(CONNECT_ACCOUNTS_COLLECTION)
    .doc(accountId)
    .set(
      {
        teamId,
        stripeAccountId: accountId,
        model,
        status: status.status,
        charges_enabled: status.charges_enabled,
        payouts_enabled: status.payouts_enabled,
        details_submitted: status.details_submitted,
        capabilities: status.capabilities,
        requirements_currently_due: status.requirements_currently_due,
        requirements_disabled_reason: null,
        default_currency: 'chf',
        updated_at: now,
        created_at: now,
      },
      { merge: true }
    )

  // 2) teams/{teamId}.payments — compact mirror checkout + dashboard read.
  await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .set(
      { payments: { connectEnabled: true, connectAccountId: accountId, connectModel: model, connectStatus: status.status } },
      { merge: true }
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed-time wiring — driven by STRIPE_CONNECT_TEST_ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY this exists: `TeamPublicProfile.payments_enabled` fails CLOSED (UX-33), and
// a seed that wrote `connectStatus: 'enabled'` with no real account behind it
// would put a Pay button in front of a prospect that dies with
// `failed-precondition` at the callable — the exact lie UX-33 removed. So the
// seeders link a REAL Stripe **test** connected account when the developer has
// one, and write NOTHING at all when they don't.
//
// ONE ACCOUNT BACKS ONE TEAM. `connect_accounts/{acct}.teamId` is the only
// account → team map the Connect webhook has (`resolveTeam` in
// packages/functions/src/connect/webhook.ts), so pointing one acct at a second
// team STEALS the routing from the first: that team's `checkout.session.completed`
// would book a seat, mint a gift card or unlock a course on the WRONG tenant.
// Hence the pool below is CONSUMED — each acct id is handed to exactly one team,
// and teams left over stay honestly closed with a named warning.
//
// ── One-time setup ───────────────────────────────────────────────────────────
//   1. Seed once without it, sign in as a studio, and complete Settings →
//      Payments → connect against Stripe TEST (bank 000123456789 / routing
//      110000000, any test identity).
//   2. Copy the acct_… id (`pnpm connect:test-account --list` prints them).
//   3. Export it — one id, or several comma-separated, or `teamId=acct_…` pins:
//        export STRIPE_CONNECT_TEST_ACCOUNT=acct_123
//        export STRIPE_CONNECT_TEST_ACCOUNT="seed-team-studio=acct_123,acct_456"
//      (or add the same `STRIPE_CONNECT_TEST_ACCOUNT=` line to
//      packages/functions/.env.local, which is read as a fallback).
//   4. Re-seed. Priced doors appear on the teams that got an account.
//
// Unset ⇒ silent skip: one informational line at the end of the seed, no error.

const SEED_CONNECT_ENV = 'STRIPE_CONNECT_TEST_ACCOUNT'

/** The env var, or the same key from packages/functions/.env.local. */
function readSeedConnectEnv(): string | undefined {
  const fromEnv = process.env[SEED_CONNECT_ENV]
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  const envPath = path.resolve(__dirname, '../../packages/functions/.env.local')
  try {
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith(`${SEED_CONNECT_ENV}=`))
    if (line) {
      const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
      return value || undefined
    }
  } catch {
    /* no .env.local — fall through */
  }
  return undefined
}

interface SeedConnectPlan {
  /** teamId → acct id, decided up front. Empty when the env var is unset. */
  assigned: Map<string, string>
  /** Teams that asked for an account and there wasn't one left. */
  unfunded: string[]
  /** Entries that weren't `acct_…` or `teamId=acct_…`. */
  invalid: string[]
  /** Teams actually linked (filled in as linkSeedConnectAccount runs). */
  linked: Array<{ teamId: string; accountId: string }>
  configured: boolean
}

let plan: SeedConnectPlan | null = null

/**
 * Decide, ONCE and up front, which seeded teams get a Stripe test account.
 *
 * `teamIds` is in PRIORITY order — put the team whose priced surfaces you
 * actually demo first, because the pool runs out. Safe to call with the full
 * team list even when the env var is unset (everything then skips silently).
 *
 * `opts.pinned` is for a seeder that has a per-team source of its own (a CLI
 * flag, a lead profile field): those win over the env var and are never taken
 * from the pool.
 */
export function planSeedConnectAccounts(
  teamIds: string[],
  opts?: { pinned?: Record<string, string | undefined> }
): void {
  const raw = readSeedConnectEnv()
  const pins = Object.entries(opts?.pinned ?? {}).filter(([, v]) => !!v) as Array<[string, string]>
  plan = {
    assigned: new Map(),
    unfunded: [],
    invalid: [],
    linked: [],
    configured: !!raw || pins.length > 0,
  }
  for (const [teamId, acct] of pins) {
    if (acct.startsWith('acct_')) plan.assigned.set(teamId, acct)
    else plan.invalid.push(`${teamId}=${acct}`)
  }
  if (!raw) {
    for (const teamId of teamIds) if (!plan.assigned.has(teamId)) plan.unfunded.push(teamId)
    // Nothing configured at all → stay quiet about "unfunded" and report the
    // plain unconfigured state instead.
    if (!plan.configured) plan.unfunded = []
    return
  }

  const pool: string[] = []
  for (const entry of raw.split(/[,\s]+/).filter(Boolean)) {
    const eq = entry.indexOf('=')
    if (eq > 0) {
      const teamId = entry.slice(0, eq)
      const acct = entry.slice(eq + 1)
      if (!acct.startsWith('acct_')) plan.invalid.push(entry)
      else if (!plan.assigned.has(teamId)) plan.assigned.set(teamId, acct) // opts.pinned wins
    } else if (entry.startsWith('acct_')) {
      pool.push(entry)
    } else {
      plan.invalid.push(entry)
    }
  }

  for (const teamId of teamIds) {
    if (plan.assigned.has(teamId)) continue // pinned explicitly — leave it
    const next = pool.shift()
    if (next) plan.assigned.set(teamId, next)
    else plan.unfunded.push(teamId)
  }
}

/**
 * Link this team's Stripe test account, if one was assigned. No-op (and silent)
 * otherwise — a seed run without STRIPE_CONNECT_TEST_ACCOUNT must leave the
 * honest closed state behind, not a fake one.
 *
 * Also mirrors the two derived public fields (`payments_enabled` and
 * `active_public_surfaces.shop`) that syncTeamPublicProfile computes from
 * `teams/{id}.payments`, because the sync trigger is not guaranteed to be
 * running for a seed (emulator started without `functions`, sandbox behind main).
 * The trigger recomputes the same values on the team write this makes.
 */
export async function linkSeedConnectAccount(params: {
  db: admin.firestore.Firestore
  teamId: string
  model?: ConnectModel
}): Promise<boolean> {
  if (!plan) planSeedConnectAccounts([params.teamId])
  const accountId = plan!.assigned.get(params.teamId)
  if (!accountId) return false

  await linkConnectAccount({ db: params.db, teamId: params.teamId, accountId, model: params.model })
  await params.db
    .collection(TEAMS_COLLECTION)
    .doc(params.teamId)
    .collection('public_profile')
    .doc(params.teamId)
    .set({ payments_enabled: true, active_public_surfaces: { shop: true } }, { merge: true })

  plan!.linked.push({ teamId: params.teamId, accountId })
  return true
}

/**
 * One block at the end of a seed saying what the priced doors are doing. Prints
 * a WARNING, never an error — a developer, a fresh clone and CI all run without
 * a Stripe test account and that is a supported state.
 */
export function reportSeedConnectAccounts(): void {
  if (!plan) return
  if (!plan.configured) {
    console.log(
      `\n⚠️  No Stripe test account configured (${SEED_CONNECT_ENV} unset) — seeded teams show`
    )
    console.log('   NO priced doors: no shop, no drop-in price, no priced trial, no priced')
    console.log('   appointment duration. This is honest, not broken: payments_enabled fails')
    console.log('   closed without a chargeable Connect account (UX-33).')
    console.log(`   To show priced surfaces, see the setup notes in scripts/lib/connect.ts.`)
    return
  }
  for (const e of plan.invalid) {
    console.log(`⚠️  Ignoring ${SEED_CONNECT_ENV} entry '${e}' — expected acct_… or teamId=acct_…`)
  }
  if (plan.linked.length) {
    console.log('\n💳 Stripe Connect (TEST) linked — priced doors are live for:')
    for (const l of plan.linked) console.log(`   ${l.teamId.padEnd(24)} → ${l.accountId}`)
  }
  if (plan.unfunded.length) {
    console.log(
      `\n⚠️  No account left for: ${plan.unfunded.join(', ')} — these teams show no priced doors.`
    )
    console.log('   One Stripe account maps to exactly ONE team (connect_accounts/{acct}.teamId is')
    console.log('   what the webhook routes on), so a second team needs a second onboarded test')
    console.log(`   account: ${SEED_CONNECT_ENV}="acct_first,acct_second".`)
  }
}
