import ShopHome from './ShopHome'

export const dynamic = 'force-dynamic'

// Public self-checkout. Team is resolved by the parent PublicTeamProvider (layout);
// ShopHome reads it from context. `?type=` pre-focuses a subscription card.
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const { type } = await searchParams
  return <ShopHome focusTypeId={type ?? null} />
}
