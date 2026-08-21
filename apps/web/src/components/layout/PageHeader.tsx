'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ArrowLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { QuickLinks, type QuickLink } from './QuickLinks'

// Shared page header for list/config pages (Activities, Event types,
// Subscriptions, …). Keeps the title block + primary action consistent.
//
// Navigation back to a hub is intentionally NOT part of this header: the sidebar
// is the single, consistent way back (e.g. the "All public pages" nav item), so
// detail pages don't sprout their own inconsistent up-links.
//
// `quickLinks` is the one exception, and it is a FORWARD link, not an up-link:
// the page that confirms or completes what was just done here (UX-71). See
// QuickLinks for when it earns its place — it is not for every page.
export function PageHeader({
  title,
  back,
  purpose,
  subtitle,
  quickLinks,
  action,
}: {
  title: string
  /** An arrow to the left of the title. ONLY for a page the sidebar cannot
   *  return you from — see the note on the header row below. */
  back?: { href: Route; label: string }
  /** Which page this is, for the purpose block. See `PagePurpose`. */
  purpose?: PagePurposeKey
  subtitle?: ReactNode
  quickLinks?: QuickLink[]
  action?: ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* Icon only, and the label survives as the accessible name and the
                tooltip — the words beside it were repeating what an arrow next
                to a title already says.

                This is the ONE exception to "no up-links in a header" (see the
                note at the top): the rule assumes the destination has a sidebar
                row to come back from, and a page reached only from other pages
                has none. */}
            {back && (
              <Link
                href={back.href}
                aria-label={back.label}
                title={back.label}
                className="-ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
            )}
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          </div>
          {!purpose && subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-3">{action}</div>}
      </div>
      {/* FIRST below the heading. It says what the page is; the quick links say
          where to go next, and a "next" that is read before the "what" is an
          invitation to leave a page you have not understood yet. */}
      <PagePurpose purpose={purpose} />
      {quickLinks && <QuickLinks links={quickLinks} />}
    </div>
  )
}

/**
 * Pages whose purpose is stated. The union is the enforcement: a new page cannot
 * be given a purpose phrase without a `<key>Note` beside it in the messages,
 * because both are read from the same key below.
 */
export type PagePurposeKey = 'activities' | 'schedule' | 'subscriptions' | 'pricing'

/**
 * The answer to "what is this page for": a phrase, a separator, an explanation,
 * all on ONE line.
 *
 * ── WHY THESE ARE WRITTEN AS A SET ──────────────────────────────────────────
 * "What you do" · "When you offer it" · "What you sell" · "What people actually
 * pay" only work because they are PARALLEL — each names a different
 * question about the same business, and read together they are a sentence about
 * how the product is organised. Read apart they are four unremarkable labels. So
 * they live in one message namespace (`PagePurpose`), where a translator sees
 * all of them at once and can keep the parallelism; split across each page's own
 * namespace they would drift into four unrelated descriptions within a release
 * or two.
 *
 * The first three keep the studio's own voice ("what YOU do") and the last one
 * switches to the customer's ("what PEOPLE pay") — deliberately, because that is
 * exactly what the Pricing page is: the same offer seen from the other side.
 *
 * Subscriptions read "How you get paid" for one revision. It was wrong: beside a
 * Payments settings page, it names the payment METHOD (cash, TWINT, card) rather
 * than the thing being sold.
 *
 * ── WHY THE PHRASE IS NOT ALONE ─────────────────────────────────────────────
 * A four-word phrase orients but does not inform: "What you do" reads as a
 * label rather than an explanation, and a studio meeting it for the first time
 * learns nothing it could act on. The note does the actual explaining: short,
 * concrete, and about THIS collection rather than about the product. The phrase
 * is the hook, the note is the answer, and they share a line so the header stays
 * one beat rather than three.
 *
 * NO DASHES in this copy, in any locale. A phrase followed by an em dash reads
 * as the same sentence continuing, which is exactly the relationship the middot
 * is here to deny: two separate statements, one label and one explanation.
 *
 * The component reads BOTH from the one key it is given, so the pair cannot be
 * mounted half-present — a page passing `purpose="activities"` always renders
 * `activities` and `activitiesNote` together.
 *
 * ── A LIGHT CALLOUT, AND WHAT KEEPS IT LIGHT ────────────────────────────────
 * A tinted panel, no border and no icon. A studio sees this header several times
 * a day for years, so the box has to be quiet enough to stop registering once it
 * has been read, while still reading as an aside rather than as page content.
 * Background only: a border would draw the eye every visit, and an icon would
 * promise a severity this has none of.
 *
 * Two things keep it from growing into something that needs dismissing. It is
 * ONE line, so there is never a paragraph to skip. And it carries NO counts or
 * other live state: "7 activities" answers a different question from "what is
 * this page for", and a number ticking inside a sentence that never changes is
 * what makes a header look busy.
 *
 * It sits BELOW the title row rather than inside the title column, so it spans
 * the content instead of stopping short at the primary action button.
 *
 * Rendered here rather than inlined per page so the set cannot drift apart
 * visually — `PageHeader` mounts it for most pages, and Schedule mounts it
 * directly because it hand-rolls its header around a view toggle.
 */
export function PagePurpose({ purpose }: { purpose?: PagePurposeKey }) {
  const t = useTranslations('PagePurpose')
  if (!purpose) return null
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-sm">
        <span className="font-medium">{t(purpose)}</span>
        <span className="mx-1.5 text-muted-foreground opacity-50">·</span>
        <span className="text-muted-foreground">{t(`${purpose}Note`)}</span>
      </p>
    </div>
  )
}
