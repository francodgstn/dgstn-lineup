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
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode, type DemoAccount } from '@/lib/demo'
import { Logo } from '@/components/Logo'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

// Muted icon per demo team — differentiation comes from the icon, not from color.
const TEAM_ICONS: Record<string, LucideIcon> = {
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

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-12">
      <div className="mx-auto w-full max-w-3xl space-y-10">
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

        {/* Type-only picker: a lead picks the business type closest to theirs and
            jumps straight in — no studio name or blurb to wade through. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEMO_ACCOUNTS.map((account) => {
            const Icon = TEAM_ICONS[account.key] ?? Target
            const isEntering = entering === account.key
            return (
              <Card key={account.key} className="transition-shadow hover:shadow-md">
                <CardContent className="p-2">
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-3 px-3 py-3"
                    onClick={() => enterAs(account)}
                    disabled={entering !== null}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      {isEntering ? (
                        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="flex-1 truncate text-left font-medium">
                      {isEntering ? t('entering') : account.label}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>

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
