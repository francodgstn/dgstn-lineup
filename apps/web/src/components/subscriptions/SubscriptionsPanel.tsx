'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useGatewayCurrency } from '@/components/connect/BillingCurrencyCard'
import {
  SubscriptionTypesManager,
  type SubscriptionTypesManagerHandle,
} from '@/components/subscriptions/SubscriptionTypesManager'

/** The Subscriptions surface — the subscription-type manager. Billing currency now
 *  lives in Settings → Payments (linked here); rendered as the "Subscriptions" tab of
 *  the Plans & affiliations page, which supplies the section header. */
export function SubscriptionsPanel() {
  const { currentTeamId, team } = useAuth()
  const t = useTranslations('TeamSettings')
  const { data: gatewayCurrency } = useGatewayCurrency(currentTeamId)
  const managerRef = useRef<SubscriptionTypesManagerHandle>(null)

  if (currentTeamId === null) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  const currency = (team?.default_currency ?? gatewayCurrency ?? 'CHF').toUpperCase()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        <Button onClick={() => managerRef.current?.openAdd()}>
          <Plus className="h-4 w-4 mr-1.5" />
          {t('addSubscriptionType')}
        </Button>
      </div>
      <SubscriptionTypesManager ref={managerRef} teamId={currentTeamId} currency={currency} />
    </div>
  )
}
