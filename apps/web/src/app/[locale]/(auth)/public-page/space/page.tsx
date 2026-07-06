'use client'

// Space settings — the members' portal home under Public pages. Lightweight
// today (the portal's only module is the course library, managed under Offer),
// but it gives the surface a home: live status, the theme it inherits from the
// bio-link, and a content summary. The seam for future portal modules.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { COURSES_COLLECTION, TEAMS_COLLECTION } from '@linyup/shared'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ExternalLink, GraduationCap, Palette, ChevronRight, UserCheck } from 'lucide-react'

export default function SpaceSettingsPage() {
  const t = useTranslations('SpaceSettings')
  const { currentTeamId, team, teamRole } = useAuth()
  const { publicUrl, flags } = usePublicSurfaces()

  // "Complete your signup" reminder — shown in the Space to contacts who haven't
  // finished the full registration. Stored at settings.space.signup_nudge (absent ⇒
  // on) and mirrored to the public profile by syncTeamPublicProfile. Team-doc
  // writes are owner-only per firestore.rules.
  const canEdit = teamRole === 'owner'
  const nudgeStored =
    (team as { settings?: { space?: { signup_nudge?: boolean } } } | null)?.settings?.space
      ?.signup_nudge !== false
  const [nudge, setNudge] = useState(nudgeStored)
  const [savingNudge, setSavingNudge] = useState(false)
  useEffect(() => setNudge(nudgeStored), [nudgeStored])

  async function toggleNudge(value: boolean) {
    if (!currentTeamId || !canEdit) return
    setNudge(value) // optimistic
    setSavingNudge(true)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        'settings.space.signup_nudge': value,
      })
    } catch {
      setNudge(!value)
    } finally {
      setSavingNudge(false)
    }
  }

  // Count published courses client-side (single-equality query — no composite
  // index needed) for the content summary.
  const { data: publishedCount = 0 } = useQuery({
    queryKey: ['space-settings', 'published-courses', currentTeamId],
    enabled: !!currentTeamId && flags.coursesActive,
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, COURSES_COLLECTION), where('teamId', '==', currentTeamId)))
      return snap.docs.filter((d) => d.data().status === 'published').length
    },
  })

  const previewUrl = publicUrl('space')

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('preview')}
            </a>
          ) : undefined
        }
      />

      {/* Status */}
      <Card className="flex items-start gap-3 p-4">
        <span
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
            flags.spaceLive ? 'bg-emerald-500' : 'bg-muted-foreground/40'
          }`}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('statusTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {flags.spaceLive ? t('statusLiveHint') : t('statusSetupHint')}
          </p>
        </div>
      </Card>

      {/* Content */}
      <Card className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <GraduationCap className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('contentTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('coursesPublished', { count: publishedCount })}</p>
          </div>
        </div>
        <Link
          href={'/offer/online-courses' as Route}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          {t('manageContent')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </Card>

      {/* Complete-signup reminder */}
      <Card className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <UserCheck className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('signupNudgeTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('signupNudgeHint')}</p>
          </div>
        </div>
        <Switch checked={nudge} disabled={!canEdit || savingNudge} onCheckedChange={toggleNudge} />
      </Card>

      {/* Appearance */}
      <Card className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Palette className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('themeTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('themeHint')}</p>
          </div>
        </div>
        <Link
          href={'/team/bio-link' as Route}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          {t('editTheme')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </Card>
    </div>
  )
}
