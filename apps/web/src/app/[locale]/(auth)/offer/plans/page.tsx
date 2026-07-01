import { PlansTabs } from './PlansTabs'

// "Plans & affiliations" hub — a single nav item grouping the Subscriptions and
// Affiliations surfaces as tabs. `?tab=affiliations` deep-links the second tab
// (the old /offer/subscriptions and /offer/affiliations routes redirect here).
export const dynamic = 'force-dynamic'

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const initialTab = tab === 'affiliations' ? 'affiliations' : 'subscriptions'
  return <PlansTabs initialTab={initialTab} />
}
