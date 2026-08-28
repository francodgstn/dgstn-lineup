'use client'

/**
 * "Open the page a visitor sees" — one affordance, one component.
 *
 * This shape was copy-pasted inline in eight places before it was a component
 * (the shop and space hubs, the public-pages hub, products, online courses, the
 * bio-link editor, kiosk and website), each with its own idea of whether to show
 * the URL, whether to strip the scheme, and which icon to use. Nothing was
 * wrong with any one of them; there were just eight.
 *
 * IT RENDERS NOTHING WITHOUT A SLUG. `publicUrl` returns null before the team
 * has loaded and for a team with no slug, and a dead "open" link is worse than
 * no link — it promises a page that does not exist.
 *
 * ALWAYS A NEW TAB. The destination is the public site: a studio opening it is
 * checking their work, not leaving the admin app, and sending them out of it
 * loses whatever they were in the middle of.
 */

import { ExternalLink } from 'lucide-react'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'

export function PublicSurfaceLink({
  subPath,
  label,
  showUrl = false,
  className,
}: {
  /** Path under `/public/{slug}` — e.g. `'booking'`. Empty for the bio-link root. */
  subPath?: string
  /** What the link says when it is not showing the URL itself. */
  label: string
  /** Show the bare URL instead of the label — for a header whose whole job is to
   *  tell the studio what address to hand out. */
  showUrl?: boolean
  className?: string
}) {
  const { publicUrl } = usePublicSurfaces()
  const url = publicUrl(subPath ?? '')
  if (!url) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className={`inline-flex items-center gap-1 text-sm text-primary hover:underline ${className ?? ''}`}
    >
      {showUrl ? url.replace(/^https?:\/\//, '') : label}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  )
}
