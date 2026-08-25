'use client'

/**
 * Related links — one line under a page's main heading, naming the other pages
 * that confirm or complete what this page just did (UX-71).
 *
 * IT USED TO BE A PROMPT, and the prompt was the feature: "Check what a member
 * actually pays" says WHY you would open Pricing right now, which a menu never
 * can. It was changed to the destination's NAME on 2026-08-25 because the
 * sentences were long enough to wrap under the title and crowd it — and a line
 * that crowds the heading is a line people stop reading, which costs more than
 * the "why" was buying. The trade is real and is written down here so it can be
 * reversed knowingly rather than rediscovered.
 *
 * The names come from the `Nav` namespace, NOT from copy of their own: a page's
 * name lives in one place, so this line and the sidebar cannot disagree about
 * what a destination is called.
 *
 * Rules of use, deliberately restrictive:
 *  - NOT on every page. Only where the destination genuinely verifies or
 *    completes the work just done. A line of links on every heading is chrome,
 *    and chrome stops being read.
 *  - Up to FOUR. Names are short, so four fit where three sentences did not.
 *  - Hidden below `sm`: on a phone this line would push the page's actual
 *    content below the fold to offer navigation the hamburger already gives.
 *  - Point at the CANONICAL route. `/offer/subscriptions` and
 *    `/offer/affiliations` are redirect stubs — link `/offer/plans?tab=…`, which
 *    `useTabParam`/the plans hub reads directly.
 */

import type { Route } from 'next'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export type QuickLink = {
  href: Route
  /** The destination's NAME, from the `Nav` namespace — not a sentence. */
  label: string
}

export function QuickLinks({ links }: { links: QuickLink[] }) {
  const t = useTranslations('QuickLinks')
  if (links.length === 0) return null
  // Four is the cap the rules above state. Silently dropping the fifth would
  // hide a call site's mistake; the cap is enforced where it is declared.
  const shown = links.slice(0, 4)
  return (
    <p className="mt-1.5 hidden flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-muted-foreground sm:flex">
      <span className="text-muted-foreground/70">{t('related')}</span>
      {shown.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/50"
        >
          {link.label}
        </Link>
      ))}
    </p>
  )
}
