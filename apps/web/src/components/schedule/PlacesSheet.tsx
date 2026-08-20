'use client'

// PLACES, over the schedule — the studio's locations and rooms, opened as a side
// sheet from the Schedule header.
//
// WHY A SHEET, and it is the same argument bookable hours made one button along
// (see BookableHoursSheet): the moment a place or a room is needed is the moment
// somebody is scheduling into it. Sending them to a full page takes away the
// calendar they were reading, and they come back having lost their week.
//
// THE FREE PART. `usePlaces` keys on `['places', teamId, orgId]` — the SAME key
// the session form's place picker reads (SessionFormDialog). A room added in
// this panel therefore appears in an open session form with no wiring, no event
// and no reload. That shared key is most of the reason this is worth doing at
// all, rather than a nicety of where the list is drawn.
//
// THE ROUTE SURVIVES. /schedule/places is still a route, still renders the same
// manager, and is linked from this sheet's footer — /settings/places and
// /team/places still redirect to it. UX-67 gave places a named home on purpose.

import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ExternalLink, MapPin } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  userId: string
  orgId: string | null
}

export function PlacesSheet({ open, onOpenChange, teamId, userId, orgId }: Props) {
  const t = useTranslations('SettingsPlaces')
  const qc = useQueryClient()
  const { data: all = [], isLoading } = usePlaces(teamId, orgId)

  const own = all.filter((p) => p.scope === 'team')
  const inherited = all.filter((p) => p.scope === 'org')
  const invalidate = () => qc.invalidateQueries({ queryKey: ['places', teamId, orgId] })

  // The same four callbacks the /schedule/places route wires. Duplicated
  // deliberately rather than lifted into a hook: they are four one-line calls
  // around the exported mutations in usePlaces, and a shared wrapper would add a
  // layer without removing a decision.
  async function handleCreate(d: PlaceFormValues) {
    const id = await createPlace({ teamId, userId, data: d })
    if (d.isPrimary) await setPrimaryPlace(teamId, id)
    invalidate()
  }
  async function handleUpdate(id: string, d: PlaceFormValues) {
    await updatePlace(teamId, id, d)
    if (d.isPrimary) await setPrimaryPlace(teamId, id)
    invalidate()
  }
  async function handleDelete(id: string) {
    await deletePlace(teamId, id)
    invalidate()
  }
  async function handleSetPrimary(id: string) {
    await setPrimaryPlace(teamId, id)
    invalidate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl gap-0 p-0"
      >
        <SheetHeader className="shrink-0 border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            {t('pageTitle')}
          </SheetTitle>
          <SheetDescription>{t('pageSubtitle')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
            </div>
          ) : (
            <PlacesManager
              // Passed but not rendered in this variant — the SheetHeader above
              // owns the heading. Kept in the props because the page variant
              // needs them and one component serves both.
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
              variant="sheet"
            />
          )}
        </div>

        <div className="shrink-0 border-t bg-muted/20 p-4">
          <Link
            href={'/schedule/places' as Route}
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
