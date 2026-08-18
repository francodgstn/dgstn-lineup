import { parseDocId } from '@linyup/shared'
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
  // Attacker-supplied: both ids are matched against loaded data and one reaches a
  // checkout callable, so shape them before they leave this boundary.
  return (
    <ShopHome
      focusTypeId={parseDocId(type) ?? null}
      focusCourseId={parseDocId(course) ?? null}
      initialTab={initialTab}
    />
  )
}
