import { redirect } from 'next/navigation'
import type { Route } from 'next'

// Subscriptions now lives as a tab of the Plans & affiliations hub.
export default function SubscriptionsRedirect() {
  redirect('/offer/plans?tab=subscriptions' as Route)
}
