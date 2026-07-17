'use client'

// Shared "this failed to load" block — the counterpart to the empty-state pattern
// used across list/manager surfaces (icon + message + optional hint), but for a
// FAILED fetch rather than a genuine zero-results state. Failure must never render
// as an empty state: a coach who sees "No coaches yet" after a permission error
// concludes they misconfigured something; they should see this instead, with a
// way to retry.

import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MAX_DETAIL_LENGTH = 160

function truncateDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH - 1)}…` : detail
}

export function QueryErrorState({
  onRetry,
  title,
  detail,
  className,
}: {
  /** Re-run the failed query/load. */
  onRetry: () => void
  /** Overrides the default "Couldn't load this" copy. */
  title?: string
  /** The underlying error's message, if any — shown truncated as a detail line. */
  detail?: string | null
  className?: string
}) {
  const t = useTranslations('Common')
  return (
    <div
      className={`flex flex-col items-center gap-3 py-10 text-center${className ? ` ${className}` : ''}`}
      role="alert"
    >
      <AlertTriangle className="h-8 w-8 text-destructive/70" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title ?? t('errorLoadTitle')}</p>
        {detail && (
          <p className="max-w-sm truncate text-sm text-muted-foreground" title={detail}>
            {truncateDetail(detail)}
          </p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t('errorRetry')}
      </Button>
    </div>
  )
}
