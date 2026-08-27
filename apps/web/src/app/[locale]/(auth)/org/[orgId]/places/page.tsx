'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { SearchInput } from '@/components/ui/search-input'
import { Skeleton } from '@/components/ui/skeleton'
import { PlacesManager, type PlaceFormValues } from '@/components/places/PlacesManager'
import { useOrgPlaces, createOrgPlace, updateOrgPlace, deleteOrgPlace } from '@/hooks/usePlaces'
import { MAX_PLACES } from '@linyup/shared'

export default function OrgPlacesPage() {
  const t = useTranslations('OrgPlaces')
  const { orgId } = useParams<{ orgId: string }>()
  const { isAdmin } = useOrg()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: places = [], isLoading } = useOrgPlaces(orgId)
  const [search, setSearch] = useState('')
  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-places', orgId] })

  // Client-side, over the places already in hand. Name and address are matched
  // separately rather than against one joined string, so a query cannot match by
  // straddling the boundary between them.
  const term = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!term) return places
    return places.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(term) ||
        (p.address ?? '').toLowerCase().includes(term),
    )
  }, [places, term])

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

  const noMatches = term !== '' && visible.length === 0

  return (
    <div className="max-w-3xl space-y-5">
      {/* The heading and the search field are rendered here, and PlacesManager is
          mounted in the variant that drops its own <h1> and measure: the field
          belongs between the title and the cards, and the shared manager's page
          chrome has no slot there. */}
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Mounted once there is a list to narrow. A field over an organization
          with no places yet is a control with nothing to do. */}
      {places.length > 0 && (
        <div className="max-w-xs">
          <SearchInput
            className="h-9 text-sm"
            placeholder={t('searchPlaceholder')}
            value={search}
            onValueChange={setSearch}
          />
        </div>
      )}

      {noMatches ? (
        // Its own copy, not the manager's "No places yet" — a search that matched
        // nothing and an organization with no places are different situations,
        // and reusing the second reads as the places having disappeared.
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {t('emptySearch', { query: search.trim() })}
        </p>
      ) : (
        <PlacesManager
          title={t('title')}
          subtitle={t('subtitle')}
          variant="sheet"
          places={visible}
          canManage={isAdmin}
          // The manager compares `cap` against the list it is handed, so a
          // narrowed list has to narrow the cap by the same amount — otherwise
          // typing in the search field re-enables "Add place" on an organization
          // that has already reached the limit.
          cap={MAX_PLACES - (places.length - visible.length)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
