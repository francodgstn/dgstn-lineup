'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
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
  const tq = useTranslations('QuickLinks')
  const [tab, setTab] = useState<Tab>(initialTab)

  // Quick links (UX-71) — SUBSCRIPTIONS TAB ONLY. A plan's price is set here and
  // proved somewhere else: Pricing replays it through the real resolver for each
  // persona, and Activities is where the plan is attached to what it unlocks.
  // Neither statement is true of an affiliation (no price, no activity grant), so
  // the line is not shown on that tab rather than being quietly wrong there.
  const quickLinks =
    tab === 'subscriptions'
      ? [
          { href: '/offer/pricing' as Route, label: tq('plansToPricing') },
          { href: '/offer/activities' as Route, label: tq('plansToActivities') },
        ]
      : undefined

  return (
    <div className="space-y-6">
      <PageHeader title={t('plans')} quickLinks={quickLinks} />
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
