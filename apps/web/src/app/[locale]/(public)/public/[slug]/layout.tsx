import { PublicTeamProvider } from './PublicTeamProvider'
import { PublicContactAuthProvider } from './PublicContactAuthProvider'
import { PublicContactBar, PublicContactSignIn } from './PublicContactBar'
import { PublicReturnBar } from './PublicReturnBar'

export const dynamic = 'force-dynamic'

interface Props {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

// Team root for all `/public/{slug}/…` surfaces. Resolves the team once by slug
// (PublicTeamProvider) and layers the passwordless contact-session auth on top
// (PublicContactAuthProvider) so login state persists across every public surface,
// not just Space. PublicContactBar renders the shared sign-in control on the
// surfaces that don't have their own auth chrome.
export default async function PublicTeamLayout({ children, params }: Props) {
  const { slug } = await params
  return (
    <PublicTeamProvider slug={slug}>
      <PublicContactAuthProvider>
        {/* Before children so it sits at the top of the page flow. Renders only
            on the surfaces that have no back affordance of their own. */}
        <PublicReturnBar />
        {children}
        <PublicContactBar />
        {/* The dialog mounts for EVERY surface, including the ones that opt out
            of the pill — the website draws its own sign-in control and opens
            this same instance. */}
        <PublicContactSignIn />
      </PublicContactAuthProvider>
    </PublicTeamProvider>
  )
}
