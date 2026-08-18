'use client'

import type { Route } from 'next'
import { Link } from '@/i18n/navigation'

/**
 * The one "← back out of this surface" bar, shared by every public tenant page.
 *
 * Extracted from BioLinkShell so the surfaces that DON'T use that shell (shop,
 * documents, space) get the identical affordance rather than a second style of
 * back link. See PublicReturnBar for who renders it on those.
 */
export function PublicBackBar({ href, label }: { href: Route; label: string }) {
  return (
    <div className="border-b bg-card px-5 py-3">
      {/* next-intl Link, not a raw <a>: an unprefixed href falls back to
          cookie/Accept-Language detection, and public surfaces never persist
          the locale — so an emailed /fr/… link would flip to English here. */}
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        {label}
      </Link>
    </div>
  )
}
