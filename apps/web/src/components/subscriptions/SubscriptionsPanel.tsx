'use client'

import { forwardRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/skeleton'
import { useGatewayCurrency } from '@/components/connect/BillingCurrencyCard'
import {
  SubscriptionTypesManager,
  type SubscriptionTypesManagerHandle,
} from '@/components/subscriptions/SubscriptionTypesManager'

/** The Subscriptions surface — the subscription-type manager, plus the currency
 *  it prices in (set in Settings → Payments, linked from the page header).
 *
 *  The "Add" button is NOT here. It lives in the page header beside the title,
 *  where every other list page keeps its primary action; this panel forwards the
 *  manager handle up so the header can open the dialog. It used to sit in a row
 *  of its own above the list, which read as a second, weaker header. */
export const SubscriptionsPanel = forwardRef<SubscriptionTypesManagerHandle>(
  function SubscriptionsPanel(_props, ref) {
    const { currentTeamId, team } = useAuth()
    const { data: gatewayCurrency } = useGatewayCurrency(currentTeamId)

    if (currentTeamId === null) {
      return (
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      )
    }

    const currency = (team?.default_currency ?? gatewayCurrency ?? 'CHF').toUpperCase()

    return <SubscriptionTypesManager ref={ref} teamId={currentTeamId} currency={currency} />
  }
)
