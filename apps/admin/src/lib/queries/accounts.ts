import 'server-only'
import type { Team } from '@linyup/shared'
import type { Organization } from '@linyup/shared'
import type { SaasSubscription } from '@linyup/shared'
import type { SaasPlan, SaasStatus } from '@linyup/shared'
import {
  PLAN_PRICING,
  computePlatformMetrics,
  type AccountMetricInput,
  type PlatformMetrics,
} from '@linyup/shared'
import {
  TEAMS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  SAAS_SUBSCRIPTIONS_COLLECTION,
  CONTACTS_COLLECTION,
  USERS_COLLECTION,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'

export type AccountType = 'team' | 'org'

export interface AccountRow {
  type: AccountType
  id: string
  name: string
  plan: SaasPlan | null
  status: SaasStatus | null
  trialEndsAtMs: number | null
  /** Active contacts (teams only — orgs aggregate their teams, out of scope). */
  contactCount: number | null
  includedContacts: number | null
  ownerEmail: string | null
  createdMs: number
  /** Contact-overage units (for MRR); 0 if none. */
  overageQty: number
}

export type OverviewMetrics = PlatformMetrics & { recentSignups: AccountRow[] }

/** Count active contacts for a team — canonical definition (matches the
 *  getActiveContacts util used by the Cloud Functions): deleted_at and
 *  archived_at both null. Equality-only filters need no composite index. */
async function countActiveContacts(teamId: string): Promise<number> {
  const agg = await adminDb
    .collection(CONTACTS_COLLECTION)
    .where('teamId', '==', teamId)
    .where('deleted_at', '==', null)
    .where('archived_at', '==', null)
    .count()
    .get()
  return agg.data().count
}

interface LoadResult {
  rows: AccountRow[]
  subscriptions: Map<string, SaasSubscription>
}

async function loadAccounts(): Promise<LoadResult> {
  const [teamsSnap, orgsSnap, subsSnap] = await Promise.all([
    adminDb.collection(TEAMS_COLLECTION).get(),
    adminDb.collection(ORGANIZATIONS_COLLECTION).get(),
    adminDb.collection(SAAS_SUBSCRIPTIONS_COLLECTION).get(),
  ])

  const subscriptions = new Map<string, SaasSubscription>()
  for (const doc of subsSnap.docs) {
    const sub = doc.data() as SaasSubscription
    subscriptions.set(sub.entity_id ?? doc.id, sub)
  }

  // Resolve owner emails for teams via users/{createdBy}.
  const ownerUids = Array.from(
    new Set(teamsSnap.docs.map((d) => (d.data() as Team).createdBy).filter(Boolean)),
  )
  const ownerEmail = new Map<string, string>()
  if (ownerUids.length) {
    const refs = ownerUids.map((uid) => adminDb.collection(USERS_COLLECTION).doc(uid))
    const userDocs = await adminDb.getAll(...refs)
    for (const ud of userDocs) {
      const email = (ud.data() as { email?: string } | undefined)?.email
      if (email) ownerEmail.set(ud.id, email)
    }
  }

  // Active-contact counts per team, in parallel.
  const teamIds = teamsSnap.docs.map((d) => d.id)
  const counts = await Promise.all(teamIds.map((id) => countActiveContacts(id)))
  const contactCount = new Map<string, number>()
  teamIds.forEach((id, i) => contactCount.set(id, counts[i]!))

  const rows: AccountRow[] = []

  for (const doc of teamsSnap.docs) {
    const team = doc.data() as Team
    const sub = subscriptions.get(doc.id)
    const plan = sub?.plan ?? team.plan ?? null
    const status = sub?.status ?? team.plan_status ?? null
    const trialEndsAtMs = sub?.trial_ends_at?.toMillis?.() ?? team.trial_ends_at?.toMillis?.() ?? null
    rows.push({
      type: 'team',
      id: doc.id,
      name: team.name ?? '(unnamed team)',
      plan,
      status,
      trialEndsAtMs,
      contactCount: contactCount.get(doc.id) ?? 0,
      includedContacts: plan ? PLAN_PRICING[plan].includedContacts : null,
      ownerEmail: ownerEmail.get(team.createdBy) ?? null,
      createdMs: team.created?.toMillis?.() ?? 0,
      overageQty: sub?.gateway_data?.overage?.quantity ?? 0,
    })
  }

  for (const doc of orgsSnap.docs) {
    const org = doc.data() as Organization
    const sub = subscriptions.get(doc.id)
    const plan = sub?.plan ?? org.plan ?? 'organization'
    const status = sub?.status ?? org.plan_status ?? null
    rows.push({
      type: 'org',
      id: doc.id,
      name: org.name ?? '(unnamed org)',
      plan,
      status,
      trialEndsAtMs: sub?.trial_ends_at?.toMillis?.() ?? null,
      contactCount: null,
      includedContacts: plan ? PLAN_PRICING[plan].includedContacts : null,
      ownerEmail: ownerEmail.get(org.createdBy) ?? null,
      createdMs: org.created?.toMillis?.() ?? 0,
      overageQty: sub?.gateway_data?.overage?.quantity ?? 0,
    })
  }

  rows.sort((a, b) => b.createdMs - a.createdMs)
  return { rows, subscriptions }
}

export interface AccountFilters {
  search?: string
  plan?: SaasPlan
  status?: SaasStatus
}

export async function listAccounts(filters: AccountFilters = {}): Promise<AccountRow[]> {
  const { rows } = await loadAccounts()
  const search = filters.search?.trim().toLowerCase()
  return rows.filter((r) => {
    if (filters.plan && r.plan !== filters.plan) return false
    if (filters.status && r.status !== filters.status) return false
    if (search) {
      const hay = `${r.name} ${r.ownerEmail ?? ''}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
}

/** Map an account row to the reducer input shape. */
function toMetricInput(r: AccountRow): AccountMetricInput {
  return {
    type: r.type,
    plan: r.plan,
    status: r.status,
    createdMs: r.createdMs,
    trialEndsAtMs: r.trialEndsAtMs,
    contactCount: r.contactCount,
    overageQty: r.overageQty,
  }
}

export async function getOverviewMetrics(nowMs: number): Promise<OverviewMetrics> {
  const { rows } = await loadAccounts()
  // Same reducer the daily snapshot Cloud Function uses — single source of truth.
  const metrics = computePlatformMetrics(rows.map(toMetricInput), nowMs)
  return { ...metrics, recentSignups: rows.slice(0, 8) }
}
