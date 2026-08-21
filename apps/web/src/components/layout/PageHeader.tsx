'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
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
  purpose,
  subtitle,
  quickLinks,
  action,
}: {
  title: string
  /** Which page this is, for the purpose block. See `PagePurpose`. */
  purpose?: PagePurposeKey
  subtitle?: ReactNode
  quickLinks?: QuickLink[]
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <PagePurpose purpose={purpose} detail={subtitle} />
        {quickLinks && <QuickLinks links={quickLinks} />}
      </div>
      {action && <div className="flex shrink-0 items-center gap-3">{action}</div>}
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
 * The answer to "what is this page for", in a phrase and one line.
 *
 * ── WHY THESE ARE WRITTEN AS A SET ──────────────────────────────────────────
 * "What you do" · "When you offer it" · "How you get paid" · "What people
 * actually pay" only work because they are PARALLEL — each names a different
 * question about the same business, and read together they are a sentence about
 * how the product is organised. Read apart they are four unremarkable labels. So
 * they live in one message namespace (`PagePurpose`), where a translator sees
 * all of them at once and can keep the parallelism; split across each page's own
 * namespace they would drift into four unrelated descriptions within a release
 * or two.
 *
 * ── WHY THE PHRASE IS NOT ALONE ─────────────────────────────────────────────
 * A four-word phrase orients but does not inform: "What you do" reads as a
 * label rather than an explanation, and a studio meeting it for the first time
 * learns nothing it could act on. The note under it does the actual explaining —
 * short, concrete, and about THIS collection rather than about the product. The
 * phrase is the hook; the note is the answer.
 *
 * The component reads BOTH from the one key it is given, so the pair cannot be
 * mounted half-present — a page passing `purpose="activities"` always renders
 * `activities` and `activitiesNote` together.
 *
 * ── WHY IT IS TEXT AND NOT A CALLOUT ────────────────────────────────────────
 * A bordered, coloured box would out-weigh the two short lines inside it, and a
 * studio sees this header several times a day for years. The orientation is
 * worth two muted lines forever; it is not worth a panel forever, and it is not
 * worth the dismissal state that a panel would eventually need.
 *
 * Rendered here rather than inlined per page so the set cannot drift apart
 * visually — `PageHeader` mounts it for most pages, and Schedule mounts it
 * directly because it hand-rolls its header around a view toggle.
 */
export function PagePurpose({
  purpose,
  detail,
}: {
  purpose?: PagePurposeKey
  /** The page's own count ("12 activities"). State, not orientation — so it
   *  rides at the end of the phrase line, weaker than the phrase. */
  detail?: ReactNode
}) {
  const t = useTranslations('PagePurpose')
  if (!purpose && !detail) return null
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-sm">
        {purpose && <span className="font-medium">{t(purpose)}</span>}
        {purpose && detail ? (
          <span className="mx-1.5 text-muted-foreground opacity-50">·</span>
        ) : null}
        {detail ? <span className="text-muted-foreground">{detail}</span> : null}
      </p>
      {purpose && (
        <p className="max-w-2xl text-xs text-muted-foreground">{t(`${purpose}Note`)}</p>
      )}
    </div>
  )
}
