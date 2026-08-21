'use client'

import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { Waypoints } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
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
  const tCat = useTranslations('OfferCatalogue')

  // Quick link (UX-71): a plan's price is set here and proved on Pricing, which
  // replays it through the real resolver for each persona. The catalogue is NOT
  // in this line — it is a button, because "what does this plan actually open"
  // is asked far too often to be muted text.
  const quickLinks = [
    { href: '/offer/pricing' as Route, label: tq('plansToPricing') },
    // Was a stray `text-xs` link floating beside the Add button — the one
    // destination every selling page needs, styled unlike every other
    // cross-page pointer in the app.
    { href: '/settings/team?tab=payments' as Route, label: tq('toPaymentSettings') },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('subscriptions')}
        purpose="subscriptions"
        quickLinks={quickLinks}
        action={
          <Link
            href={'/offer/catalogue' as Route}
            className={buttonVariants({ variant: 'outline' })}
          >
            <Waypoints className="h-4 w-4 mr-1.5" />
            {tCat('title')}
          </Link>
        }
      />
      <SubscriptionsPanel />
    </div>
  )
}
