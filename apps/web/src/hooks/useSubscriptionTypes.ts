'use client'

import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION } from '@linyup/shared'
import type { SubscriptionType } from '@linyup/shared'

/** A team's subscription/membership types (teams/{id}/subscription_types). */
export function useSubscriptionTypes(teamId: string | null) {
  return useQuery<SubscriptionType[]>({
    queryKey: ['subscription-types', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION)
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as SubscriptionType)
    },
  })
}
