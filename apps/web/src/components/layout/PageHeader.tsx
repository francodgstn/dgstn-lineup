import type { ReactNode } from 'react'
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
  /** What this collection is FOR, in a few words. See `PagePurpose`. */
  purpose?: string
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
 * The one-line answer to "what is this page for".
 *
 * ── WHY THESE ARE WRITTEN AS A SET ──────────────────────────────────────────
 * "What you do" · "When you offer them" · "How you get paid" only work because
 * they are PARALLEL — each names a different question about the same business,
 * and read together they are a sentence about how the product is organised. Read
 * apart they are three unremarkable labels. So they live in one message
 * namespace (`PagePurpose`), where a translator sees all of them at once and can
 * keep the parallelism; split across each page's own namespace, they would drift
 * into three unrelated descriptions within a release or two.
 *
 * ── WHY IT IS A LINE AND NOT A CALLOUT ──────────────────────────────────────
 * A bordered, coloured box would out-weigh the three words inside it, and a
 * studio sees this header several times a day for years. The orientation is
 * worth one muted line forever; it is not worth a panel forever, and it is not
 * worth the dismissal state that a panel would eventually need.
 *
 * Rendered here rather than inlined per page so the three cannot drift apart
 * visually — `PageHeader` mounts it for most pages, and Schedule mounts it
 * directly because it hand-rolls its header around a view toggle.
 */
export function PagePurpose({ purpose, detail }: { purpose?: string; detail?: ReactNode }) {
  if (!purpose && !detail) return null
  return (
    <p className="mt-1 text-sm text-muted-foreground">
      {purpose}
      {/* The count is state, the purpose is orientation — same line, but the
          weaker of the two, so the answer to "what is this" is read first. */}
      {purpose && detail ? <span className="mx-1.5 opacity-50">·</span> : null}
      {detail ? <span className="opacity-80">{detail}</span> : null}
    </p>
  )
}
