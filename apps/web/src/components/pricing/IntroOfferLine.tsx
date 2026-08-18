'use client'

// THE sentence a visitor reads before they pay: "CHF 1.00 for the first 3
// months — then CHF 79.00 per month."
//
// It exists as one component because it is rendered on THREE surfaces (the shop
// card, the shop's checkout modal, and the website's pricing block) and a
// discount stated differently in three places is a discount nobody trusts. Most
// of an intro offer's value is being visible BEFORE purchase — a correct
// backend with a vague card is a failed feature — so the copy names both halves
// of the schedule every time, and never the intro price on its own.
//
// The copy lives in the `IntroOffer` message namespace, plural-correct in all
// four locales, and the span is converted the way a member counts it
// (`introOfferSpan`: "the first 6 months", never "the first 2 quarters").

import { useTranslations } from 'next-intl'
import { introOfferSpan, type SubscriptionRecurrence } from '@linyup/shared'
import { formatCurrency } from '@/lib/format'

export interface IntroOfferTerms {
  /** Per-period price while the offer runs, MAJOR units. 0 = free. */
  amount: number
  periods: number
}

/** The mirrored `intro` on a public price entry, narrowed. Returns null for
 *  anything that is not the two-number shape `syncSubscriptionTypesToPublicProfile`
 *  writes — a public mirror is data, and data can be old. */
export function readIntroTerms(raw: unknown): IntroOfferTerms | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as { periods?: unknown; amount?: unknown }
  if (typeof t.periods !== 'number' || !Number.isInteger(t.periods) || t.periods < 1) return null
  if (typeof t.amount !== 'number' || !Number.isFinite(t.amount) || t.amount < 0) return null
  return { periods: t.periods, amount: t.amount }
}

/** The whole sentence as a string, for callers that need it inline. */
export function useIntroOfferText(): (p: {
  intro: IntroOfferTerms
  fullAmount: number
  recurrence: string
  currency: string
}) => string {
  const t = useTranslations('IntroOffer')
  return ({ intro, fullAmount, recurrence, currency }) => {
    const { count, unit } = introOfferSpan(recurrence as SubscriptionRecurrence, intro.periods)
    const span = t(
      unit === 'week' ? 'spanWeek' : unit === 'year' ? 'spanYear' : 'spanMonth',
      { count }
    )
    const per = t('per', { recurrence })
    const full = formatCurrency(fullAmount, currency)
    return intro.amount === 0
      ? t('lineFree', { span, full, per })
      : t('linePriced', { price: formatCurrency(intro.amount, currency), span, full, per })
  }
}

export function IntroOfferLine({
  intro,
  fullAmount,
  recurrence,
  currency,
  className,
  style,
}: {
  intro: IntroOfferTerms
  fullAmount: number
  recurrence: string
  currency: string
  className?: string
  style?: React.CSSProperties
}) {
  const text = useIntroOfferText()
  return (
    <span className={className} style={style}>
      {text({ intro, fullAmount, recurrence, currency })}
    </span>
  )
}
