import { PublicTeamProvider } from './PublicTeamProvider'

export const dynamic = 'force-dynamic'

interface Props {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

// Team root for all `/public/{slug}/…` surfaces. Resolves the team once by slug
// and provides it via PublicTeamProvider so the bio-link, booking, signup,
// contact-update, coaching and space surfaces don't each re-query public_profile.
export default async function PublicTeamLayout({ children, params }: Props) {
  const { slug } = await params
  return <PublicTeamProvider slug={slug}>{children}</PublicTeamProvider>
}
