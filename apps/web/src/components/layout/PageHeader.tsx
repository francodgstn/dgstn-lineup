import type { ReactNode } from 'react'

// Shared page header for list/config pages (Activities, Event types,
// Subscriptions, …). Keeps the title block + primary action consistent.
//
// Navigation back to a hub is intentionally NOT part of this header: the sidebar
// is the single, consistent way back (e.g. the "All public pages" nav item), so
// detail pages don't sprout their own inconsistent up-links.
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-3">{action}</div>}
    </div>
  )
}
