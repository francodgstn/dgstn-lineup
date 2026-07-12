'use client'

// How-to — high-level product orientation for studio managers:
//   1. "How Linyup fits together" — the core building blocks and how a member
//      moves through them (discover → lead → attend → join → retain).
//   2. "Onboarding your studio" — an ordered, linked checklist to go live.
// Reachable from the sidebar's General group. Deliberately conceptual (not a
// feature-by-feature manual) — it's the map, not the territory.
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import { Card, CardContent } from '@/components/ui/card'
import {
  Compass,
  Users,
  Tag,
  Calendar,
  ClipboardList,
  IdCard,
  Globe,
  Workflow,
  Wallet,
  ArrowRight,
  ChevronRight,
} from 'lucide-react'

// Core building blocks — one card each, in roughly the order a studio meets them.
const BLOCKS = [
  { key: 'contacts', icon: Users },
  { key: 'activities', icon: Tag },
  { key: 'sessions', icon: Calendar },
  { key: 'bookings', icon: ClipboardList },
  { key: 'plans', icon: IdCard },
  { key: 'surfaces', icon: Globe },
  { key: 'automations', icon: Workflow },
  { key: 'payments', icon: Wallet },
] as const

// The member journey — how a person flows from discovery to retention.
const JOURNEY = ['discover', 'lead', 'attend', 'join', 'retain'] as const

// Onboarding checklist — ordered, each linking to where the work happens.
const STEPS = [
  { key: 'profile', href: '/settings/team' },
  { key: 'offer', href: '/offer/activities' },
  { key: 'plans', href: '/offer/plans' },
  { key: 'schedule', href: '/schedule' },
  { key: 'surfaces', href: '/public-page' },
  { key: 'contacts', href: '/contacts' },
  { key: 'payments', href: '/settings/team?tab=payments' },
  { key: 'automate', href: '/automations' },
] as const

export default function HowToPage() {
  const t = useTranslations('HowTo')

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      {/* Header */}
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Compass className="h-6 w-6 text-primary" />
          {t('title')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {/* ── How Linyup fits together ── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{t('fitTitle')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('fitIntro')}</p>
        </div>

        {/* Building blocks */}
        <div className="grid gap-3 sm:grid-cols-2">
          {BLOCKS.map(({ key, icon: Icon }) => (
            <Card key={key} size="sm">
              <CardContent className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(`blocks.${key}.name` as 'blocks.contacts.name')}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t(`blocks.${key}.desc` as 'blocks.contacts.desc')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* The member journey */}
        <div className="rounded-xl border bg-gradient-to-br from-primary/[0.06] to-transparent p-5">
          <p className="text-sm font-medium">{t('journeyTitle')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {JOURNEY.map((stage, i) => (
              <div key={stage} className="flex items-center gap-1.5">
                <span className="rounded-full border border-primary/20 bg-background px-3 py-1 text-xs font-medium">
                  {t(`journey.${stage}` as 'journey.discover')}
                </span>
                {i < JOURNEY.length - 1 && (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Onboarding your studio ── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{t('onboardTitle')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('onboardIntro')}</p>
        </div>

        <ol className="space-y-2.5">
          {STEPS.map(({ key, href }, i) => (
            <li key={key}>
              <Link
                href={href as Route}
                className="group flex items-start gap-3.5 rounded-xl border p-3.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t(`steps.${key}.title` as 'steps.profile.title')}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t(`steps.${key}.desc` as 'steps.profile.desc')}
                  </p>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ol>

        <p className="text-xs text-muted-foreground">{t('moreSoon')}</p>
      </section>
    </div>
  )
}
