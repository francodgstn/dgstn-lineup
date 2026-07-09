import KioskApp from './KioskApp'

// Fixed, fullscreen, low-chrome surface for a studio's entrance tablet. Team
// resolution + the passwordless contact-auth context are already provided by the
// parent `/public/{slug}` layout (PublicTeamProvider + PublicContactAuthProvider);
// KioskApp reuses that context rather than re-querying. The floating contact
// sign-in pill (PublicContactBar) opts out on this route (see PublicContactBar.tsx)
// so the kiosk stays fully full-bleed, matching the /site pattern.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function KioskPage({ params }: Props) {
  const { slug } = await params
  return <KioskApp slug={slug} />
}
