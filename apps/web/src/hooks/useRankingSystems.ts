'use client'

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import type { RankingSystem, Organization } from '@linyup/shared'

interface RankingSystemsResult {
  rankingSystems: RankingSystem[]
  /** true when ranking systems are owned by the org, not the team */
  managedByOrg: boolean
  orgId: string | null
  loading: boolean
}

/**
 * Returns the effective ranking systems for the current team.
 * When the team belongs to an org that has ranking_systems defined,
 * those take precedence over the team's own ranking_systems.
 */
export function useRankingSystems(): RankingSystemsResult {
  const { team } = useAuth()
  const orgId = team?.org_id ?? null

  const { data: orgRankingSystems, isLoading: orgLoading } = useQuery<RankingSystem[]>({
    queryKey: ['org-ranking-systems', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return []
      const snap = await getDoc(doc(db, 'organizations', orgId))
      if (!snap.exists()) return []
      const org = snap.data() as Organization
      return org.ranking_systems ?? []
    },
  })

  if (orgId) {
    return {
      rankingSystems: orgRankingSystems ?? [],
      managedByOrg: (orgRankingSystems?.length ?? 0) > 0,
      orgId,
      loading: orgLoading,
    }
  }

  return {
    rankingSystems: team?.ranking_systems ?? [],
    managedByOrg: false,
    orgId: null,
    loading: false,
  }
}
