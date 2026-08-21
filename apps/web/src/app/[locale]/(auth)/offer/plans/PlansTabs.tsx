'use client'

import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { PageHeader } from '@/components/layout/PageHeader'
import { SubscriptionsPanel } from '@/components/subscriptions/SubscriptionsPanel'

/** Subscription plans.
 *
 *  THIS WAS AN UMBRELLA and is no longer one. It housed Subscriptions and
 *  Affiliations as two tabs, which put the affiliation TYPES here while the
 *  affiliation ROSTER — the surface a studio actually opens weekly — had no nav
 *  item at all. The roster is now its own destination and carries the types with
 *  it, so this page is left with one subject and no switcher.
 *
 *  `?tab=affiliations` still arrives here from bookmarks and from the legacy
 *  /offer/affiliations stub; the page component redirects those on. */
export function PlansTabs() {
  const t = useTranslations('Nav')
  const tq = useTranslations('QuickLinks')
  const tp = useTranslations('PagePurpose')

  // Quick links (UX-71). A plan's price is set here and proved somewhere else:
  // the Catalogue is where it is attached to what it unlocks (replacing the
  // picker that used to sit inside this page's dialog), and Pricing replays the
  // result through the real resolver for each persona.
  const quickLinks = [
    { href: '/offer/catalogue' as Route, label: tq('plansToCatalogue') },
    { href: '/offer/pricing' as Route, label: tq('plansToPricing') },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title={t('subscriptions')} purpose={tp('subscriptions')} quickLinks={quickLinks} />
      <SubscriptionsPanel />
    </div>
  )
}
