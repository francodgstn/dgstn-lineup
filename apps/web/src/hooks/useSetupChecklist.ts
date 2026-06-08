import { useQuery } from '@tanstack/react-query'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  ACTIVITIES_COLLECTION,
  SESSIONS_COLLECTION,
  CONTACTS_COLLECTION,
  TEAMS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
} from '@linyup/shared'
import type { Team } from '@linyup/shared'

export type SetupStepKey =
  | 'activities'
  | 'sessions'
  | 'subscriptions'
  | 'portal'
  | 'contacts'
  | 'ranks'

export interface SetupStep {
  key: SetupStepKey
  done: boolean
  href: string
  optional?: boolean
}

// Cheap existence check: read at most one doc from a top-level collection
// filtered by teamId.
async function teamCollectionHasAny(coll: string, teamId: string): Promise<boolean> {
  const snap = await getDocs(query(collection(db, coll), where('teamId', '==', teamId), limit(1)))
  return !snap.empty
}

async function subcollectionHasAny(teamId: string, sub: string): Promise<boolean> {
  const snap = await getDocs(query(collection(db, TEAMS_COLLECTION, teamId, sub), limit(1)))
  return !snap.empty
}

/**
 * Data-driven setup checklist. Each step auto-completes from real data, so the
 * checklist reflects the team's actual readiness rather than a manual tick.
 * Portal counts as done once a public_profile has been published; ranks read
 * straight off the team document and are optional.
 */
export function useSetupChecklist(teamId: string | null, team: Team | null) {
  const ranksDone = (team?.ranking_systems?.length ?? 0) > 0

  const queryResult = useQuery({
    queryKey: ['setup-checklist', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Record<Exclude<SetupStepKey, 'ranks'>, boolean>> => {
      const id = teamId as string
      const [activities, sessions, contacts, subscriptions, portal] = await Promise.all([
        teamCollectionHasAny(ACTIVITIES_COLLECTION, id),
        teamCollectionHasAny(SESSIONS_COLLECTION, id),
        teamCollectionHasAny(CONTACTS_COLLECTION, id),
        subcollectionHasAny(id, SUBSCRIPTION_TYPES_SUBCOLLECTION),
        // Portal is "live" once its public_profile doc exists.
        subcollectionHasAny(id, 'public_profile'),
      ])
      return { activities, sessions, contacts, subscriptions, portal }
    },
  })

  const d = queryResult.data
  const steps: SetupStep[] = [
    { key: 'activities', href: '/activities', done: !!d?.activities },
    { key: 'sessions', href: '/schedule', done: !!d?.sessions },
    { key: 'subscriptions', href: '/subscriptions', done: !!d?.subscriptions },
    { key: 'portal', href: '/team/portal', done: !!d?.portal },
    { key: 'contacts', href: '/contacts', done: !!d?.contacts },
    { key: 'ranks', href: '/team/settings', done: ranksDone, optional: true },
  ]

  const required = steps.filter((s) => !s.optional)
  const requiredDone = required.filter((s) => s.done).length
  const allRequiredDone = requiredDone === required.length

  return {
    steps,
    requiredDone,
    requiredTotal: required.length,
    allRequiredDone,
    loading: queryResult.isLoading,
  }
}
