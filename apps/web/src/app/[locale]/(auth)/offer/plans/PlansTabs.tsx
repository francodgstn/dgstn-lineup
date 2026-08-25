'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { Waypoints } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { SubscriptionsPanel } from '@/components/subscriptions/SubscriptionsPanel'
import type { SubscriptionTypesManagerHandle } from '@/components/subscriptions/SubscriptionTypesManager'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

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
  const tNav = useTranslations('Nav')
  const tCat = useTranslations('OfferCatalogue')
  const tSettings = useTranslations('TeamSettings')
  // The panel owns the dialog; the header owns the button that opens it, so the
  // primary action sits where it does on every other list page.
  const managerRef = useRef<SubscriptionTypesManagerHandle>(null)

  // Quick link (UX-71): a plan's price is set here and proved on Pricing, which
  // replays it through the real resolver for each persona. The catalogue is NOT
  // in this line — it is a button, because "what does this plan actually open"
  // is asked far too often to be muted text.
  // Names, not prompts, and they come from `Nav` so this line and the sidebar
  // cannot disagree about what a page is called. Activities was added here on
  // 2026-08-25: a plan is what unlocks an activity, so it is the destination a
  // studio reaches for next and it had no pointer.
  const quickLinks = [
    { href: '/offer/activities' as Route, label: tNav('activities') },
    { href: '/offer/pricing' as Route, label: tNav('pricing') },
    { href: '/settings/team?tab=payments' as Route, label: tNav('teamPayments') },
  ]

  return (
    <div className="space-y-6">
      {/* `subscriptionPlans` is the SAME key the nav row uses, so the page and
          the way into it cannot end up called different things. */}
      <PageHeader
        title={t('subscriptionPlans')}
        quickLinks={quickLinks}
        action={
          <>
            <Link
              href={'/offer/catalogue' as Route}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Waypoints className="h-4 w-4 mr-1.5" />
              {tCat('title')}
            </Link>
            <Button onClick={() => managerRef.current?.openAdd()}>
              <Plus className="h-4 w-4 mr-1.5" />
              {tSettings('addSubscriptionType')}
            </Button>
          </>
        }
      />
      <SubscriptionsPanel ref={managerRef} />
    </div>
  )
}
