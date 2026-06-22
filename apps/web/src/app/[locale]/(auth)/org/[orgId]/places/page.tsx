'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { Skeleton } from '@/components/ui/skeleton'
import { PlacesManager, type PlaceFormValues } from '@/components/places/PlacesManager'
import { useOrgPlaces, createOrgPlace, updateOrgPlace, deleteOrgPlace } from '@/hooks/usePlaces'
import { MAX_PLACES } from '@linyup/shared'

export default function OrgPlacesPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const { isAdmin } = useOrg()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: places = [], isLoading } = useOrgPlaces(orgId)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-places', orgId] })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    )
  }

  async function handleCreate(d: PlaceFormValues) {
    if (!user) return
    await createOrgPlace({ orgId, userId: user.uid, data: d })
    invalidate()
  }
  async function handleUpdate(id: string, d: PlaceFormValues) {
    await updateOrgPlace(orgId, id, d)
    invalidate()
  }
  async function handleDelete(id: string) {
    await deleteOrgPlace(orgId, id)
    invalidate()
  }

  return (
    <PlacesManager
      title="Org places"
      subtitle="Locations shared with every studio in this organization."
      places={places}
      canManage={isAdmin}
      cap={MAX_PLACES}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
    />
  )
}
