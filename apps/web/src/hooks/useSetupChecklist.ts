import { useQuery } from '@tanstack/react-query'
import { collection, query, where, limit, getDocs, orderBy, Timestamp } from 'firebase/firestore'
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
  | 'bioLink'
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

// UX-2 interim: the "sessions" step above is existence-only (any session at
// all), so it can report done for a class nobody can book. This answers the
// real question — is there at least one FUTURE session with online booking
// on — without changing what marks the step complete (that's the full fix).
async function hasBookableFutureSession(teamId: string, nowTs: Timestamp): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, SESSIONS_COLLECTION),
      where('allowBooking', '==', true),
      where('teamId', '==', teamId),
      where('start', '>=', nowTs),
      limit(1)
    )
  )
  return !snap.empty
}

// A session to deep-link the warning to, when nothing is bookable: the
// earliest future session regardless of its allowBooking value.
async function firstUpcomingSessionId(teamId: string, nowTs: Timestamp): Promise<string | null> {
  const snap = await getDocs(
    query(
      collection(db, SESSIONS_COLLECTION),
      where('teamId', '==', teamId),
      where('start', '>=', nowTs),
      orderBy('start', 'asc'),
      limit(1)
    )
  )
  return snap.empty ? null : snap.docs[0].id
}

/**
 * Data-driven setup checklist. Each step auto-completes from real data, so the
 * checklist reflects the team's actual readiness rather than a manual tick.
 * Bio-link counts as done once a public_profile has been published; ranks read
 * straight off the team document and are optional.
 */
export function useSetupChecklist(teamId: string | null, team: Team | null) {
  const ranksDone = (team?.ranking_systems?.length ?? 0) > 0

  const queryResult = useQuery({
    queryKey: ['setup-checklist', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<
      Record<Exclude<SetupStepKey, 'ranks'>, boolean> & {
        sessionsBookable: boolean
        nextUnbookableSessionId: string | null
      }
    > => {
      const id = teamId as string
      const [activities, sessions, contacts, subscriptions, bioLink] = await Promise.all([
        teamCollectionHasAny(ACTIVITIES_COLLECTION, id),
        teamCollectionHasAny(SESSIONS_COLLECTION, id),
        teamCollectionHasAny(CONTACTS_COLLECTION, id),
        subcollectionHasAny(id, SUBSCRIPTION_TYPES_SUBCOLLECTION),
        // Bio-link is "live" once its public_profile doc exists.
        subcollectionHasAny(id, 'public_profile'),
      ])

      // Only probe further once a session exists at all — the step's own
      // "not done" state already covers the zero-sessions case.
      let sessionsBookable = false
      let nextUnbookableSessionId: string | null = null
      if (sessions) {
        const nowTs = Timestamp.now()
        sessionsBookable = await hasBookableFutureSession(id, nowTs)
        if (!sessionsBookable) {
          nextUnbookableSessionId = await firstUpcomingSessionId(id, nowTs)
        }
      }

      return { activities, sessions, contacts, subscriptions, bioLink, sessionsBookable, nextUnbookableSessionId }
    },
  })

  const d = queryResult.data
  // UX-27: every href must land on the surface that can COMPLETE the step, not
  // merely on one that reports it. `subscriptions` and `ranks` were landing on
  // reporting surfaces:
  //   • subscriptions → `/subscriptions` is the member roster ("who holds
  //     what"), derived from contacts. On a new team it renders an empty table
  //     and has no create control at all. Subscription TYPES — the thing the
  //     step's own done-check reads (teams/{id}/subscription_types) — are
  //     created by SubscriptionsPanel's "Add subscription type", which lives on
  //     the Plans hub's first tab.
  //   • ranks → `/settings/team` has no default tab, so it opens on General;
  //     the ranking-system manager is behind `?tab=ranking` (same deep link the
  //     settings rail uses, see lib/settings-nav.ts).
  const steps: SetupStep[] = [
    { key: 'activities', href: '/offer/activities', done: !!d?.activities },
    { key: 'sessions', href: '/schedule', done: !!d?.sessions },
    { key: 'subscriptions', href: '/offer/plans?tab=subscriptions', done: !!d?.subscriptions },
    { key: 'bioLink', href: '/team/bio-link', done: !!d?.bioLink },
    { key: 'contacts', href: '/contacts', done: !!d?.contacts },
    { key: 'ranks', href: '/settings/team?tab=ranking', done: ranksDone, optional: true },
  ]

  const required = steps.filter((s) => !s.optional)
  const requiredDone = required.filter((s) => s.done).length
  const allRequiredDone = requiredDone === required.length

  // UX-2 interim: only meaningful once the sessions step itself is "done" —
  // that is exactly the state that can lie (existence-only completion).
  const sessionsStepDone = !!d?.sessions
  const sessionsNotActuallyBookable = sessionsStepDone && d?.sessionsBookable === false

  return {
    steps,
    requiredDone,
    requiredTotal: required.length,
    allRequiredDone,
    sessionsNotActuallyBookable,
    nextUnbookableSessionId: d?.nextUnbookableSessionId ?? null,
    loading: queryResult.isLoading,
  }
}
