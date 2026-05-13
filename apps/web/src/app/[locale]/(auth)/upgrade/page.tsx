'use client'

import { useTranslations } from 'next-intl'
import { Check, Zap } from 'lucide-react'
import { usePlan } from '@/hooks/usePlan'
import { PLAN_ORDER, type SaasPlan } from '@lineup/shared'

const PLAN_FEATURES: Record<SaasPlan, string[]> = {
  coach: [
    'Contacts & member profiles',
    'Sessions & scheduling',
    'Activities management',
    'Portal bookings',
    'QR code check-in',
    'Public profile page',
    'Trial sign-up forms',
    'Basic dashboard',
    'Basic alerts',
  ],
  club: [
    'Everything in Coach',
    'Events & workshops',
    'Coaching management',
    'Gamification & leaderboards',
    'Subscription types & tracking',
    'Payment tracking',
    'Student mobile app',
    'Outreach templates',
    'Automation flows',
    'Advanced dashboard & insights',
    'Multiple managers',
    'Referral program',
  ],
  organization: [
    'Everything in Club',
    'Multi-team management',
    'Central admin console',
    'Cross-team events',
    'Cross-team messaging',
    'Unified data & reporting',
    'API access',
    'Advanced permissions',
  ],
}

const PLAN_LABELS: Record<SaasPlan, string> = {
  coach: 'Coach',
  club: 'Club',
  organization: 'Organization',
}

const PLAN_COLOR: Record<SaasPlan, { ring: string; badge: string; check: string }> = {
  coach:        { ring: 'border-sky-200 dark:border-sky-800',    badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',       check: 'text-sky-500' },
  club:         { ring: 'border-amber-300 dark:border-amber-700', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', check: 'text-amber-500' },
  organization: { ring: 'border-violet-200 dark:border-violet-800', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', check: 'text-violet-500' },
}

function PlanCard({ plan, isCurrent }: { plan: SaasPlan; isCurrent: boolean }) {
  const t = useTranslations('Upgrade')
  const colors = PLAN_COLOR[plan]
  const features = PLAN_FEATURES[plan]

  return (
    <div className={`relative flex flex-col rounded-xl border-2 p-6 ${
      isCurrent ? `${colors.ring} shadow-md` : 'border-border'
    }`}>
      {isCurrent && (
        <span className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${colors.badge}`}>
          {t('currentPlan')}
        </span>
      )}

      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg font-bold">{PLAN_LABELS[plan]}</span>
      </div>

      <ul className="mt-4 space-y-2 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check className={`h-4 w-4 mt-0.5 shrink-0 ${colors.check}`} />
            <span className={isCurrent ? 'text-foreground' : 'text-muted-foreground'}>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {isCurrent ? (
          <div className="w-full text-center text-sm text-muted-foreground py-2 rounded-lg border border-dashed">
            {t('currentPlanCta')}
          </div>
        ) : (
          <div className="w-full text-center text-sm text-muted-foreground py-2 rounded-lg border border-dashed">
            {t('upgradeCta')}
          </div>
        )}
      </div>
    </div>
  )
}

export default function UpgradePage() {
  const t = useTranslations('Upgrade')
  const { plan } = usePlan()

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Zap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PLAN_ORDER.map((p) => (
          <PlanCard key={p} plan={p} isCurrent={plan === p} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t('contactNote')}
      </p>
    </div>
  )
}
