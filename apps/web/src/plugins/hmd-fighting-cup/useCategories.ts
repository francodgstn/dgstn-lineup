'use client'

import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { EVENTS_COLLECTION, EVENT_CATEGORIES_SUBCOLLECTION } from '@linyup/shared'
import type { EventCategory } from '@linyup/shared'

/** Per-event fighting-cup categories, ordered by sort_order. Shared by the
 *  category manager, the check-in form, and the lineup exports so they all read
 *  from the same react-query cache key. */
export function useFightingCupCategories(eventId: string) {
  return useQuery<EventCategory[]>({
    queryKey: ['event-categories', eventId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, EVENTS_COLLECTION, eventId, EVENT_CATEGORIES_SUBCOLLECTION),
          orderBy('sort_order'),
        ),
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as EventCategory)
    },
  })
}
