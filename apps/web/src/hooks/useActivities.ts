'use client'

import { useQuery } from '@tanstack/react-query'
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ACTIVITIES_COLLECTION, compareActivities } from '@linyup/shared'
import type { Activity } from '@linyup/shared'

/** A team's active (non-archived) activities, in studio display order. */
export function useActivities(teamId: string | null) {
  return useQuery<Activity[]>({
    queryKey: ['activities', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, ACTIVITIES_COLLECTION),
        where('teamId', '==', teamId),
        where('isActive', '==', true),
        orderBy('name', 'asc'),
      )
      const snap = await getDocs(q)
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id }) as Activity)
        .sort(compareActivities)
    },
  })
}
