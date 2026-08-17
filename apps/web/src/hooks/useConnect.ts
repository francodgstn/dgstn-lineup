'use client'

// Client hooks for the Stripe Connect feature (member → studio payments).
// All writes go through Cloud Functions; reads of the payment list come straight
// from Firestore (function-written, rules allow manager/owner reads).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { httpsCallable } from 'firebase/functions'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db, functions } from '@/lib/firebase'
import { usePaymentMutationErrorToast } from './usePaymentErrorToast'
import {
  MEMBER_PAYMENTS_SUBCOLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  PARTNER_VISITS_SUBCOLLECTION,
  PAYMENT_EVENTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type ConnectAccountStatus,
  type ConnectOnboardingModel,
  type ExternalPayment,
  type MemberPayment,
  type MemberPaymentEffectsReversal,
  type MemberSubscription,
  type PartnerVisit,
  type PaymentLineItem,
} from '@linyup/shared'

/** The browser origin to send to checkout/onboarding callables so Stripe returns
 * here (localhost in dev) instead of the env-configured hosting URL. */
function clientOrigin(): string | undefined {
  return typeof window !== 'undefined' ? window.location.origin : undefined
}

export interface ConnectStatusResult {
  connected: boolean
  accountId?: string
  model?: ConnectOnboardingModel
  status?: ConnectAccountStatus
  charges_enabled?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
  capabilities?: Record<string, string>
  requirements_currently_due?: string[]
}

/** Live account status (refreshes from Stripe). Only call when the feature flag is on. */
export function useConnectStatus(teamId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['connect-status', teamId],
    enabled: !!teamId && enabled,
    queryFn: async (): Promise<ConnectStatusResult> => {
      const fn = httpsCallable<{ teamId: string }, ConnectStatusResult>(functions, 'getConnectStatus')
      return (await fn({ teamId: teamId! })).data
    },
  })
}

export function useStartConnectOnboarding() {
  const onError = usePaymentMutationErrorToast()
  return useMutation({
    mutationFn: async (vars: {
      teamId: string
      model: ConnectOnboardingModel
      locale?: string
    }) => {
      const fn = httpsCallable<
        { teamId: string; model: string; locale?: string; origin?: string },
        { accountId: string; model: ConnectOnboardingModel; url: string }
      >(functions, 'startConnectOnboarding')
      return (await fn({ ...vars, origin: clientOrigin() })).data
    },
    onError,
  })
}

export function useCreateMembershipPayment() {
  const onError = usePaymentMutationErrorToast()
  return useMutation({
    mutationFn: async (vars: {
      teamId: string
      subscriptionTypeId: string
      priceId: string
      contactId?: string
      customerEmail?: string
      locale?: string
    }) => {
      const fn = httpsCallable<
        typeof vars & { origin?: string },
        { url: string; sessionId: string; recurring: boolean }
      >(functions, 'createMembershipPayment')
      return (await fn({ ...vars, origin: clientOrigin() })).data
    },
    onError,
  })
}

/** True when the team has any BYO payment gateway (Payrexx / Stripe-BYO)
 * configured — used to surface the Payments nav even without Stripe Connect. */
export function useHasByoGateway(teamId: string | null) {
  return useQuery({
    queryKey: ['has-byo-gateway', teamId],
    enabled: !!teamId,
    queryFn: async (): Promise<boolean> => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, 'integrations'),
          where('type', '==', 'payment_gateway'),
          limit(1)
        )
      )
      return !snap.empty
    },
  })
}

export function useMemberPayments(teamId: string | null, pageLimit = 50) {
  return useQuery({
    queryKey: ['member-payments', teamId, pageLimit],
    enabled: !!teamId,
    queryFn: async (): Promise<MemberPayment[]> => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, MEMBER_PAYMENTS_SUBCOLLECTION),
          orderBy('created_at', 'desc'),
          limit(pageLimit)
        )
      )
      return snap.docs.map((d) => d.data() as MemberPayment)
    },
  })
}

export function useMemberSubscriptions(teamId: string | null) {
  return useQuery({
    queryKey: ['member-subscriptions', teamId],
    enabled: !!teamId,
    queryFn: async (): Promise<MemberSubscription[]> => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, MEMBER_SUBSCRIPTIONS_SUBCOLLECTION),
          orderBy('created_at', 'desc'),
          limit(50)
        )
      )
      return snap.docs.map((d) => d.data() as MemberSubscription)
    },
  })
}

export function useRefundMemberPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      teamId: string
      paymentIntentId: string
      amount?: number
      reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
    }) => {
      const fn = httpsCallable<
        typeof vars,
        {
          refundId: string
          status: string | null
          /** What happened to the ACCESS the payment bought. `state: 'failed'`
           *  means the money went back and the entitlement did not — the caller
           *  must surface it, because nothing else will. */
          reversal: MemberPaymentEffectsReversal | null
        }
      >(functions, 'refundMemberPayment')
      return (await fn(vars)).data
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['member-payments', vars.teamId] }),
  })
}

/** BYO ledger (Payrexx / Stripe-BYO) for the team — function-written, rules allow
 * manager/owner reads. Includes unassigned payments (no contact matched). */
export function usePaymentEvents(teamId: string | null, pageLimit = 100) {
  return useQuery({
    queryKey: ['payment-events', teamId, pageLimit],
    enabled: !!teamId,
    queryFn: async (): Promise<Array<ExternalPayment & { id: string }>> => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, PAYMENT_EVENTS_SUBCOLLECTION),
          orderBy('processed_at', 'desc'),
          limit(pageLimit)
        )
      )
      return snap.docs.map((d) => ({ ...(d.data() as ExternalPayment), id: d.id }))
    },
  })
}

/** A single contact's payments across both rails (Connect member_payments +
 * BYO payment_events). Filtered by id only (no orderBy → no composite index);
 * the caller sorts client-side. */
export function useContactPayments(teamId: string | null, contactId: string | null) {
  return useQuery({
    queryKey: ['contact-payments', teamId, contactId],
    enabled: !!teamId && !!contactId,
    queryFn: async (): Promise<{
      payments: MemberPayment[]
      events: Array<ExternalPayment & { id: string }>
    }> => {
      const [connectSnap, byoSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, TEAMS_COLLECTION, teamId!, MEMBER_PAYMENTS_SUBCOLLECTION),
            where('contactId', '==', contactId!)
          )
        ),
        getDocs(
          query(
            collection(db, TEAMS_COLLECTION, teamId!, PAYMENT_EVENTS_SUBCOLLECTION),
            where('contact_id', '==', contactId!)
          )
        ),
      ])
      return {
        payments: connectSnap.docs.map((d) => d.data() as MemberPayment),
        events: byoSnap.docs.map((d) => ({ ...(d.data() as ExternalPayment), id: d.id })),
      }
    },
  })
}

/** Reasons `updatePaymentRecord` refuses that the CALLER is expected to render —
 *  a rule the manager can act on, not a failure. The generic money-error toast
 *  would bury each of them under "Something went wrong". */
const REASSIGN_REFUSALS: Record<string, 'reassignConsumedPack' | 'reassignVoided' | 'reassignFailed'> =
  {
    consumed_pack_reassign: 'reassignConsumedPack',
    payment_voided: 'reassignVoided',
    reassign_reversal_failed: 'reassignFailed',
    reassign_apply_failed: 'reassignFailed',
  }

/** (Re)assign the contact, edit the comment, and/or set the line-item on a
 * Connect or BYO payment. */
export function useUpdatePaymentRecord() {
  const qc = useQueryClient()
  const t = useTranslations('PaymentsDashboard')
  const onPaymentError = usePaymentMutationErrorToast()
  return useMutation({
    mutationFn: async (vars: {
      teamId: string
      source: 'connect' | 'byo'
      paymentId: string
      contactId?: string | null
      comment?: string | null
      lineItem?: PaymentLineItem | null
    }) => {
      const fn = httpsCallable<typeof vars, { ok: boolean; contactId: string | null }>(
        functions,
        'updatePaymentRecord'
      )
      return (await fn(vars)).data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['member-payments', vars.teamId] })
      qc.invalidateQueries({ queryKey: ['payment-events', vars.teamId] })
      qc.invalidateQueries({ queryKey: ['contact-payments'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
    onError: (err: unknown) => {
      const details = (err as { details?: { reason?: string; unitsConsumed?: number } }).details
      const key = details?.reason ? REASSIGN_REFUSALS[details.reason] : undefined
      if (key) {
        toast.error(t(key, { used: details?.unitsConsumed ?? 0 }))
        return
      }
      onPaymentError(err)
    },
  })
}

/** Void a manual payment record ("this was recorded by mistake"). Takes back
 *  what the record gave; moves no money. Manual rows only — enforced server-side
 *  because the gateway rails' rows describe money we do not control. */
export function useVoidManualPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { teamId: string; paymentId: string; reason?: string | null }) => {
      const fn = httpsCallable<
        typeof vars,
        {
          ok: boolean
          /** What was taken back, or null when the row was unassigned. */
          reversal: {
            subscription: string
            credits: string
            creditsRevoked: number
            course: string
          } | null
        }
      >(functions, 'voidManualPayment')
      return (await fn(vars)).data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['payment-events', vars.teamId] })
      qc.invalidateQueries({ queryKey: ['contact-payments'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['dashboard-monthly-revenue', vars.teamId] })
    },
  })
}

/** Current-month partner (aggregator) visit payout ledger — reporting only
 * (teams/{teamId}/partner_visits). Filtered by created_at only (no composite
 * index); status is filtered client-side. */
export function usePartnerVisits(teamId: string | null) {
  return useQuery({
    queryKey: ['partner-visits', teamId],
    enabled: !!teamId,
    queryFn: async (): Promise<PartnerVisit[]> => {
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, PARTNER_VISITS_SUBCOLLECTION),
          where('created_at', '>=', startOfMonth),
          orderBy('created_at', 'desc'),
          limit(200)
        )
      )
      return snap.docs.map((d) => d.data() as PartnerVisit)
    },
  })
}

/** Record a manual cash / bank-transfer payment into the unified ledger. */
export function useRecordManualPayment() {
  const qc = useQueryClient()
  const onError = usePaymentMutationErrorToast()
  return useMutation({
    mutationFn: async (vars: {
      teamId: string
      contactId?: string | null
      amount: number
      currency?: string
      occurredAt?: number
      paymentMode?: string
      lineItem?: PaymentLineItem | null
      comment?: string | null
    }) => {
      const fn = httpsCallable<typeof vars, { id: string; duplicate?: boolean }>(
        functions,
        'recordManualPayment'
      )
      return (await fn(vars)).data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['payment-events', vars.teamId] })
      qc.invalidateQueries({ queryKey: ['contact-payments'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
    onError,
  })
}
