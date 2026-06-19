'use client'

// Client hooks for the Stripe Connect feature (member → studio payments).
// All writes go through Cloud Functions; reads of the payment list come straight
// from Firestore (function-written, rules allow manager/owner reads).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db, functions } from '@/lib/firebase'
import {
  MEMBER_PAYMENTS_SUBCOLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type ConnectAccountStatus,
  type ConnectOnboardingModel,
  type MemberPayment,
  type MemberSubscription,
} from '@linyup/shared'

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
  return useMutation({
    mutationFn: async (vars: {
      teamId: string
      model: ConnectOnboardingModel
      locale?: string
    }) => {
      const fn = httpsCallable<
        { teamId: string; model: string; locale?: string },
        { accountId: string; model: ConnectOnboardingModel; url: string }
      >(functions, 'startConnectOnboarding')
      return (await fn(vars)).data
    },
  })
}

export function useCreateMembershipPayment() {
  return useMutation({
    mutationFn: async (vars: {
      teamId: string
      subscriptionTypeId: string
      priceId: string
      contactId?: string
      customerEmail?: string
      locale?: string
    }) => {
      const fn = httpsCallable<typeof vars, { url: string; sessionId: string; recurring: boolean }>(
        functions,
        'createMembershipPayment'
      )
      return (await fn(vars)).data
    },
  })
}

export function useMemberPayments(teamId: string | null) {
  return useQuery({
    queryKey: ['member-payments', teamId],
    enabled: !!teamId,
    queryFn: async (): Promise<MemberPayment[]> => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, MEMBER_PAYMENTS_SUBCOLLECTION),
          orderBy('created_at', 'desc'),
          limit(50)
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
      const fn = httpsCallable<typeof vars, { refundId: string; status: string | null }>(
        functions,
        'refundMemberPayment'
      )
      return (await fn(vars)).data
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['member-payments', vars.teamId] }),
  })
}
