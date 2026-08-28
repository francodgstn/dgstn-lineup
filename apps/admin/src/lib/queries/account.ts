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
import {
  contactUsageForPlan,
  PLAN_PRICING,
  ORG_PER_STUDIO,
  readGatewayData,
  subscriptionCancellation,
  subscriptionIsCancelling,
} from '@linyup/shared'
import {
  TEAMS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  SAAS_SUBSCRIPTIONS_COLLECTION,
  CONTACTS_COLLECTION,
  USERS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  ORG_MEMBERS_SUBCOLLECTION,
  TEAM_ACTIVITY_LOG_SUBCOLLECTION,
  CONNECT_ACCOUNTS_COLLECTION,
  MEMBER_PAYMENTS_SUBCOLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
} from '@linyup/shared'
import type { ConnectAccount, ConnectOnboardingModel, MemberPayment } from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import type { AccountType } from './accounts'
import type { PaymentsStatus } from '@/components/status-badge'

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
  /**
   * WHETHER the subscription is winding down — still live, not renewing.
   *
   * This is the field to read for "is it cancelling", and it is deliberately
   * separate from `endsAtMs`. It replaces the raw `cancel_at_period_end` the view
   * used to carry, but keeps that field's REACH: it is true for either of the two
   * ways Stripe expresses a cancellation, including a billing-portal cancellation
   * that leaves the boolean false (which is what made the console report
   * "Cancels at period end: No" about a studio that had already left).
   */
  cancelling: boolean
  /**
   * WHEN it stops, when that is known — via the shared `subscriptionEndsAt`.
   *
   * Null does NOT mean "not cancelling". A saas_subscriptions doc written while
   * the readers still looked for the period on the SUBSCRIPTION — which is every
   * doc this codebase wrote under Dahlia, so the whole working population —
   * stored `current_period_end: null` and no `cancel_at`, so a cancelling one
   * from that window has the boolean and no date at all. A console that inferred
   * cancellation from this date alone therefore showed an operator nothing for
   * exactly the accounts worth looking at. Read `cancelling` for the question and
   * this for the detail.
   */
  endsAtMs: number | null
  /** When the studio asked to leave, and why. Churn, in the operator's hands. */
  canceledAtMs: number | null
  cancellationReason: string | null
  cancellationFeedback: string | null
  cancellationComment: string | null
  currentPeriodStartMs: number | null
  currentPeriodEndMs: number | null
  trialEndsAtMs: number | null
  customerId: string | null
  subscriptionId: string | null
  lastPaymentStatus: string | null
  baseMonthly: number
  /** ORGS ONLY — the per-studio rate. The organisation tier has no base fee, so
   *  `baseMonthly` is 0 for it and reading that as "the price" shows an operator
   *  CHF 0.00 for a paying federation. */
  perStudioMonthly: number | null
}

export interface ActivityRow {
  id: string
  event: string
  description: string
  createdMs: number | null
}

// Stripe Connect (member → studio) view for the operator console.
export interface PaymentsView {
  status: PaymentsStatus
  model: ConnectOnboardingModel | null
  connectAccountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  capabilities: Record<string, string>
  requirementsDue: string[]
  // Aggregates over the studio's member payments (CHF, major units).
  paymentsCount: number
  grossCollectedChf: number
  platformFeesChf: number
  refundedChf: number
  activeSubscriptions: number
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
  payments: PaymentsView | null
}

/** Connect account state + aggregated member→studio payment totals for a team. */
async function getTeamPayments(teamId: string, team: Team): Promise<PaymentsView> {
  const p = team.payments
  const connectAccountId = p?.connectAccountId ?? null
  const teamRef = adminDb.collection(TEAMS_COLLECTION).doc(teamId)

  const [payDocs, subAgg, caDoc] = await Promise.all([
    // Cap at 1000 most-recent payments for the aggregate (operator overview).
    teamRef.collection(MEMBER_PAYMENTS_SUBCOLLECTION).limit(1000).get(),
    teamRef
      .collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION)
      .where('status', '==', 'active')
      .count()
      .get(),
    connectAccountId
      ? adminDb.collection(CONNECT_ACCOUNTS_COLLECTION).doc(connectAccountId).get()
      : Promise.resolve(null),
  ])

  let gross = 0
  let fees = 0
  let refunded = 0
  let count = 0
  for (const d of payDocs.docs) {
    const mp = d.data() as MemberPayment
    if (mp.status === 'succeeded' || mp.status === 'partially_refunded' || mp.status === 'refunded') {
      gross += mp.amount ?? 0
      fees += mp.application_fee_amount ?? 0
      refunded += mp.amount_refunded ?? 0
      count++
    }
  }

  const ca = caDoc?.exists ? (caDoc.data() as ConnectAccount) : null
  const status: PaymentsStatus =
    p?.connectEnabled === false
      ? 'disabled'
      : !connectAccountId
        ? 'not_setup'
        : ((ca?.status as PaymentsStatus | undefined) ??
          (p?.connectStatus as PaymentsStatus | undefined) ??
          'pending')

  return {
    status,
    model: p?.connectModel ?? ca?.model ?? null,
    connectAccountId,
    chargesEnabled: ca?.charges_enabled ?? false,
    payoutsEnabled: ca?.payouts_enabled ?? false,
    capabilities: ca?.capabilities ?? {},
    requirementsDue: ca?.requirements_currently_due ?? [],
    paymentsCount: count,
    grossCollectedChf: gross / 100,
    platformFeesChf: fees / 100,
    refundedChf: refunded / 100,
    activeSubscriptions: subAgg.data().count,
  }
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
  // The cancellation is a RECORD, not a boolean: a studio that cancelled in the
  // Stripe billing portal leaves `cancel_at_period_end` false and sets a
  // `cancel_at` timestamp instead, so an operator reading only the boolean was
  // told "No" about a studio that had already left.
  const cancellation = subscriptionCancellation(sub)
  const gateway = readGatewayData(sub as unknown as Record<string, unknown>)
  return {
    plan: sub.plan,
    status: sub.status,
    gatewayType: sub.gateway_type ?? null,
    cancelling: subscriptionIsCancelling(sub),
    endsAtMs: cancellation?.endsAt?.toMillis?.() ?? null,
    canceledAtMs: cancellation?.requestedAt?.toMillis?.() ?? null,
    cancellationReason: cancellation?.reason ?? null,
    cancellationFeedback: cancellation?.feedback ?? null,
    cancellationComment: cancellation?.comment ?? null,
    currentPeriodStartMs: sub.current_period_start?.toMillis?.() ?? null,
    currentPeriodEndMs: sub.current_period_end?.toMillis?.() ?? null,
    trialEndsAtMs: sub.trial_ends_at?.toMillis?.() ?? null,
    // Through readGatewayData: docs written before the dotted-key fix keep these
    // as literal "gateway_data.customer_id" fields, and reading only the nested
    // map showed the operator a blank Stripe id for a live paying studio.
    customerId: gateway.customer_id ?? null,
    subscriptionId: gateway.subscription_id ?? null,
    lastPaymentStatus: gateway.last_payment_status ?? null,
    baseMonthly: PLAN_PRICING[sub.plan].baseMonthly,
    perStudioMonthly: sub.plan === 'organization' ? ORG_PER_STUDIO.monthly : null,
  }
}

async function getTeamDetail(id: string): Promise<AccountDetail | null> {
  const teamRef = adminDb.collection(TEAMS_COLLECTION).doc(id)
  const [teamDoc, subDoc, membersSnap, activitySnap, contactAgg, provisionalAgg] = await Promise.all([
    teamRef.get(),
    adminDb.collection(SAAS_SUBSCRIPTIONS_COLLECTION).doc(id).get(),
    teamRef.collection(TEAM_MEMBERS_SUBCOLLECTION).get(),
    teamRef
      .collection(TEAM_ACTIVITY_LOG_SUBCOLLECTION)
      .orderBy('created_at', 'desc')
      .limit(50)
      .get(),
    adminDb.collection(CONTACTS_COLLECTION).where('teamId', '==', id).count().get(),
    // Provisional leads (trial bookings / form leads / unpaid shop registrations)
    // don't count toward the plan cap — mirror functions utils/contactCap.ts.
    adminDb
      .collection(CONTACTS_COLLECTION)
      .where('teamId', '==', id)
      .where('provisional', '==', true)
      .count()
      .get(),
  ])

  if (!teamDoc.exists) return null
  const team = teamDoc.data() as Team
  const sub = subDoc.exists ? (subDoc.data() as SaasSubscription) : null
  const plan = sub?.plan ?? team.plan ?? null
  const payments = await getTeamPayments(id, team)

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
    contactUsage: contactUsageForPlan(
      plan,
      Math.max(0, contactAgg.data().count - provisionalAgg.data().count)
    ),
    members,
    activity,
    payments,
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
    payments: null,
  }
}

export async function getAccount(
  type: AccountType,
  id: string,
): Promise<AccountDetail | null> {
  return type === 'org' ? getOrgDetail(id) : getTeamDetail(id)
}
