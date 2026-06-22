'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  orderBy,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { TEAMS_COLLECTION, NOTIFICATIONS_SUBCOLLECTION } from '@linyup/shared'

// ---- types ------------------------------------------------------------------

interface TeamNotification {
  id: string
  type: string
  title: string
  body: string
  status: 'unread' | 'read'
  link?: string | null
  created_at?: { seconds: number } | string | null
  // Additional fields for specific notification types
  orgId?: string
  orgName?: string
}

// ---- component --------------------------------------------------------------

export function TeamNotificationsBanner() {
  const t = useTranslations('Notifications')
  const { currentTeamId } = useAuth()
  const qc = useQueryClient()

  const { data: notifications } = useQuery<TeamNotification[]>({
    queryKey: ['team-notifications', currentTeamId],
    enabled: !!currentTeamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, currentTeamId!, NOTIFICATIONS_SUBCOLLECTION),
          orderBy('created_at', 'desc')
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TeamNotification))
    },
  })

  const unread = (notifications ?? []).filter((n) => n.status === 'unread')

  async function dismiss(notificationId: string) {
    if (!currentTeamId) return
    const ref = doc(
      db,
      TEAMS_COLLECTION,
      currentTeamId,
      NOTIFICATIONS_SUBCOLLECTION,
      notificationId
    )
    await updateDoc(ref, { status: 'read' })
    qc.invalidateQueries({ queryKey: ['team-notifications', currentTeamId] })
  }

  if (unread.length === 0) return null

  return (
    <div className="space-y-2">
      {unread.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/40"
          role="status"
          aria-live="polite"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">{n.title}</p>
            <p className="mt-0.5 text-sm text-blue-700 dark:text-blue-300">{n.body}</p>
          </div>
          <button
            type="button"
            aria-label={t('dismiss')}
            onClick={() => dismiss(n.id)}
            className="shrink-0 rounded-md p-1 text-blue-500 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
