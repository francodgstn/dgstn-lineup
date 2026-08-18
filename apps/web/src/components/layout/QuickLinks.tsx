'use client'

/**
 * Quick links — one dot-separated line under a page's main heading, pointing at
 * the ONE other page that confirms or completes what this page just did (UX-71).
 *
 * The gap it fills: a studio finishes a piece of setup and gets no answer to
 * "did that work?". The subscription it just priced is confirmed on the Pricing
 * page; the bookable hours it just published are only bookable if an appointment
 * activity exists. Both destinations are in the sidebar — but the sidebar is an
 * accordion (one section open at a time) and, more importantly, a menu can only
 * say WHERE something is, never WHY you'd want it right now. The prompt copy is
 * the feature; the link is the cheap part.
 *
 * Rules of use, deliberately restrictive:
 *  - NOT on every page. Only where the destination genuinely verifies or
 *    completes the work just done. A line of links on every heading is chrome,
 *    and chrome stops being read.
 *  - Two or three links, never more.
 *  - Hidden below `sm`: on a phone this line would push the page's actual
 *    content below the fold to offer navigation the hamburger already gives.
 *  - Point at the CANONICAL route. `/offer/subscriptions` and
 *    `/offer/affiliations` are redirect stubs — link `/offer/plans?tab=…`, which
 *    `useTabParam`/the plans hub reads directly.
 */

import type { Route } from 'next'
import { Link } from '@/i18n/navigation'

export type QuickLink = {
  href: Route
  /** The prompt: why you'd open this now, not the destination's name. */
  label: string
}

export function QuickLinks({ links }: { links: QuickLink[] }) {
  if (links.length === 0) return null
  return (
    <p className="mt-1.5 hidden flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground sm:flex">
      {links.map((link, i) => (
        <span key={link.href} className="inline-flex items-center gap-x-2">
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
          )}
          <Link
            href={link.href}
            className="underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/50"
          >
            {link.label}
          </Link>
        </span>
      ))}
    </p>
  )
}
