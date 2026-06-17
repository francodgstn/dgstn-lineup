'use client'

import { useEffect } from 'react'
import type { Route } from 'next'
import { useRouter } from '@/i18n/navigation'
import { usePublicTeam } from './PublicTeamProvider'
import BioLinkHome from './BioLinkHome'

// Team root. Renders the bio-link inline when that's the team's chosen default
// surface (or none is set); otherwise redirects to the chosen sibling surface —
// but only when `active_public_surfaces` says it's live, falling back to the
// bio-link so the root never dead-ends on a deactivated surface.
export default function PublicTeamRootPage() {
  const { slug, team } = usePublicTeam()
  const router = useRouter()

  const choice = team.default_public_surface ?? 'bio-link'
  const live = team.active_public_surfaces
  const redirectTo = choice !== 'bio-link' && live?.[choice] ? choice : null

  useEffect(() => {
    if (redirectTo) {
      router.replace(`/public/${slug}/${redirectTo}` as Route)
    }
  }, [redirectTo, slug, router])

  if (redirectTo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return <BioLinkHome slug={slug} team={team} />
}
