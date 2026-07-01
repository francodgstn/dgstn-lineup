import ShopHome from './ShopHome'

export const dynamic = 'force-dynamic'

// Public self-checkout. Team is resolved by the parent PublicTeamProvider (layout);
// ShopHome reads it from context. `?type=` pre-focuses a subscription card;
// `?tab=products|memberships|courses` opens a specific section; `?course=` deep-links
// a course's checkout (used by the Space "Buy" CTA).
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; tab?: string; course?: string }>
}) {
  const { type, tab, course } = await searchParams
  const initialTab =
    tab === 'products' || tab === 'subscriptions' || tab === 'courses' ? tab : null
  return <ShopHome focusTypeId={type ?? null} focusCourseId={course ?? null} initialTab={initialTab} />
}
