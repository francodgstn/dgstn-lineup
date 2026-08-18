'use client'

// BOOKABLE HOURS, over the schedule — the management surface for appointment
// availability, opened as a side sheet from the Schedule header.
//
// WHY A SHEET. Publishing a coach's hours is a job you do WHILE looking at the
// week those hours have to fit into: the conflicts that matter are with the
// classes already on the grid, and a full-page destination takes the calendar
// away at exactly the moment it is the reference. The sheet keeps the grid
// visible behind it (and, with the Bookable hours LAYER on, the windows drawn on
// that grid update live as they are edited — the queries are shared).
//
// WHAT IS AND IS NOT HERE. This sheet LISTS and LAUNCHES. Editing one window is
// a ~370-line form with recurrence, explicit-times mode, buffers, granularity
// and activity links, and it stays the DIALOG it already is — squeezing it into
// a 24rem column would be a rewrite, and a second availability writer.
// Everything below the header is `AppointmentAvailabilityManager`, the same
// component the /schedule/availability route renders, in its collapsed density.
//
// THE ROUTE SURVIVES. /schedule/availability is still a route, still renders the
// same manager, and is linked from this sheet's footer. UX-3 gave bookable hours
// a named home on purpose; links, bookmarks and habits point at it.

import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ArrowUpRight, CalendarClock, Eye, ExternalLink } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { AppointmentAvailabilityManager } from '@/components/appointments/AppointmentAvailability'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  userId: string
  /** Whether the Bookable hours LAYER is currently drawn on the calendar behind
   *  this sheet. When it isn't, the sheet says so and offers to switch it on —
   *  it never flips a stored view preference on the user's behalf. */
  layerVisible?: boolean
  onShowLayer?: () => void
}

export function BookableHoursSheet({
  open,
  onOpenChange,
  teamId,
  userId,
  layerVisible,
  onShowLayer,
}: Props) {
  const t = useTranslations('Appointments')
  const tq = useTranslations('QuickLinks')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl gap-0 p-0"
      >
        <SheetHeader className="shrink-0 border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            {t('bookableHoursTitle')}
          </SheetTitle>
          <SheetDescription>{t('bookableHoursSubtitle')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* The layer state, stated where it is being contradicted: a studio
              editing windows it cannot see on the grid behind the sheet has no
              way to know the grid is not lying to it. */}
          {layerVisible === false && onShowLayer && (
            <button
              type="button"
              onClick={onShowLayer}
              className="mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{t('layerHiddenNote')}</span>
              <span className="shrink-0 font-medium text-primary">{t('layerShowOnCalendar')}</span>
            </button>
          )}

          <AppointmentAvailabilityManager teamId={teamId} userId={userId} variant="sheet" />
        </div>

        {/* THE APPOINTMENT-ACTIVITY LINK, kept visible on this surface too.
            A window publishes only the appointment ACTIVITIES listed on it, and
            the bookable lengths + prices live on the activity, never on the
            window — so hours with no appointment activity behind them silently
            produce zero slots and say nothing about why. This is the one link
            that answers "why can nobody book me?", and it must not be reachable
            only from the route this sheet replaces as the everyday entry point. */}
        <div className="shrink-0 space-y-2 border-t bg-muted/20 p-4">
          <Link
            href={'/offer/activities' as Route}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            {tq('availabilityToActivities')}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
          <Link
            href={'/schedule/availability' as Route}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {t('openFullPage')}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
