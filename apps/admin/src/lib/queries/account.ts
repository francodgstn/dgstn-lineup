import 'server-only'
import type {
  Team,
  Organization,
  SaasSubscription,
  TeamMember,
  OrgMember,
  ActivityLogEntry,
  SaasPlan,
  SaasStatus,
  ContactUsage,
} from '@linyup/shared'
import { contactUsageForPlan, PLAN_PRICING } from '@linyup/shared'
import {
  TEAMS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  SAAS_SUBSCRIPTIONS_COLLECTION,
  CONTACTS_COLLECTION,
  USERS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  ORG_MEMBERS_SUBCOLLECTION,
  TEAM_ACTIVITY_LOG_SUBCOLLECTION,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import type { AccountType } from './accounts'

export interface MemberRow {
  userId: string
  email: string | null
  role: string
  joinedMs: number | null
}

export interface SubscriptionView {
  plan: SaasPlan
  status: SaasStatus
  gatewayType: string | null
  cancelAtPeriodEnd: boolean
  currentPeriodStartMs: number | null
  currentPeriodEndMs: number | null
  trialEndsAtMs: number | null
  customerId: string | null
  subscriptionId: string | null
  lastPaymentStatus: string | null
  baseMonthly: number
}

export interface ActivityRow {
  id: string
  event: string
  description: string
  createdMs: number | null
}

export interface AccountDetail {
  type: AccountType
  id: string
  name: string
  slug: string | null
  description: string | null
  plan: SaasPlan | null
  status: SaasStatus | null
  createdMs: number
  orgId: string | null
  subscription: SubscriptionView | null
  contactUsage: ContactUsage | null
  members: MemberRow[]
  activity: ActivityRow[]
}

async function resolveEmails(uids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = Array.from(new Set(uids.filter(Boolean)))
  if (!unique.length) return map
  const refs = unique.map((uid) => adminDb.collection(USERS_COLLECTION).doc(uid))
  const docs = await adminDb.getAll(...refs)
  for (const d of docs) {
    const email = (d.data() as { email?: string } | undefined)?.email
    if (email) map.set(d.id, email)
  }
  return map
}

function toSubscriptionView(sub: SaasSubscription): SubscriptionView {
  return {
    plan: sub.plan,
    status: sub.status,
    gatewayType: sub.gateway_type ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    currentPeriodStartMs: sub.current_period_start?.toMillis?.() ?? null,
    currentPeriodEndMs: sub.current_period_end?.toMillis?.() ?? null,
    trialEndsAtMs: sub.trial_ends_at?.toMillis?.() ?? null,
    customerId: sub.gateway_data?.customer_id ?? null,
    subscriptionId: sub.gateway_data?.subscription_id ?? null,
    lastPaymentStatus: sub.gateway_data?.last_payment_status ?? null,
    baseMonthly: PLAN_PRICING[sub.plan].baseMonthly,
  }
}

async function getTeamDetail(id: string): Promise<AccountDetail | null> {
  const teamRef = adminDb.collection(TEAMS_COLLECTION).doc(id)
  const [teamDoc, subDoc, membersSnap, activitySnap, contactAgg] = await Promise.all([
    teamRef.get(),
    adminDb.collection(SAAS_SUBSCRIPTIONS_COLLECTION).doc(id).get(),
    teamRef.collection(TEAM_MEMBERS_SUBCOLLECTION).get(),
    teamRef
      .collection(TEAM_ACTIVITY_LOG_SUBCOLLECTION)
      .orderBy('created_at', 'desc')
      .limit(50)
      .get(),
    adminDb.collection(CONTACTS_COLLECTION).where('teamId', '==', id).count().get(),
  ])

  if (!teamDoc.exists) return null
  const team = teamDoc.data() as Team
  const sub = subDoc.exists ? (subDoc.data() as SaasSubscription) : null
  const plan = sub?.plan ?? team.plan ?? null

  const memberDocs = membersSnap.docs.map((d) => d.data() as TeamMember)
  const emails = await resolveEmails(memberDocs.map((m) => m.userId))
  const members: MemberRow[] = memberDocs.map((m) => ({
    userId: m.userId,
    email: emails.get(m.userId) ?? null,
    role: m.role,
    joinedMs: m.joined?.toMillis?.() ?? null,
  }))

  const activity: ActivityRow[] = activitySnap.docs.map((d) => {
    const e = d.data() as ActivityLogEntry
    return {
      id: d.id,
      event: e.event,
      description: e.parameters?.description ?? '',
      createdMs: e.created_at?.toMillis?.() ?? null,
    }
  })

  return {
    type: 'team',
    id,
    name: team.name ?? '(unnamed team)',
    slug: team.slug ?? null,
    description: team.description ?? null,
    plan,
    status: sub?.status ?? team.plan_status ?? null,
    createdMs: team.created?.toMillis?.() ?? 0,
    orgId: team.org_id ?? null,
    subscription: sub ? toSubscriptionView(sub) : null,
    contactUsage: contactUsageForPlan(plan, contactAgg.data().count),
    members,
    activity,
  }
}

async function getOrgDetail(id: string): Promise<AccountDetail | null> {
  const orgRef = adminDb.collection(ORGANIZATIONS_COLLECTION).doc(id)
  const [orgDoc, subDoc, membersSnap] = await Promise.all([
    orgRef.get(),
    adminDb.collection(SAAS_SUBSCRIPTIONS_COLLECTION).doc(id).get(),
    orgRef.collection(ORG_MEMBERS_SUBCOLLECTION).get(),
  ])

  if (!orgDoc.exists) return null
  const org = orgDoc.data() as Organization
  const sub = subDoc.exists ? (subDoc.data() as SaasSubscription) : null

  const memberDocs = membersSnap.docs.map((d) => d.data() as OrgMember)
  const emails = await resolveEmails(memberDocs.map((m) => m.userId))
  const members: MemberRow[] = memberDocs.map((m) => ({
    userId: m.userId,
    email: emails.get(m.userId) ?? null,
    role: m.role,
    joinedMs: m.joined?.toMillis?.() ?? null,
  }))

  return {
    type: 'org',
    id,
    name: org.name ?? '(unnamed org)',
    slug: org.slug ?? null,
    description: org.description ?? null,
    plan: sub?.plan ?? org.plan ?? 'organization',
    status: sub?.status ?? org.plan_status ?? null,
    createdMs: org.created?.toMillis?.() ?? 0,
    orgId: null,
    subscription: sub ? toSubscriptionView(sub) : null,
    contactUsage: null,
    members,
    activity: [],
  }
}

export async function getAccount(
  type: AccountType,
  id: string,
): Promise<AccountDetail | null> {
  return type === 'org' ? getOrgDetail(id) : getTeamDetail(id)
}
