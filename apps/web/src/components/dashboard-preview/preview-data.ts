'use client'

/**
 * DATA FOR THE PREVIEW DASHBOARD — deliberately a COPY, not a refactor.
 *
 * This lane exists to be compared against the incumbent dashboard, not merged
 * into it, so it does not reach into `(auth)/dashboard/page.tsx` for the two
 * queries it needs. They are re-declared here with the SAME query keys, which
 * means TanStack hands whichever route mounts second the first one's cache:
 * copying the code did not copy the network.
 *
 * Everything else this page reads (`useDashboardData`, `useMonthlyRevenue`,
 * `useSetupChecklist`, `useMemberPayments`, `usePaymentEvents`) is an existing
 * shared hook, imported as-is.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query, where, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, SESSIONS_COLLECTION } from '@linyup/shared'
import type { Contact, Session } from '@linyup/shared'
import { useMemberPayments, usePaymentEvents } from '@/hooks/useConnect'
import {
  byoToUnified,
  connectToUnified,
  mergePaymentRows,
  type UnifiedPaymentRow,
} from '@/lib/payments'

/** Midnight today, in the browser's zone. */
export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Midnight on Monday of the current week. */
export function startOfWeek(): Date {
  const d = startOfToday()
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))
  return d
}

/** The team's live contacts. Same key as the incumbent's `useContacts`. */
export function usePreviewContacts(teamId: string | null) {
  return useQuery({
    queryKey: ['contacts', teamId],
    enabled: !!teamId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION),
          where('teamId', '==', teamId),
          where('deleted_at', '==', null)
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
    },
  })
}

/** Sessions of one calendar day. Same key + index as the incumbent's agenda. */
export function usePreviewSessionsForDay(teamId: string | null, day: Date) {
  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return useQuery({
    queryKey: ['sessions', 'day', teamId, dayStart.toISOString()],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, SESSIONS_COLLECTION),
          where('teamId', '==', teamId),
          where('start', '>=', Timestamp.fromDate(dayStart)),
          where('start', '<', Timestamp.fromDate(dayEnd)),
          orderBy('start', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session)
    },
  })
}

/** Money that arrived but has nobody attached to it — a filing task, not a
 *  statistic, which is why this page puts it in the queue rather than in a
 *  figure. Settled rows only: a failed charge is not a task. */
export function useUnassignedPaymentCount(teamId: string | null): {
  count: number
  isLoading: boolean
} {
  const { data: memberPayments = [], isLoading: loadingConnect } = useMemberPayments(teamId)
  const { data: paymentEvents = [], isLoading: loadingByo } = usePaymentEvents(teamId)

  const count = useMemo(() => {
    const rows: UnifiedPaymentRow[] = mergePaymentRows(
      connectToUnified(memberPayments),
      byoToUnified(paymentEvents)
    )
    return rows.filter(
      (r) =>
        !r.assigned &&
        (r.status === 'succeeded' || r.status === 'partially_refunded' || r.status === 'paid')
    ).length
  }, [memberPayments, paymentEvents])

  return { count, isLoading: (loadingConnect || loadingByo) && !!teamId }
}
