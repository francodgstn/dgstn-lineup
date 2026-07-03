'use client'

import { useState, type ElementType } from 'react'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import {
  Dumbbell,
  Target,
  Flower2,
  PersonStanding,
  Music,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { BoxingGlove, TennisRacket } from '@/components/icons/SportIcons'
import { signIn } from '@/lib/auth'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode, type DemoAccount } from '@/lib/demo'
import { Logo } from '@/components/Logo'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

// Icon per demo team — differentiation comes from the icon, not from color.
const TEAM_ICONS: Record<string, ElementType> = {
  grappling: BoxingGlove,
  crossfit: Dumbbell,
  tennis: TennisRacket,
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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-muted/40 via-background to-background px-4 py-12">
      {/* Animated ambient light */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="try-glow try-glow-1 absolute left-1/2 top-[-8rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-primary/25 blur-[130px]" />
        <div className="try-glow try-glow-2 absolute right-[-6rem] top-1/3 h-64 w-64 rounded-full bg-sky-400/20 blur-[110px]" />
      </div>
      <style>{`
        @keyframes tryGlowPulse {
          0%,100% { opacity:.35; transform:translate(-50%,0) scale(1); }
          50%     { opacity:.6;  transform:translate(-50%,-1.5rem) scale(1.08); }
        }
        @keyframes tryGlowFloat {
          0%,100% { opacity:.25; transform:translateY(0); }
          50%     { opacity:.45; transform:translateY(1.5rem); }
        }
        .try-glow-1 { animation: tryGlowPulse 9s ease-in-out infinite; }
        .try-glow-2 { animation: tryGlowFloat 11s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .try-glow { animation: none !important; } }
      `}</style>

      {/* Locale switcher — small, top-right */}
      <div className="absolute right-4 top-4 z-20">
        <LocaleSwitcher />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-3xl space-y-10">
        <div className="space-y-3 text-center">
          <div className="flex justify-center"><Logo size={32} /></div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
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
              <Card
                key={account.key}
                className="border-border/60 bg-card/70 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
              >
                <CardContent className="p-2">
                  <Button
                    variant="ghost"
                    className="group h-auto w-full justify-start gap-3 px-3 py-3"
                    onClick={() => enterAs(account)}
                    disabled={entering !== null}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                      {isEntering ? (
                        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Icon className="size-5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="flex-1 truncate text-left font-medium">
                      {isEntering ? t('entering') : account.label}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
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
