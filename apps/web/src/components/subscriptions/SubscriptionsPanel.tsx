'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  SubscriptionTypesManager,
  type SubscriptionTypesManagerHandle,
} from '@/components/subscriptions/SubscriptionTypesManager'

// Currency configured on any enabled payment gateway — used to pre-fill the
// billing currency when the team hasn't set one yet.
function useGatewayCurrency(teamId: string | null) {
  return useQuery<string | null>({
    queryKey: ['gateway-currency', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId, 'integrations'))
      for (const d of snap.docs) {
        const data = d.data() as { type?: string; enabled?: boolean; config?: { currency?: string } }
        if (data.type === 'payment_gateway' && data.enabled && data.config?.currency) {
          return data.config.currency
        }
      }
      return null
    },
  })
}

function BillingCurrency({
  teamId,
  current,
  gatewayCurrency,
  canEdit,
}: {
  teamId: string
  current: string | undefined
  gatewayCurrency: string | null | undefined
  canEdit: boolean
}) {
  const t = useTranslations('TeamSettings')
  const resolved = (current ?? gatewayCurrency ?? 'CHF').toUpperCase()
  const [value, setValue] = useState(resolved)
  const [saving, setSaving] = useState(false)

  // Keep the input in sync once the team doc / gateway currency loads.
  useEffect(() => {
    setValue(resolved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, gatewayCurrency])

  const dirty = value.toUpperCase() !== resolved

  async function save() {
    setSaving(true)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId), {
        default_currency: value.toUpperCase(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-end gap-3 rounded-lg border p-4">
      <div className="space-y-1.5">
        <Label>{t('billingCurrency')}</Label>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={3}
          disabled={!canEdit}
          className="uppercase w-24"
          placeholder="CHF"
        />
        <p className="text-xs text-muted-foreground">{t('billingCurrencyDesc')}</p>
      </div>
      {canEdit && dirty && (
        <Button size="sm" onClick={save} disabled={saving || value.trim().length < 3}>
          {saving ? t('saving') : t('save')}
        </Button>
      )}
    </div>
  )
}

/** The Subscriptions surface — billing currency + subscription-type manager.
 *  Rendered as the "Subscriptions" tab of the Memberships page. */
export function SubscriptionsPanel() {
  const { currentTeamId, team, teamRole } = useAuth()
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
    <div className="space-y-6">
      <PageHeader
        title={t('tabSubscriptionTypes')}
        subtitle={t('subscriptionsSubtitle')}
        action={
          <Button onClick={() => managerRef.current?.openAdd()}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t('addSubscriptionType')}
          </Button>
        }
      />
      <BillingCurrency
        teamId={currentTeamId}
        current={team?.default_currency}
        gatewayCurrency={gatewayCurrency}
        canEdit={teamRole === 'owner'}
      />
      <SubscriptionTypesManager ref={managerRef} teamId={currentTeamId} currency={currency} />
    </div>
  )
}
