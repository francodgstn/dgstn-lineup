import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { PlansTabs } from './PlansTabs'

// Subscription plans.
//
// `?tab=affiliations` IS STILL HONOURED, as a redirect. This was a two-tab hub;
// affiliations moved to their own destination, and that query string is in
// bookmarks and in the /offer/affiliations stub. Sending it on beats rendering
// subscriptions and quietly ignoring what the URL asked for.
export const dynamic = 'force-dynamic'

export default async function PlansPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  if (tab === 'affiliations') {
    // Locale-aware, like the other stubs: a bare path drops a non-English
    // visitor into the English app under `localePrefix: 'as-needed'`.
    const { locale } = await params
    redirect((locale === 'en' ? '/affiliations' : `/${locale}/affiliations`) as Route)
  }
  return <PlansTabs />
}
