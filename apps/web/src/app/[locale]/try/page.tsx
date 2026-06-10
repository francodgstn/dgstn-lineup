'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import {
  Swords,
  Dumbbell,
  Target,
  Flower2,
  PersonStanding,
  Music,
  ArrowRight,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { signIn } from '@/lib/auth'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode, type DemoAccount, type DemoSector } from '@/lib/demo'
import { Logo } from '@/components/Logo'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

// Muted icon per club — differentiation comes from the icon, not from color.
const CLUB_ICONS: Record<string, LucideIcon> = {
  grappling: Swords,
  crossfit: Dumbbell,
  tennis: Target,
  yoga: Flower2,
  pilates: PersonStanding,
  dance: Music,
}

export default function TryPage() {
  const t = useTranslations('Try')
  const router = useRouter()
  const [entering, setEntering] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Demo playground is sandbox/local only — hidden everywhere else.
  if (!isDemoMode()) notFound()

  async function enterAs(account: DemoAccount) {
    setError(null)
    setEntering(account.key)
    try {
      await signIn(account.email, DEMO_PASSWORD)
      router.push('/dashboard')
    } catch {
      setError(t('error', { team: account.teamName }))
      setEntering(null)
    }
  }

  const sectors: DemoSector[] = ['sport', 'wellness']

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-12">
      <div className="mx-auto w-full max-w-4xl space-y-10">
        <div className="space-y-3 text-center">
          <div className="flex justify-center"><Logo size={32} /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {error && (
          <div className="mx-auto max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-center text-sm text-destructive">
            {error}
          </div>
        )}

        {sectors.map((sector) => (
          <section key={sector} className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {sector === 'sport' ? t('sportLabel') : t('wellnessLabel')}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DEMO_ACCOUNTS.filter((a) => a.sector === sector).map((account) => {
                const Icon = CLUB_ICONS[account.key] ?? Target
                const isEntering = entering === account.key
                return (
                  <Card key={account.key} className="transition-shadow hover:shadow-md">
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold leading-tight">{account.teamName}</h3>
                          <p className="text-xs text-muted-foreground">{account.sportType}</p>
                        </div>
                      </div>
                      <p className="flex-1 text-sm text-muted-foreground">{account.blurb}</p>
                      <Button
                        variant="outline"
                        className="mt-1 w-full"
                        onClick={() => enterAs(account)}
                        disabled={entering !== null}
                      >
                        {isEntering ? (
                          <>
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            {t('entering')}
                          </>
                        ) : (
                          <>
                            {t('enterDemo')}
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        ))}

        <p className="text-center text-xs text-muted-foreground">
          {t('ownAccount')}{' '}
          <Link href="/signup" className="text-primary hover:underline">{t('signUp')}</Link>
          {' · '}
          <Link href="/login" className="text-primary hover:underline">{t('logIn')}</Link>
        </p>
      </div>
    </div>
  )
}
