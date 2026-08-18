'use client'

import { useTranslations } from 'next-intl'
import { ArrowLeft, CalendarDays, MapPin, Printer, User } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { ProgramTimeline } from './ProgramTimeline'
import type { PublicEventSummary } from './usePublicEvents'

// Shared detail rendering for the public event surfaces. Never receives
// internal notes — the mirror does not carry them, and showInternalNotes is
// deliberately not passed here.

function formatRange(event: PublicEventSummary): string {
  const start = (event.start as unknown as { toDate?: () => Date } | null)?.toDate?.()
  const end = (event.end as unknown as { toDate?: () => Date } | null)?.toDate?.()
  if (!start) return ''
  const full: Intl.DateTimeFormatOptions = {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }
  if (!end || start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString(undefined, full)
  }
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} – ${end.toLocaleDateString(undefined, full)}`
}

export function PublicEventDetail({
  event,
  backHref,
  backLabel,
  printHref,
}: {
  event: PublicEventSummary
  backHref: string
  backLabel: string
  printHref?: string
}) {
  const t = useTranslations('EventProgram')

  return (
    <div className="space-y-6">
      <Link
        href={backHref as Route}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 shrink-0" />
            {formatRange(event)}
          </span>
          {event.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" />
              {event.location}
            </span>
          )}
          {event.coachName && (
            <span className="inline-flex items-center gap-1.5">
              <User className="h-4 w-4 shrink-0" />
              {event.coachName}
            </span>
          )}
        </div>
        {event.description && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.description}</p>
        )}
      </header>

      {event.programItemCount > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t('publicProgrammeTitle')}</h2>
            {printHref && (
              <Link
                href={printHref as Route}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted print:hidden"
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                {t('print')}
              </Link>
            )}
          </div>
          <ProgramTimeline config={event.program ?? undefined} items={event.programItems} />
        </section>
      )}
    </div>
  )
}
