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

  return (
    <div className="space-y-6">
      <Link
        href={'/schedule' as Route}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('backToSchedule')}
      </Link>

      <PageHeader title={t('bookableHoursTitle')} subtitle={t('bookableHoursSubtitle')} />

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
