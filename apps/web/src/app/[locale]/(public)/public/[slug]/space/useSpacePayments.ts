'use client'

import { useQuery } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useSpaceAuth } from './SpaceAuthProvider'

// The signed-in contact's own payment history + whether a Stripe billing portal is
// available to them. Backed by the `listMyContactPayments` callable (sanitized —
// no platform-fee fields). Shared by SpacePortalNav (to decide whether to show the
// Payments tab) and PaymentsHome, so it runs once and is cached.

export interface ContactPayment {
  id: string
  kind: string
  label: string
  amount: number // minor units (Rappen)
  currency: string
  status: string
  refundedAmount: number // minor units
  createdAt: number | null // epoch ms
}

export interface SpacePaymentsResult {
  payments: ContactPayment[]
  billingAvailable: boolean
}

const EMPTY: SpacePaymentsResult = { payments: [], billingAvailable: false }

export function useSpacePayments() {
  const { isAuthenticated, contact } = useSpaceAuth()
  return useQuery<SpacePaymentsResult>({
    queryKey: ['space-payments', contact?.id],
    enabled: isAuthenticated && !!contact?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const fn = httpsCallable<Record<string, never>, SpacePaymentsResult>(
        functions,
        'listMyContactPayments'
      )
      const res = await fn({})
      return res.data ?? EMPTY
    },
  })
}
