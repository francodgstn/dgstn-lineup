'use client'

// Part 3 of the Pricing section: "Try it: price a visitor" — a small live
// simulator powered by the REAL shared resolver (@linyup/shared's
// resolvePaymentOptions, via the same @/lib/pricingSurface helpers the real
// Offer → Pricing page uses), against a tiny FICTIONAL demo catalogue defined
// below. No Firestore reads — everything here is hardcoded so the page never
// depends on a signed-in team's data.
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { formatCurrency } from '@/lib/format'
import { GUEST_SNAPSHOT, type Activity, type ContactPaymentSnapshot, type Course } from '@linyup/shared'
import { resolveClassCell, resolveAppointmentCells, resolveCourseCell, type PriceCell } from '@/lib/pricingSurface'

// ─── the fictional demo catalogue (never real data — ids are all 'demo-*') ──

const UNLIMITED_ID = 'demo-unlimited'
const LIMITED_ID = 'demo-limited'
const PACK_ID = 'demo-pack'
const PARTNER_ID = 'demo-partner'
const PACK_SIZE = 10
const LIMIT_COUNT = 3
const CURRENCY = 'CHF'

// Gated by Unlimited + Limited + the pack; CHF 25 drop-in; the Limited plan
// gets a 50% member rate on that drop-in (it doesn't fully cover the class —
// see limit-weekly / member-rate in the recipes above).
const DEMO_CLASS: Activity = {
  id: 'demo-class',
  teamId: 'demo-team',
  name: 'Yoga Flow',
  slug: 'demo-yoga-flow',
  type: 'class',
  accessRule: { type: 'subscription', subscriptionTypeIds: [UNLIMITED_ID, LIMITED_ID, PACK_ID, PARTNER_ID] },
  dropIn: { enabled: true, priceAmount: 25 },
  memberBenefit: { subscriptionTypeIds: [LIMITED_ID], effect: 'percent_off', percent: 50 },
}

// No access gate — the price is the gate. CHF 85 for 60 minutes, included free
// with the Unlimited plan.
const DEMO_APPOINTMENT: Activity = {
  id: 'demo-appointment',
  teamId: 'demo-team',
  name: 'Personal training',
  slug: 'demo-personal-training',
  type: 'appointment',
  durations: [{ minutes: 60, priceAmount: 85 }],
  memberBenefit: { subscriptionTypeIds: [UNLIMITED_ID], effect: 'included' },
}

// Sold one-off for CHF 49, 50% off for the Unlimited plan. Cast to `unknown`
// first since this fictional fixture skips fields (created_at, etc.) that a
// real Course carries but resolveCourseCell never reads.
const DEMO_COURSE = {
  id: 'demo-course',
  teamId: 'demo-team',
  title: 'Foundations',
  slug: 'demo-foundations',
  accessRule: { type: 'purchase', priceAmount: 49 },
  benefit: { subscriptionTypeIds: [UNLIMITED_ID], effect: 'percent_off', percent: 50 },
} as unknown as Course

// ─── personas ───────────────────────────────────────────────────────────────

type PersonaId = 'guest' | 'member' | 'unlimited' | 'limited' | 'pack' | 'partner'

const PERSONA_IDS: PersonaId[] = ['guest', 'member', 'unlimited', 'limited', 'pack', 'partner']

function buildSnapshot(persona: PersonaId, limitUsedUp: boolean, packEmpty: boolean): ContactPaymentSnapshot {
  switch (persona) {
    case 'guest':
      return GUEST_SNAPSHOT
    case 'member':
      return { authenticated: true, joined: true, heldUnmeteredTypeIds: [], heldCreditTypes: [] }
    case 'unlimited':
      return { authenticated: true, joined: true, heldUnmeteredTypeIds: [UNLIMITED_ID], heldCreditTypes: [] }
    case 'limited':
      return {
        authenticated: true,
        joined: true,
        heldUnmeteredTypeIds: [LIMITED_ID],
        heldCreditTypes: [],
        usageRemaining: { [LIMITED_ID]: limitUsedUp ? 0 : LIMIT_COUNT },
      }
    case 'pack':
      return {
        authenticated: true,
        joined: true,
        heldUnmeteredTypeIds: [],
        heldCreditTypes: [{ subscriptionTypeId: PACK_ID, remaining: packEmpty ? 0 : PACK_SIZE }],
      }
    case 'partner':
      return { authenticated: true, joined: true, heldUnmeteredTypeIds: [PARTNER_ID], heldCreditTypes: [] }
  }
}

// The resolved PriceCell alone can't tell "used up the weekly allowance,
// fell back to drop-in" apart from "never covered, always paid drop-in" — the
// coverage denial that led here isn't carried onto the 'pay' option. Since
// this is our own fixture we know which persona/toggle produced it, so the
// limit-reached line is picked from that context rather than the cell alone.
function whyKey(cell: PriceCell, ctx: { limitUsedUp: boolean }): string {
  if (cell.kind === 'free') {
    if (cell.reason === 'subscription') return 'coveredSubscription'
    if (cell.reason === 'included') return 'coveredIncluded'
    return 'standardFree'
  }
  if (cell.kind === 'credit') return 'coveredCredit'
  if (cell.kind === 'pay') {
    if (typeof cell.baseAmount === 'number') {
      // In THIS demo the only type carrying the class's member rate (Limited)
      // is also the only usage-limited type, so this drop_in+baseAmount path
      // is reached exactly when the weekly allowance is spent — hence the
      // combined line. `memberRate` alone stays here for a hypothetical
      // catalogue where a member rate applies without a usage limit.
      if (cell.source === 'drop_in') return ctx.limitUsedUp ? 'limitReachedMemberRate' : 'memberRate'
      return 'discount'
    }
    if (cell.source === 'drop_in') return ctx.limitUsedUp ? 'limitReachedDropIn' : 'dropInFull'
    if (cell.source === 'base') return 'noBenefitBase'
    if (cell.source === 'course_price') return 'noBenefitCourse'
    return 'standardPrice'
  }
  return 'standardPrice' // 'blocked' — not reachable in this demo (appointments/courses here never deny); kept for exhaustiveness.
}

const FREE_BADGE_CLASS = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
const CREDIT_BADGE_CLASS = 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'

function SimCellBadge({
  cell,
  t,
}: {
  cell: PriceCell
  t: ReturnType<typeof useTranslations<'HowTo'>>
}) {
  if (cell.kind === 'free') {
    return <Badge className={`${FREE_BADGE_CLASS} border-transparent`}>{t('pricing.simulator.freeBadge')}</Badge>
  }
  if (cell.kind === 'credit') {
    return <Badge className={`${CREDIT_BADGE_CLASS} border-transparent`}>{t('pricing.simulator.creditBadge')}</Badge>
  }
  if (cell.kind === 'pay') {
    return (
      <span className="inline-flex items-center gap-1.5">
        {typeof cell.baseAmount === 'number' && (
          <span className="text-xs text-muted-foreground line-through">
            {formatCurrency(cell.baseAmount, CURRENCY)}
          </span>
        )}
        <span className="text-sm font-medium">{formatCurrency(cell.amount, CURRENCY)}</span>
      </span>
    )
  }
  return <span className="text-sm text-muted-foreground">{t('pricing.simulator.blockedBadge')}</span>
}

// ─── component ────────────────────────────────────────────────────────────

export function PricingSimulator() {
  const t = useTranslations('HowTo')
  const [persona, setPersona] = useState<PersonaId>('guest')
  const [limitUsedUp, setLimitUsedUp] = useState(false)
  const [packEmpty, setPackEmpty] = useState(false)

  const handleSelect = (id: PersonaId) => {
    setPersona(id)
    setLimitUsedUp(false)
    setPackEmpty(false)
  }

  const snapshot = useMemo(
    () => buildSnapshot(persona, limitUsedUp, packEmpty),
    [persona, limitUsedUp, packEmpty]
  )

  const classCell = useMemo(() => resolveClassCell(snapshot, DEMO_CLASS), [snapshot])
  const appointmentCell = useMemo(
    () => resolveAppointmentCells(snapshot, DEMO_APPOINTMENT)[0].cell,
    [snapshot]
  )
  const courseCell = useMemo(() => resolveCourseCell(snapshot, DEMO_COURSE), [snapshot])

  const ctx = { limitUsedUp: persona === 'limited' && limitUsedUp }

  const rows: { key: 'class' | 'appointment' | 'course'; cell: PriceCell }[] = [
    { key: 'class', cell: classCell },
    { key: 'appointment', cell: appointmentCell },
    { key: 'course', cell: courseCell },
  ]

  return (
    <div>
      <h3 className="text-base font-semibold">{t('pricing.simulator.title')}</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('pricing.simulator.intro')}</p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {PERSONA_IDS.map((id) => {
          const active = id === persona
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelect(id)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              }`}
            >
              {t(`pricing.simulator.personas.${id}` as Parameters<typeof t>[0])}
            </button>
          )
        })}
      </div>

      {persona === 'limited' && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed p-2.5">
          <span className="text-sm text-muted-foreground">{t('pricing.simulator.limitUsedUpLabel')}</span>
          <Switch checked={limitUsedUp} onCheckedChange={setLimitUsedUp} />
        </div>
      )}
      {persona === 'pack' && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed p-2.5">
          <span className="text-sm text-muted-foreground">{t('pricing.simulator.packEmptyLabel')}</span>
          <Switch checked={packEmpty} onCheckedChange={setPackEmpty} />
        </div>
      )}

      <div className="mt-4 divide-y rounded-lg border">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-col gap-1.5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t(`pricing.simulator.offerings.${row.key}` as Parameters<typeof t>[0])}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t(`pricing.simulator.why.${whyKey(row.cell, ctx)}` as Parameters<typeof t>[0])}
              </p>
            </div>
            <div className="shrink-0">
              <SimCellBadge cell={row.cell} t={t} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        {t('pricing.simulator.outro')}{' '}
        <Link
          href={'/manage/pricing' as Route}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          {t('pricing.linkLabels.pricing')}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </p>
    </div>
  )
}
