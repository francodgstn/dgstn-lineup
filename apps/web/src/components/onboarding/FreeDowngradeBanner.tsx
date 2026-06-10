'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Zap, X } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'

/**
 * Dismissible notice shown after a trial lapses and the team lands on the
 * Free plan (replaces the old full-screen TrialExpiredWall). Driven by
 * team.downgraded_from_trial_at; disappears for good on upgrade (plan check)
 * or on dismissal, which is stored locally per team — it's a notice, not
 * state worth a Firestore write.
 */
export function FreeDowngradeBanner() {
  const t = useTranslations('FreePlan')
  const { team } = useAuth()
  const { plan } = usePlan()
  const [dismissed, setDismissed] = useState(true)

  const storageKey = team ? `free-downgrade-dismissed:${team.id}` : null

  useEffect(() => {
    if (!storageKey) return
    setDismissed(localStorage.getItem(storageKey) === 'true')
  }, [storageKey])

  if (!team || plan !== 'free' || !team.downgraded_from_trial_at || dismissed) {
    return null
  }

  const dismiss = () => {
    if (storageKey) localStorage.setItem(storageKey, 'true')
    setDismissed(true)
  }

  return (
    <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/50 shrink-0 mt-0.5">
          <Zap className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-sky-900 dark:text-sky-200">{t('downgradeBannerTitle')}</p>
          <p className="text-sm text-sky-800/90 dark:text-sky-300/90 mt-0.5">{t('downgradeBannerBody')}</p>
          <Link
            href="/billing"
            className="inline-block mt-2 text-sm font-semibold text-sky-700 dark:text-sky-300 hover:underline"
          >
            {t('downgradeBannerCta')} →
          </Link>
        </div>
        <button
          onClick={dismiss}
          aria-label={t('dismiss')}
          className="p-1 rounded-md text-sky-700/70 dark:text-sky-300/70 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
