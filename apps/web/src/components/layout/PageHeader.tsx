import type { ReactNode } from 'react'
import type { Route } from 'next'
import { ArrowUp } from 'lucide-react'
import { Link } from '@/i18n/navigation'

// Shared page header for list/config pages (Activities, Event types,
// Subscriptions, …). Keeps the title block + primary action consistent.
//
// Optional `upHref` renders a generic "up to parent" link on the RIGHT (an up
// arrow + the parent's name, e.g. "Public pages"). It's hierarchy, not history:
// a plain link that's always shown, so it works whether the page was reached
// from its hub or opened directly.
export function PageHeader({
  title,
  subtitle,
  action,
  upHref,
  upLabel,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  upHref?: Route
  upLabel?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {(upHref || action) && (
        <div className="flex shrink-0 items-center gap-3">
          {action}
          {upHref && (
            <Link
              href={upHref}
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowUp className="h-4 w-4" />
              {upLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
