'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import { signIn } from '@/lib/auth'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode, type DemoAccount, type DemoSector } from '@/lib/demo'
import { Logo } from '@/components/Logo'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

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
              {DEMO_ACCOUNTS.filter((a) => a.sector === sector).map((account) => (
                <Card key={account.key} className="flex flex-col overflow-hidden">
                  <span className="h-1.5 w-full" style={{ backgroundColor: account.accent }} />
                  <CardContent className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold leading-tight">{account.teamName}</h3>
                      <Badge variant="secondary" className="shrink-0">{account.sportType}</Badge>
                    </div>
                    <p className="flex-1 text-sm text-muted-foreground">{account.blurb}</p>
                    <button
                      type="button"
                      onClick={() => enterAs(account)}
                      disabled={entering !== null}
                      className="mt-1 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      style={{ backgroundColor: account.accent }}
                    >
                      {entering === account.key ? t('entering') : t('enterAs', { team: account.teamName })}
                    </button>
                  </CardContent>
                </Card>
              ))}
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
