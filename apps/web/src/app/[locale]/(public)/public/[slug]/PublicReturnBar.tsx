'use client'

import { useEffect, useState } from 'react'
import { parsePublicFrom, type PublicFrom } from '@linyup/shared'
import { usePathname } from '@/i18n/navigation'
import { returnHref } from '@/lib/publicRoutes'
import { usePublicTeam } from './PublicTeamProvider'
import { PublicBackBar } from './PublicBackBar'

// ─── PublicReturnBar ──────────────────────────────────────────────────────────
//
// Shop, documents and space are full destinations rather than short tasks, so
// they stay real pages (deep-linkable, shareable, crawlable) instead of moving
// into the booking overlay. What they were missing is the way OUT: the website
// already links to them with `?from=site`, and all three ignored it — so a
// visitor who left the studio's website for the shop had no route back.
//
// Rendered once in the tenant layout rather than wired into each surface: these
// three have no shared shell between them, and per-page wiring is exactly how
// the next new surface ends up missing it again.

/** Surfaces that draw their own back affordance (BioLinkShell) or must stay bare. */
const SURFACES_WITH_OWN_CHROME = [
  'booking', // BioLinkShell/FlowShell header
  'appointments',
  'signup',
  'contact-update',
  'site', // the website has its own header + surface links
  'kiosk', // fixed entrance tablet — no navigation at all
]

export function PublicReturnBar() {
  const pathname = usePathname()
  const { slug, team } = usePublicTeam()
  const [from, setFrom] = useState<PublicFrom | undefined>(undefined)

  // Read from window rather than useSearchParams(): these routes deliberately
  // avoid a client Suspense boundary (see appointments/page.tsx). Re-read on
  // popstate so a Back into a different `?from=` relabels the bar.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = () =>
      setFrom(parsePublicFrom(new URLSearchParams(window.location.search).get('from')))
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [pathname])

  // Precise segment match, so a slug like "spacegym" isn't mistaken for /space.
  const onSurface = (s: string) => pathname.endsWith(`/${s}`) || pathname.includes(`/${s}/`)
  if (SURFACES_WITH_OWN_CHROME.some(onSurface)) return null
  // The tenant root IS the bio-link — there is nothing above it to go back to.
  if (pathname === `/public/${slug}`) return null

  // No `from` → the team's default surface, the same fallback every other flow
  // uses. One rule to reason about, and it never dead-ends.
  const backTo = returnHref(team, slug, from)
  return <PublicBackBar href={backTo.href} label={team.name || slug} />
}
