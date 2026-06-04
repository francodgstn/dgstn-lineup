'use client'

import { useTranslations } from 'next-intl'
import { Check, ChevronRight, Zap } from 'lucide-react'
import { usePlan } from '@/hooks/usePlan'
import { PLAN_ORDER, type SaasPlan } from '@linyup/shared'
import { Link } from '@/i18n/navigation'

// ─── feature data (sourced from docs/product-strategy.md) ────────────────────

interface FeatureSection {
  heading: string
  items: string[]
}

const PLAN_SECTIONS: Record<SaasPlan, FeatureSection[]> = {
  coach: [
    {
      heading: 'Sessions & operations',
      items: [
        'Group sessions, class scheduling & public booking portal',
        'QR check-in, sign-up forms & public profile page',
        'Booking confirmations, reminders & no-show alerts',
      ],
    },
    {
      heading: '1:1 coaching',
      items: [
        'Availability templates & portal-based slot booking',
        'Calendar invites (.ics), booking & reminder emails',
        'Session notes & slot waiting list',
      ],
    },
    {
      heading: 'Monetization',
      items: [
        'Subscriptions — recurring billing (retainers, memberships)',
        'Session packages — class packs & 1:1 coaching bundles',
        'Payment gateway integration (Stripe, Payrexx)',
      ],
    },
    {
      heading: 'Client progress',
      items: [
        'Goals, progress check-ins & progress photos',
        'Client intake & assessment form',
        'Resource sharing — files, links, videos',
      ],
    },
  ],

  club: [
    {
      heading: 'Advanced billing',
      items: [
        'Payment failure handling & automated retry',
        'Subscription analytics — MRR, churn, LTV',
      ],
    },
    {
      heading: 'Client engagement',
      items: [
        'Student mobile app (iOS + Android)',
        'Gamification — points, streaks, badges, leaderboards',
        'Referral program with invite tracking & rewards',
      ],
    },
    {
      heading: 'Automation',
      items: [
        'Outreach templates (email / SMS)',
        'Automated flows — inactivity follow-ups, onboarding sequences',
      ],
    },
    {
      heading: 'Team & insights',
      items: [
        'Multiple managers + role-based access control',
        'AI-driven insights — churn risk, attendance patterns',
      ],
    },
  ],

  organization: [
    {
      heading: 'Multi-team management',
      items: [
        'Multiple teams under one organisation',
        'Central admin console + unified data view',
      ],
    },
    {
      heading: 'Coordination & platform',
      items: [
        'Cross-team events & messaging',
        'API access + org-level roles & permissions',
      ],
    },
  ],
}

// ─── labels / colours ─────────────────────────────────────────────────────────

const PLAN_LABELS: Record<SaasPlan, string> = {
  coach:        'Coach',
  club:         'Club',
  organization: 'Organization',
}

const PLAN_TAGLINES: Record<SaasPlan, string> = {
  coach:        'Solo operators & personal trainers',
  club:         'Growing gyms & clubs',
  organization: 'Multi-location & franchises',
}

const PLAN_INCLUDES: Partial<Record<SaasPlan, string>> = {
  club:         'Everything in Coach, plus:',
  organization: 'Everything in Club, plus:',
}

const PLAN_COLOR: Record<SaasPlan, {
  ring: string
  badge: string
  check: string
  heading: string
  includes: string
}> = {
  coach: {
    ring:     'border-sky-300 dark:border-sky-700',
    badge:    'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    check:    'text-sky-500',
    heading:  'text-sky-700 dark:text-sky-400',
    includes: 'bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/20 dark:border-sky-800 dark:text-sky-300',
  },
  club: {
    ring:     'border-amber-300 dark:border-amber-700',
    badge:    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    check:    'text-amber-500',
    heading:  'text-amber-700 dark:text-amber-400',
    includes: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300',
  },
  organization: {
    ring:     'border-violet-300 dark:border-violet-700',
    badge:    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    check:    'text-violet-500',
    heading:  'text-violet-700 dark:text-violet-400',
    includes: 'bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-900/20 dark:border-violet-800 dark:text-violet-300',
  },
}

// ─── plan card ────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrent, currentPlan }: { plan: SaasPlan; isCurrent: boolean; currentPlan: SaasPlan | null }) {
  const t = useTranslations('Upgrade')
  const colors = PLAN_COLOR[plan]
  const sections = PLAN_SECTIONS[plan]
  const includes = PLAN_INCLUDES[plan]
  const isUpgrade = !isCurrent && PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(currentPlan ?? 'coach')

  return (
    <div className={`relative flex flex-col rounded-xl border-2 p-6 ${
      isCurrent ? `${colors.ring} shadow-md` : 'border-border'
    }`}>
      {isCurrent && (
        <span className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${colors.badge}`}>
          {t('currentPlan')}
        </span>
      )}

      {/* Plan header */}
      <div className="mb-4">
        <p className="text-xl font-bold">{PLAN_LABELS[plan]}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{PLAN_TAGLINES[plan]}</p>
      </div>

      {/* "Everything in X, plus" banner */}
      {includes && (
        <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium mb-4 ${colors.includes}`}>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          {includes}
        </div>
      )}

      {/* Feature sections */}
      <div className="flex-1 space-y-5">
        {sections.map((section) => (
          <div key={section.heading}>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${colors.heading}`}>
              {section.heading}
            </p>
            <ul className="space-y-1.5">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${colors.check}`} />
                  <span className={isCurrent ? 'text-foreground' : 'text-muted-foreground'}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-6">
        {isCurrent ? (
          <div className="w-full text-center text-sm text-muted-foreground py-2 rounded-lg border border-dashed">
            {t('currentPlanCta')}
          </div>
        ) : isUpgrade ? (
          <Link
            href="/billing"
            className={`flex items-center justify-center gap-1.5 w-full text-sm font-semibold py-2 px-4 rounded-lg ${colors.badge} hover:opacity-90 transition-opacity`}
          >
            {t('upgradeCtaButton')}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <div className="w-full text-center text-sm text-muted-foreground py-2 rounded-lg border border-dashed">
            {t('downgradeCta')}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function UpgradePage() {
  const t = useTranslations('Upgrade')
  const { plan } = usePlan()

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Zap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">
        {PLAN_ORDER.map((p) => (
          <PlanCard key={p} plan={p} isCurrent={plan === p} currentPlan={plan} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t('contactNote')}
      </p>
    </div>
  )
}
