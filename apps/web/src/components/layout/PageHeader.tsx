import type { ReactNode } from 'react'
import type { Route } from 'next'
import { ChevronLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'

// Shared page header for list/config pages (Activities, Event types,
// Subscriptions, …). Keeps the title block + primary action consistent.
// Optional back-link renders a small breadcrumb above the title, used by
// hub→detail pages (e.g. the Public pages Shop/Space settings).
export function PageHeader({
  title,
  subtitle,
  action,
  backHref,
  backLabel,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  backHref?: Route
  backLabel?: string
}) {
  return (
    <div className="space-y-1">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}
