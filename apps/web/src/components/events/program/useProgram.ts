'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  EVENTS_COLLECTION,
  EVENT_PROGRAM_ITEMS_SUBCOLLECTION,
  MAX_PROGRAM_ITEMS,
  compareProgramItems,
} from '@linyup/shared'
import type {
  Event,
  EventProgramConfig,
  EventProgramItem,
  MaterialisedItem,
} from '@linyup/shared'

// Data layer for the event program. Everything here is tenant-agnostic: the
// tenant fields are read off the Event document itself (teamId / orgId / scope)
// rather than from team context, so the SAME components serve both the team
// event page and the org event page. Org events have no teamId — never assume
// one is present.

/** The tenant stamp every program item carries, denormalised so security rules
 *  never need a get() on the parent event. */
export interface ProgramTenant {
  teamId?: string
  orgId?: string
  scope?: 'team' | 'org'
}

export function programTenant(event: Pick<Event, 'teamId' | 'orgId' | 'scope'>): ProgramTenant {
  const scope = event.scope ?? (event.orgId && !event.teamId ? 'org' : 'team')
  return {
    ...(event.teamId ? { teamId: event.teamId } : {}),
    ...(event.orgId ? { orgId: event.orgId } : {}),
    scope,
  }
}

export const programQueryKey = (eventId: string) => ['event-program', eventId] as const

function itemsCollection(eventId: string) {
  return collection(db, EVENTS_COLLECTION, eventId, EVENT_PROGRAM_ITEMS_SUBCOLLECTION)
}

/** Every program item for the event, in canonical order.
 *
 *  Fetched in one query with no pagination: the item count is capped at
 *  MAX_PROGRAM_ITEMS, so the whole agenda comfortably fits in memory and the
 *  day/track grouping happens client-side. That also means no composite index
 *  is needed for this collection. */
export function useProgramItems(eventId: string) {
  return useQuery<EventProgramItem[]>({
    queryKey: programQueryKey(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const snap = await getDocs(itemsCollection(eventId))
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id }) as EventProgramItem)
        .sort(compareProgramItems)
    },
  })
}

/** Write the program config (days, tracks, labels) back onto the event doc. */
export function useSaveProgramConfig(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (config: EventProgramConfig) => {
      await updateDoc(doc(db, EVENTS_COLLECTION, eventId), { program: config })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })
}

export type ProgramItemDraft = Omit<
  EventProgramItem,
  'id' | 'eventId' | 'teamId' | 'orgId' | 'scope' | 'created_at' | 'updated_at' | 'createdBy'
>

export function useCreateProgramItem(eventId: string, tenant: ProgramTenant) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (draft: ProgramItemDraft) => {
      const ref = doc(itemsCollection(eventId))
      await setDoc(ref, {
        ...draft,
        eventId,
        ...tenant,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })
      return ref.id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: programQueryKey(eventId) }),
  })
}

export function useUpdateProgramItem(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, patch }: { itemId: string; patch: Partial<ProgramItemDraft> }) => {
      await updateDoc(doc(itemsCollection(eventId), itemId), {
        ...patch,
        updated_at: serverTimestamp(),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: programQueryKey(eventId) }),
  })
}

export function useDeleteProgramItem(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: string) => {
      await deleteDoc(doc(itemsCollection(eventId), itemId))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: programQueryKey(eventId) }),
  })
}

/** Delete a day and every item on it, in one batch. Used when the manager
 *  confirms the destructive branch of "delete this day". */
export function useDeleteProgramDay(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      config,
      dayId,
      items,
    }: {
      config: EventProgramConfig
      dayId: string
      items: EventProgramItem[]
    }) => {
      const batch = writeBatch(db)
      for (const item of items.filter((i) => i.dayId === dayId)) {
        batch.delete(doc(itemsCollection(eventId), item.id))
      }
      const days = config.days
        .filter((d) => d.id !== dayId)
        .map((d, index) => ({ ...d, order: index }))
      batch.update(doc(db, EVENTS_COLLECTION, eventId), { program: { ...config, days } })
      await batch.commit()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: programQueryKey(eventId) })
      qc.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })
}

/** Delete a track. Its items are NOT deleted — they fall back to plenary
 *  (trackId: null), which is the non-destructive reading of "remove this lane". */
export function useDeleteProgramTrack(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      config,
      trackId,
      items,
    }: {
      config: EventProgramConfig
      trackId: string
      items: EventProgramItem[]
    }) => {
      const batch = writeBatch(db)
      for (const item of items.filter((i) => i.trackId === trackId)) {
        batch.update(doc(itemsCollection(eventId), item.id), { trackId: null })
      }
      const tracks = config.tracks
        .filter((t) => t.id !== trackId)
        .map((t, index) => ({ ...t, order: index }))
      batch.update(doc(db, EVENTS_COLLECTION, eventId), { program: { ...config, tracks } })
      await batch.commit()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: programQueryKey(eventId) })
      qc.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })
}

/** Replace the whole program with a materialised template: writes the new
 *  config and items and deletes whatever was there before, in one batch so the
 *  agenda is never left half-replaced. */
export function useReplaceProgram(eventId: string, tenant: ProgramTenant) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      config,
      items,
      existing,
    }: {
      config: EventProgramConfig
      items: MaterialisedItem[]
      existing: EventProgramItem[]
    }) => {
      if (items.length > MAX_PROGRAM_ITEMS) {
        throw new Error(`A program can hold at most ${MAX_PROGRAM_ITEMS} items.`)
      }
      const batch = writeBatch(db)
      for (const item of existing) batch.delete(doc(itemsCollection(eventId), item.id))
      for (const item of items) {
        batch.set(doc(itemsCollection(eventId)), {
          ...item,
          eventId,
          ...tenant,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      }
      batch.update(doc(db, EVENTS_COLLECTION, eventId), { program: config })
      await batch.commit()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: programQueryKey(eventId) })
      qc.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })
}
