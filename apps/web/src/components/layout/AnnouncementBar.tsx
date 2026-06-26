'use client'

// Platform announcement strip — an OPS-controlled top bar (set from the admin
// console) read from the world-readable app_settings/public doc. Used e.g. on the
// sandbox env to flag "this is a demo, data resets". Config-driven: shows whenever
// `announcement_enabled` is set in the current project, so it scopes to whichever
// environment OPS turned it on in. No auth needed — the doc is world-readable.

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { Megaphone } from 'lucide-react'
import { db } from '@/lib/firebase'
import {
  APP_SETTINGS_COLLECTION,
  PUBLIC_SETTINGS_DOC,
  type AnnouncementStyle,
  type PlatformAnnouncement,
} from '@linyup/shared'

const STYLES: Record<AnnouncementStyle, string> = {
  info: 'bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-100',
  warning: 'bg-amber-100 text-amber-950 dark:bg-amber-950/70 dark:text-amber-100',
  success: 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950/70 dark:text-emerald-100',
}

export function AnnouncementBar() {
  const { data } = useQuery<PlatformAnnouncement | null>({
    queryKey: ['platform-announcement'],
    staleTime: 60_000,
    queryFn: async () => {
      const snap = await getDoc(doc(db, APP_SETTINGS_COLLECTION, PUBLIC_SETTINGS_DOC))
      return snap.exists() ? (snap.data() as PlatformAnnouncement) : null
    },
  })

  const text = data?.announcement_text?.trim()
  if (!data?.announcement_enabled || !text) return null

  const style = STYLES[data.announcement_style ?? 'info'] ?? STYLES.info

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-medium ${style}`}
    >
      <Megaphone className="h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  )
}
