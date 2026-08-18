'use client'

// "Bookable hours" — the named home for appointment availability.
//
// This is UX-3's destination: publishing the hours a coach can be booked in, and
// blocking time off, used to live in a dialog whose only trigger was a bare
// chevron welded to the Schedule page's "Availability" filter chip. A coach
// testing the product spent two goals looking for it and gave up. A route can be
// linked to by name from the Schedule header, shared, bookmarked, and opened by a
// test — none of which was true of a menu-triggered dialog.
//
// SINCE THE SIDE SHEET LANDED, this route is no longer the everyday entry
// point — the Schedule header's "Bookable hours" button opens
// `components/schedule/BookableHoursSheet` over the calendar, because the hours
// are published against the week they have to fit into. THE ROUTE STAYS, and is
// linked from that sheet's footer: bookmarks, shared links, QR codes and habits
// point here, and UX-3's reason for naming a home has not expired. It is the
// same manager component in its expanded density (`variant='page'`), so there is
// exactly one writer of availability documents.
//
// The surface itself is AppointmentAvailabilityManager; this page is the shell.

import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ArrowLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { AppointmentAvailabilityManager } from '@/components/appointments/AppointmentAvailability'

export default function BookableHoursPage() {
  const { currentTeamId, user } = useAuth()
  const t = useTranslations('Appointments')
  const tq = useTranslations('QuickLinks')

  return (
    <div className="space-y-6">
      <Link
        href={'/schedule' as Route}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('backToSchedule')}
      </Link>

      {/* ONE quick link (UX-71), and it is the one that answers "why can nobody
          book me?": a window publishes only the appointment ACTIVITIES listed on
          it, and the bookable lengths + prices live on the activity, never on the
          window — so hours with no appointment activity behind them produce zero
          slots and say nothing about why. The calendar is deliberately NOT a
          second link here: the back-link directly above already goes there. */}
      <PageHeader
        title={t('bookableHoursTitle')}
        subtitle={t('bookableHoursSubtitle')}
        quickLinks={[{ href: '/offer/activities' as Route, label: tq('availabilityToActivities') }]}
      />

      {currentTeamId && user ? (
        <AppointmentAvailabilityManager teamId={currentTeamId} userId={user.uid} />
      ) : (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}
    </div>
  )
}
