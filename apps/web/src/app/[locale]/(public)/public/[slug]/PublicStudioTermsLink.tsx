'use client'

// A link to the studio's published terms, for a public surface that takes money
// and had no path to them (UX-57).
//
// REUSE, NOT A NEW SURFACE. The studio's terms, policies and waivers already
// have a public home — `/public/{slug}/documents`, rendered from the
// world-readable `documents/{id}/public_profile/{id}` mirrors — and the booking
// rails already state their own cancellation terms at the moment of commitment
// (`components/booking/BookingTerms.tsx`). What was missing was any route from
// the SHOP to either: a prospect could buy a membership, a course or a product
// without ever being offered the terms of the thing they were buying.
//
// A STUDIO THAT HAS PUBLISHED NOTHING SHOWS NOTHING. The gate is
// `TeamPublicProfile.active_public_surfaces.documents`, the same world-readable
// signal the bio-link uses, and it is true only when at least one public
// document MIRROR exists. Rendering "Terms" over an empty index would
// manufacture a formality the studio never made — the same rule BookingTerms
// applies to its own two fields.

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { FileText } from 'lucide-react'
import { usePublicTeam } from './PublicTeamProvider'

interface Props {
  /** Themed to the studio's palette — these surfaces are painted from the
   *  bio-link theme, where app tokens go near-black on a dark background. */
  color: string
  className?: string
  /** Show the icon (footer) or not (a dense line inside a checkout modal). */
  withIcon?: boolean
}

export function PublicStudioTermsLink({ color, className, withIcon = true }: Props) {
  const t = useTranslations('Space')
  const { slug, team } = usePublicTeam()

  if (team?.active_public_surfaces?.documents !== true) return null

  return (
    <Link
      href={`/public/${slug}/documents` as Route}
      className={`inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline ${className ?? ''}`}
      style={{ color }}
    >
      {withIcon && <FileText className="h-3.5 w-3.5" />}
      {t('studioTermsLink')}
    </Link>
  )
}
