import type { SaasPlan, SaasStatus } from './team'
import { PLAN_PRICING } from './plan'

// ─── Platform-wide operator metrics ─────────────────────────────────────────
// A single source of truth for the operator console. The same pure reducer
// powers BOTH the live Overview (admin app, Admin SDK) and the daily snapshot
// (capturePlatformMetrics Cloud Function) so the two can never drift.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/** One account (team or org) reduced to just the fields metrics need. */
export interface AccountMetricInput {
  type: 'team' | 'org'
  plan: SaasPlan | null
  status: SaasStatus | null
  createdMs: number
  trialEndsAtMs: number | null
  /** Active contacts (teams only); null for orgs (they aggregate their teams). */
  contactCount: number | null
  /**
   * A REAL customer the platform bills nothing (`TenantFlags.comped`).
   *
   * COUNTED in every account, contact and signup figure — that is the whole
   * point of the flag, and hiding them (as `internal` does) would understate the
   * platform at exactly the moment its largest tenant arrives. But EXCLUDED from
   * MRR: a comped org sits on `plan_status: 'active'` with no Stripe
   * subscription, so charging it the plan's list price to the revenue line would
   * invent money that no invoice exists for.
   */
  comped?: boolean
}

export interface PlatformMetrics {
  accounts: {
    total: number
    teams: number
    orgs: number
    byStatus: Record<SaasStatus, number>
    byPlan: Record<SaasPlan, number>
    /** Of `total`, how many are comped — real usage that bills nothing. Reported
     *  separately so "active accounts" and "paying accounts" stop being read as
     *  the same number. */
    comped: number
  }
  /** Indicative MRR in CHF from active subscriptions (Stripe is authoritative). */
  mrr: { estimatedChf: number; byPlan: Record<SaasPlan, number> }
  contacts: { totalActive: number }
  trials: { active: number; expiring7d: number }
  signups: { last7d: number; last30d: number; cumulative: number }
}

const emptyStatus = (): Record<SaasStatus, number> => ({
  trial: 0,
  active: 0,
  past_due: 0,
  cancelled: 0,
  expired: 0,
})

const emptyPlan = (): Record<SaasPlan, number> => ({ free: 0, coach: 0, studio: 0, organization: 0 })

export function computePlatformMetrics(
  accounts: AccountMetricInput[],
  nowMs: number,
): PlatformMetrics {
  const byStatus = emptyStatus()
  const byPlan = emptyPlan()
  const mrrByPlan = emptyPlan()
  let teams = 0
  let orgs = 0
  let totalActive = 0
  let estimatedChf = 0
  let trialsActive = 0
  let trialsExpiring7d = 0
  let last7d = 0
  let last30d = 0
  let comped = 0

  for (const a of accounts) {
    if (a.type === 'org') orgs += 1
    else teams += 1
    if (a.status) byStatus[a.status] += 1
    if (a.plan) byPlan[a.plan] += 1
    if (a.contactCount) totalActive += a.contactCount
    if (a.comped) comped += 1

    const age = nowMs - a.createdMs
    if (age <= SEVEN_DAYS_MS) last7d += 1
    if (age <= THIRTY_DAYS_MS) last30d += 1

    if (a.status === 'trial') {
      trialsActive += 1
      if (a.trialEndsAtMs != null && a.trialEndsAtMs >= nowMs && a.trialEndsAtMs <= nowMs + SEVEN_DAYS_MS) {
        trialsExpiring7d += 1
      }
    }

    // MRR: only paying (active) subscriptions count. Flat per-plan base — there
    // is no per-contact overage (caps are enforced by upgrade/blocks, not metering).
    // A COMPED account is 'active' and has a plan, and pays nothing for it.
    if (a.status === 'active' && a.plan && !a.comped) {
      const amount = PLAN_PRICING[a.plan].baseMonthly
      estimatedChf += amount
      mrrByPlan[a.plan] += amount
    }
  }

  return {
    accounts: { total: accounts.length, teams, orgs, byStatus, byPlan, comped },
    mrr: { estimatedChf, byPlan: mrrByPlan },
    contacts: { totalActive },
    trials: { active: trialsActive, expiring7d: trialsExpiring7d },
    signups: { last7d, last30d, cumulative: accounts.length },
  }
}

// ─── Stored snapshot ────────────────────────────────────────────────────────
// Persisted at platform_metrics/{YYYY-MM-DD}. snake_case to match Firestore
// conventions elsewhere in the repo. `captured_at` (a server Timestamp) is
// added by the writer and is not part of this serializable mapping.

export interface PlatformMetricsDoc {
  date: string
  accounts: {
    total: number
    teams: number
    orgs: number
    by_status: Record<SaasStatus, number>
    by_plan: Record<SaasPlan, number>
    comped: number
  }
  mrr: { estimated_chf: number; by_plan: Record<SaasPlan, number> }
  contacts: { total_active: number }
  trials: { active: number; expiring_7d: number }
  signups: { last_7d: number; last_30d: number; cumulative: number }
}

export function platformMetricsToDoc(date: string, m: PlatformMetrics): PlatformMetricsDoc {
  return {
    date,
    accounts: {
      total: m.accounts.total,
      teams: m.accounts.teams,
      orgs: m.accounts.orgs,
      by_status: m.accounts.byStatus,
      by_plan: m.accounts.byPlan,
      comped: m.accounts.comped,
    },
    mrr: { estimated_chf: m.mrr.estimatedChf, by_plan: m.mrr.byPlan },
    contacts: { total_active: m.contacts.totalActive },
    trials: { active: m.trials.active, expiring_7d: m.trials.expiring7d },
    signups: {
      last_7d: m.signups.last7d,
      last_30d: m.signups.last30d,
      cumulative: m.signups.cumulative,
    },
  }
}
