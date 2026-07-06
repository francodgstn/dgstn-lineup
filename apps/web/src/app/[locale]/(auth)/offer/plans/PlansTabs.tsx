'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/layout/PageHeader'
import { SubscriptionsPanel } from '@/components/subscriptions/SubscriptionsPanel'
import { AffiliationsPage } from '@/components/affiliations/AffiliationTypesManager'

type Tab = 'subscriptions' | 'affiliations'

/** "Plans & affiliations" is a nav grouping (umbrella), NOT an entity: it just houses the
 *  Subscriptions and Affiliations surfaces as tabs. Each tab renders its existing,
 *  self-contained surface (the Affiliations one self-gates to Studio+ with an
 *  upsell), so there's no data or gating logic here. */
export function PlansTabs({ initialTab }: { initialTab: Tab }) {
  const t = useTranslations('Nav')
  const [tab, setTab] = useState<Tab>(initialTab)

  return (
    <div className="space-y-6">
      <PageHeader title={t('plans')} />
      {/* Prominent segmented switcher (each panel supplies its own body, no repeated header) */}
      <div className="inline-flex gap-0.5 rounded-lg border bg-background p-0.5">
        {(['subscriptions', 'affiliations'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {tab === 'subscriptions' ? <SubscriptionsPanel /> : <AffiliationsPage />}
    </div>
  )
}
