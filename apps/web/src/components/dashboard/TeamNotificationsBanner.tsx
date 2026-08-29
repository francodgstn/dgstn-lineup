'use client'

import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { useTeamNotifications } from '@/hooks/useTeamNotifications'

// ---- component --------------------------------------------------------------

export function TeamNotificationsBanner() {
  const t = useTranslations('Notifications')
  const { unread, markRead } = useTeamNotifications()

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
            onClick={() => markRead(n.id)}
            className="shrink-0 rounded-md p-1 text-blue-500 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
