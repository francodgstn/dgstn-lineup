'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import {
  TEAMS_COLLECTION,
  NOTIFICATIONS_SUBCOLLECTION,
  type TeamNotification,
} from '@linyup/shared'

/**
 * THE ONE READER OF `teams/{teamId}/notifications`, and the one mark-read
 * writer — shared by the dashboard banner and the sidebar bell so there is one
 * React Query cache entry and one "what does dismiss do" answer, not two
 * independent copies quietly drifting (the dashboard banner used to declare its
 * own local `TeamNotification` interface for exactly this collection).
 *
 * GATED ON ROLE, NOT JUST ON THE RULES. `firestore.rules` already restricts
 * read + update to manager/owner (see `teamNotification.ts`'s header) — but a
 * DISABLED query is what keeps a coach or viewer from ever issuing the read at
 * all, rather than issuing one and quietly eating a permission-denied error on
 * every mount. `canRead` is exposed so a caller (the bell) can render nothing
 * rather than a button that opens onto a query that will never resolve.
 *
 * Dismissal is TEAM-WIDE: `status` lives on the document, not per user, so one
 * manager clearing an item clears it for the whole studio. That is the model
 * the rules already encode; this hook does not add a second one.
 */
export const TEAM_NOTIFICATIONS_KEY = 'team-notifications'

export function teamNotificationsKey(teamId: string | null) {
  return [TEAM_NOTIFICATIONS_KEY, teamId] as const
}

export function useTeamNotifications() {
  const { currentTeamId, teamRole } = useAuth()
  const qc = useQueryClient()
  const canRead = teamRole === 'owner' || teamRole === 'manager'

  const notificationsQuery = useQuery<TeamNotification[]>({
    queryKey: teamNotificationsKey(currentTeamId),
    enabled: !!currentTeamId && canRead,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, currentTeamId!, NOTIFICATIONS_SUBCOLLECTION),
          orderBy('created_at', 'desc')
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamNotification)
    },
  })

  const notifications = notificationsQuery.data ?? []
  const unread = notifications.filter((n) => n.status === 'unread')

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      if (!currentTeamId) return
      const ref = doc(
        db,
        TEAMS_COLLECTION,
        currentTeamId,
        NOTIFICATIONS_SUBCOLLECTION,
        notificationId
      )
      await updateDoc(ref, { status: 'read', read_at: serverTimestamp() })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: teamNotificationsKey(currentTeamId) }),
  })

  return {
    /** Whether this account is even allowed to see the collection. */
    canRead,
    notifications,
    unread,
    isLoading: notificationsQuery.isLoading,
    markRead: (notificationId: string) => markReadMutation.mutate(notificationId),
  }
}
