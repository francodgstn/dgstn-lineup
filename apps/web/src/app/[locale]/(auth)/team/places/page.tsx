'use client'

import { useQueryClient } from '@tanstack/react-query'
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

  if (isLoading || !currentTeamId) {
    return (
      <div className="max-w-3xl space-y-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    )
  }

  return (
    <PlacesManager
      title="Places"
      subtitle="Your studio locations and rooms. The main address is shown with a map on your public pages."
      places={own}
      inherited={inherited}
      allowPrimary
      cap={MAX_PLACES}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onSetPrimary={handleSetPrimary}
    />
  )
}
