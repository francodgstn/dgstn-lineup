'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { Lock } from 'lucide-react'
import { TRIAL_PURGE_DAYS } from '@linyup/shared'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'

/**
 * Full-screen wall shown when a team's trial has lapsed (usePlan().isExpired).
 * The app is blocked; only reactivation (→ /billing) and sign-out are reachable.
 * Data is preserved for the reactivation window (TRIAL_PURGE_DAYS) — paying
 * lifts the wall automatically (Stripe webhook flips status back to active).
 */
export function TrialExpiredWall() {
  const t = useTranslations('TrialWall')
  const router = useRouter()

  async function handleSignOut() {
    const { signOut } = await import('@/lib/auth')
    await signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md text-center space-y-5">
        <div className="flex justify-center"><Logo size={32} /></div>
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-6 w-6" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('body')}</p>
        </div>
        <div className="flex flex-col items-center gap-3 pt-1">
          <Button className="w-full max-w-xs" onClick={() => router.push('/billing' as Route)}>
            {t('cta')}
          </Button>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            {t('signOut')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground/60 pt-2">{t('dataNote', { days: TRIAL_PURGE_DAYS })}</p>
      </div>
    </div>
  )
}
