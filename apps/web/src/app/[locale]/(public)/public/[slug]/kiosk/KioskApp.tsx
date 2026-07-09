'use client'

// The fixed kiosk shell. Team resolution is already done by the parent
// `/public/{slug}` layout (PublicTeamProvider), so we just consume its context —
// mirrors how /site and the other sibling surfaces read `usePublicTeam()` rather
// than re-querying `public_profile` themselves.
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { KioskFeatures, KioskStandbyConfig, KioskScheduleView } from '@linyup/shared'
import { usePublicTeam } from '../PublicTeamProvider'
import { useKioskSessions } from './useKioskSessions'
import { useIdleTimer } from './useIdleTimer'
import KioskLock from './KioskLock'
import KioskHeader from './KioskHeader'
import KioskSchedule from './KioskSchedule'
import NowNext from './NowNext'
import CheckinQr from './CheckinQr'
import WalkIn from './WalkIn'
import Standby from './Standby'

interface Props {
  slug: string
}

export default function KioskApp({ slug }: Props) {
  const t = useTranslations('Kiosk')
  const { teamId, team } = usePublicTeam()
  const kiosk = team.kiosk
  const isActive = team.active_public_surfaces?.kiosk === true

  // Gate: the kiosk plugin isn't installed/active for this team (or its public
  // config hasn't been denormalized yet) — no lock screen, no data reads.
  if (!isActive || !kiosk) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background px-6 text-center">
        <p className="text-lg font-semibold text-muted-foreground">
          {t('notAvailable')}
        </p>
      </div>
    )
  }

  return (
    <KioskLock slug={slug} teamId={teamId} lock={kiosk.lock}>
      <KioskShell
        slug={slug}
        teamId={teamId}
        teamName={team.name}
        logoUrl={team.profileImage}
        title={kiosk.title || team.name}
        scheduleView={kiosk.scheduleView}
        features={kiosk.features}
        walkInActivityIds={kiosk.walkInActivityIds}
        standby={kiosk.standby}
      />
    </KioskLock>
  )
}

interface ShellProps {
  slug: string
  teamId: string
  teamName: string
  logoUrl?: string
  title: string
  scheduleView: KioskScheduleView
  features: KioskFeatures
  walkInActivityIds?: string[]
  standby: KioskStandbyConfig
}

function KioskShell({
  slug,
  teamId,
  teamName,
  logoUrl,
  title,
  scheduleView,
  features,
  walkInActivityIds,
  standby,
}: ShellProps) {
  const t = useTranslations('Kiosk')
  const { sessions, loading } = useKioskSessions(teamId)

  // Standby idle detection — enabled only when the studio turned the feature on.
  const idle = useIdleTimer(Math.max(standby.idleSeconds, 5) * 1000, features.standby)

  // Force-remount WalkIn (throwing away all its local state, per the privacy
  // requirement) the moment the kiosk goes idle — not on every render while idle.
  const [walkInResetKey, setWalkInResetKey] = useState(0)
  const wasIdle = useRef(false)
  useEffect(() => {
    if (idle && !wasIdle.current) {
      setWalkInResetKey((k) => k + 1)
    }
    wasIdle.current = idle
  }, [idle])

  const hasSidebar = features.nowNext || features.checkinQr

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
      <KioskHeader title={title} logoUrl={logoUrl} />

      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 sm:flex-row sm:p-10">
        {features.schedule && (
          <section className="flex min-h-0 flex-1 flex-col">
            <h2 className="mb-4 text-lg font-bold">{t('scheduleTitle')}</h2>
            <div className="min-h-0 flex-1">
              <KioskSchedule sessions={sessions} loading={loading} view={scheduleView} />
            </div>
          </section>
        )}

        {hasSidebar && (
          <aside className="flex w-full shrink-0 flex-col gap-6 sm:w-80">
            {features.nowNext && <NowNext sessions={sessions} />}
            {features.checkinQr && <CheckinQr slug={slug} />}
          </aside>
        )}
      </main>

      {features.walkIn && (
        <WalkIn
          key={walkInResetKey}
          teamId={teamId}
          sessions={sessions}
          walkInActivityIds={walkInActivityIds}
        />
      )}

      {features.standby && idle && (
        <Standby media={standby.media} teamName={teamName} logoUrl={logoUrl} />
      )}
    </div>
  )
}
