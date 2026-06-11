'use client'

import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SubscriptionTypesManager } from '@/components/subscriptions/SubscriptionTypesManager'

export default function SubscriptionsPage() {
  const { currentTeamId } = useAuth()
  const t = useTranslations('TeamSettings')

  if (currentTeamId === null) {
    return (
      <div className="max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('tabSubscriptionTypes')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('subscriptionsSubtitle')}</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <SubscriptionTypesManager teamId={currentTeamId} />
        </CardContent>
      </Card>
    </div>
  )
}
