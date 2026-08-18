'use client'

// "Places" — the studio's locations and rooms.
//
// This is UX-67's destination. Places is a SCHEDULING concept, not a preference:
// the session and event forms pick a place (and a room) from this list, the
// website's places section renders it, and the moment it is edited is the moment
// the schedule needs a room that doesn't exist yet. It used to live at
// /settings/places, so adding one meant leaving the calendar for Settings and
// hunting through three groups to get back. It now sits beside the calendar that
// reads it — a sibling of /schedule/availability, with the same shell (back link
// + the shared PlacesManager).
//
// /settings/places and /team/places both redirect here, so bookmarks and any link
// already in the world keep working.

import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ArrowLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/skeleton'
import { PlacesManager, type PlaceFormValues } from '@/components/places/PlacesManager'
import {
  usePlaces,
  createPlace,
  updatePlace,
  deletePlace,
  setPrimaryPlace,
} from '@/hooks/usePlaces'
import { MAX_PLACES } from '@linyup/shared'

export default function TeamPlacesPage() {
  const t = useTranslations('SettingsPlaces')
  const { currentTeamId, team, user } = useAuth()
  const orgId = team?.org_id ?? null
  const qc = useQueryClient()
  const { data: all = [], isLoading } = usePlaces(currentTeamId, orgId)

  const own = all.filter((p) => p.scope === 'team')
  const inherited = all.filter((p) => p.scope === 'org')
  const invalidate = () => qc.invalidateQueries({ queryKey: ['places', currentTeamId, orgId] })

  async function handleCreate(d: PlaceFormValues) {
    if (!currentTeamId || !user) return
    const id = await createPlace({ teamId: currentTeamId, userId: user.uid, data: d })
    if (d.isPrimary) await setPrimaryPlace(currentTeamId, id)
    invalidate()
  }
  async function handleUpdate(id: string, d: PlaceFormValues) {
    if (!currentTeamId) return
    await updatePlace(currentTeamId, id, d)
    if (d.isPrimary) await setPrimaryPlace(currentTeamId, id)
    invalidate()
  }
  async function handleDelete(id: string) {
    if (!currentTeamId) return
    await deletePlace(currentTeamId, id)
    invalidate()
  }
  async function handleSetPrimary(id: string) {
    if (!currentTeamId) return
    await setPrimaryPlace(currentTeamId, id)
    invalidate()
  }

  const backLink = (
    <Link
      href={'/schedule' as Route}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {t('backToSchedule')}
    </Link>
  )

  if (isLoading || !currentTeamId) {
    return (
      <div className="max-w-3xl space-y-5">
        {backLink}
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {backLink}
      <PlacesManager
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        places={own}
        inherited={inherited}
        allowPrimary
        cap={MAX_PLACES}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onSetPrimary={handleSetPrimary}
      />
    </div>
  )
}
