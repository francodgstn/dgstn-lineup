'use client'

// The team's monthly leaderboard — a DENORMALIZED document
// (`teams/{teamId}/leaderboard/current`, written by
// `packages/functions/src/utils/leaderboard.ts`'s `updateTeamLeaderboard`),
// never a live query over `contacts`. Top 50 scored contacts only
// (`current_month_score > 0`), so a brand-new member with no score simply has
// no row — that is the correct empty state, not a failed read.
//
// READ DIRECTLY, not through `public_profile`. This is the one place
// Gamification reads OUTSIDE the public_profile mirror pattern, and it is safe
// because firestore.rules grants this EXACT subcollection to a live contact
// session:
//
//   match /leaderboard/{leaderboardId} {
//     allow read: if isTeamMember(teamId)
//                 || (request.auth != null
//                     && request.auth.token.teamId == teamId
//                     && request.auth.token.sessionExpires != null
//                     && request.auth.token.sessionExpires >= request.time.toMillis());
//   }
//
// — the identical `{contactId, teamId, sessionExpires}` custom-token claim
// Space's own sign-in mints (`isContactOfTeam`'s shape), and the SAME arm the
// mobile app has used for this exact document since before Space existed
// (`apps/mobile/src/services/firestore.ts#getTeamLeaderboard`). No rules
// change was needed for this read.
//
// This is independent of `TeamPublicProfile.gamificationEnabled` — that flag
// only gates whether the TAB is OFFERED. If it were somehow stale/absent this
// read would still succeed; it just would not be shown.

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
import { useSpaceAuth } from '../SpaceAuthProvider'
import { usePublicTeam } from '../../PublicTeamProvider'

export interface SpaceLeaderboardEntry {
  contact_id: string
  firstname: string
  lastname: string
  /** Set on a not-yet-joined (trial) contact — used to anonymise the row on
   *  screen, same as the mobile app's leaderboard. */
  acquisition_stage?: string | null
  score: number
  rank: number
  streak: number
  max_streak?: number
}

export interface SpaceLeaderboard {
  month: string
  entries: SpaceLeaderboardEntry[]
}

export function useSpaceLeaderboard() {
  const { isAuthenticated } = useSpaceAuth()
  const { teamId } = usePublicTeam()

  return useQuery<SpaceLeaderboard | null>({
    queryKey: ['space-leaderboard', teamId],
    enabled: isAuthenticated && !!teamId,
    queryFn: async () => {
      try {
        const snap = await getDoc(doc(db, 'teams', teamId, 'leaderboard', 'current'))
        if (!snap.exists()) return null
        const data = snap.data() as Record<string, unknown>
        return {
          month: (data.month as string | undefined) ?? '',
          entries: (data.entries as SpaceLeaderboardEntry[] | undefined) ?? [],
        }
      } catch (err: unknown) {
        reportPublicLoadFailure('space/leaderboard', err)
        throw err
      }
    },
  })
}
