'use client'

// Month-to-date takings for the dashboard's finance section, across both payment
// rails (Connect member_payments + BYO/manual payment_events).
//
// Why not reuse useMemberPayments/usePaymentEvents: those page the newest N rows,
// which is right for a list but silently understates a *total* once a studio takes
// more than a page of payments in a month. This queries the date window instead —
// a single-field range on the same field it orders by, so no composite index.
//
// Deliberately plugin-free: it reads the payment collections directly and never
// touches accounting_*, so it works whether or not the finance plugin is on.

import { useQuery } from '@tanstack/react-query'
import { Timestamp, collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  MEMBER_PAYMENTS_SUBCOLLECTION,
  PAYMENT_EVENTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type ExternalPayment,
  type MemberPayment,
} from '@linyup/shared'

/** Safety cap. Far above a realistic two-month payment count for one studio; if a
 * tenant ever exceeds it the total is a floor, not a lie by a rounding error. */
const WINDOW_CAP = 2000

export interface MonthlyRevenue {
  /** Minor units (Rappen/cents), net of refunds. */
  thisMonth: number
  lastMonth: number
  currency: string
  /** Percent change vs last month; null when last month was zero (no baseline). */
  deltaPercent: number | null
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** Settled money only. Pending may never land and failed never did; refunds come
 * off the top via amount_refunded (a fully refunded charge nets to zero). */
function connectNet(p: MemberPayment): number {
  if (p.status !== 'succeeded' && p.status !== 'partially_refunded') return 0
  return Math.max(0, (p.amount ?? 0) - (p.amount_refunded ?? 0))
}

export function useMonthlyRevenue(teamId: string | null) {
  return useQuery({
    queryKey: ['dashboard-monthly-revenue', teamId],
    enabled: !!teamId,
    queryFn: async (): Promise<MonthlyRevenue> => {
      const now = new Date()
      const thisStart = startOfMonth(now)
      const lastStart = new Date(thisStart.getFullYear(), thisStart.getMonth() - 1, 1)
      const since = Timestamp.fromDate(lastStart)

      const [connectSnap, byoSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, TEAMS_COLLECTION, teamId!, MEMBER_PAYMENTS_SUBCOLLECTION),
            where('created_at', '>=', since),
            orderBy('created_at', 'desc'),
            limit(WINDOW_CAP)
          )
        ),
        getDocs(
          query(
            collection(db, TEAMS_COLLECTION, teamId!, PAYMENT_EVENTS_SUBCOLLECTION),
            where('processed_at', '>=', since),
            orderBy('processed_at', 'desc'),
            limit(WINDOW_CAP)
          )
        ),
      ])

      let thisMonth = 0
      let lastMonth = 0
      let currency = ''

      const add = (amount: number, at: Date | undefined, cur: string | undefined) => {
        if (!amount || !at) return
        if (at >= thisStart) thisMonth += amount
        else lastMonth += amount
        if (!currency && cur) currency = cur
      }

      for (const d of connectSnap.docs) {
        const p = d.data() as MemberPayment
        add(connectNet(p), p.created_at?.toDate?.(), p.currency)
      }
      for (const d of byoSnap.docs) {
        // BYO rows are record-only: they exist because money arrived, and a
        // refund of one happens in the studio's own gateway and never reaches
        // us — so `amount` is the whole story, with ONE exception. A manual row
        // a manager VOIDED says the money never arrived at all (the record was
        // wrong, not reversed), so it is not takings and must not be counted.
        const e = d.data() as ExternalPayment
        if (e.voided_at) continue
        add(e.amount ?? 0, e.processed_at?.toDate?.(), e.currency)
      }

      const deltaPercent =
        lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null

      return { thisMonth, lastMonth, currency: currency || 'CHF', deltaPercent }
    },
  })
}
