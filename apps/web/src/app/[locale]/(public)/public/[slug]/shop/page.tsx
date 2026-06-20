import ShopHome from './ShopHome'

export const dynamic = 'force-dynamic'

// Public self-checkout. Team is resolved by the parent PublicTeamProvider (layout);
// ShopHome reads it from context. `?type=` pre-focuses a subscription card;
// `?tab=products|memberships` opens a specific section.
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; tab?: string }>
}) {
  const { type, tab } = await searchParams
  const initialTab = tab === 'products' || tab === 'memberships' ? tab : null
  return <ShopHome focusTypeId={type ?? null} initialTab={initialTab} />
}
