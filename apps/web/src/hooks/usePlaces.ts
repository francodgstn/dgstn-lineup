'use client'

// Places — Firestore CRUD for a team's (and an org's) physical locations.
//   team places → teams/{teamId}/team_places/{placeId}
//   org places  → organizations/{orgId}/org_places/{placeId}  (read-only for sub-teams)
// The primary team place is denormalised to public_profile.mainAddress by a Cloud
// Function for the bio-link.

import { useQuery } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getCountFromServer,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  TEAMS_COLLECTION,
  TEAM_PLACES_SUBCOLLECTION,
  ORGANIZATIONS_COLLECTION,
  ORG_PLACES_SUBCOLLECTION,
} from '@linyup/shared'
import type { Place } from '@linyup/shared'

export function teamPlacesCol(teamId: string) {
  return collection(db, TEAMS_COLLECTION, teamId, TEAM_PLACES_SUBCOLLECTION)
}
export function orgPlacesCol(orgId: string) {
  return collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_PLACES_SUBCOLLECTION)
}

function sortPlaces(a: Place, b: Place): number {
  if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1
  const ao = a.order ?? Number.MAX_SAFE_INTEGER
  const bo = b.order ?? Number.MAX_SAFE_INTEGER
  if (ao !== bo) return ao - bo
  return (a.name ?? '').localeCompare(b.name ?? '')
}

/** A team's own places plus any inherited org-wide places (org ones are read-only). */
export function usePlaces(teamId: string | null, orgId?: string | null) {
  return useQuery<Place[]>({
    queryKey: ['places', teamId, orgId ?? null],
    enabled: !!teamId,
    queryFn: async () => {
      const teamSnap = await getDocs(teamPlacesCol(teamId!))
      const team = teamSnap.docs
        .map((d) => ({ ...(d.data() as Omit<Place, 'id'>), id: d.id, scope: 'team' as const }))
        .sort(sortPlaces)
      let org: Place[] = []
      if (orgId) {
        try {
          const orgSnap = await getDocs(orgPlacesCol(orgId))
          org = orgSnap.docs
            .map((d) => ({ ...(d.data() as Omit<Place, 'id'>), id: d.id, scope: 'org' as const }))
            .sort(sortPlaces)
        } catch {
          org = []
        }
      }
      return [...team, ...org]
    },
  })
}

/** An org's own places (org-admin management). */
export function useOrgPlaces(orgId: string | null) {
  return useQuery<Place[]>({
    queryKey: ['org-places', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const snap = await getDocs(orgPlacesCol(orgId!))
      return snap.docs
        .map((d) => ({ ...(d.data() as Omit<Place, 'id'>), id: d.id, scope: 'org' as const }))
        .sort(sortPlaces)
    },
  })
}

export type PlaceInput = Pick<Place, 'name' | 'address' | 'mapsLink' | 'isPrimary' | 'rooms' | 'order'>

// ─── team places ────────────────────────────────────────────────────────────────

export async function createPlace(opts: { teamId: string; userId: string; data: PlaceInput }): Promise<string> {
  const ref = doc(teamPlacesCol(opts.teamId))
  await setDoc(ref, {
    teamId: opts.teamId,
    scope: 'team',
    ...stripUndefined(opts.data),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    createdBy: opts.userId,
  })
  return ref.id
}

export async function updatePlace(teamId: string, placeId: string, patch: Partial<PlaceInput>): Promise<void> {
  await updateDoc(doc(teamPlacesCol(teamId), placeId), {
    ...stripUndefined(patch),
    updated_at: serverTimestamp(),
  })
}

export async function deletePlace(teamId: string, placeId: string): Promise<void> {
  await deleteDoc(doc(teamPlacesCol(teamId), placeId))
}

/** Make one place primary, clearing the flag on every other team place. */
export async function setPrimaryPlace(teamId: string, placeId: string): Promise<void> {
  const snap = await getDocs(teamPlacesCol(teamId))
  const batch = writeBatch(db)
  snap.docs.forEach((d) => {
    const shouldBe = d.id === placeId
    if (!!d.data().isPrimary !== shouldBe) {
      batch.update(d.ref, { isPrimary: shouldBe, updated_at: serverTimestamp() })
    }
  })
  await batch.commit()
}

export async function countPlaces(teamId: string): Promise<number> {
  const snap = await getCountFromServer(teamPlacesCol(teamId))
  return snap.data().count
}

// ─── org places ─────────────────────────────────────────────────────────────────

export async function createOrgPlace(opts: { orgId: string; userId: string; data: PlaceInput }): Promise<string> {
  const ref = doc(orgPlacesCol(opts.orgId))
  // Org places are shared; `isPrimary` is a team-only concept and is dropped.
  const { isPrimary: _drop, ...data } = opts.data
  await setDoc(ref, {
    orgId: opts.orgId,
    scope: 'org',
    ...stripUndefined(data),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    createdBy: opts.userId,
  })
  return ref.id
}

export async function updateOrgPlace(orgId: string, placeId: string, patch: Partial<PlaceInput>): Promise<void> {
  const { isPrimary: _drop, ...data } = patch
  await updateDoc(doc(orgPlacesCol(orgId), placeId), {
    ...stripUndefined(data),
    updated_at: serverTimestamp(),
  })
}

export async function deleteOrgPlace(orgId: string, placeId: string): Promise<void> {
  await deleteDoc(doc(orgPlacesCol(orgId), placeId))
}

export async function countOrgPlaces(orgId: string): Promise<number> {
  const snap = await getCountFromServer(orgPlacesCol(orgId))
  return snap.data().count
}

// Firestore rejects `undefined` field values; drop them before writing.
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
