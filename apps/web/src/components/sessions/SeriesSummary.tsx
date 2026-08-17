'use client'

// "Weekly · until 14 Feb 2027" — the one sentence that says when a repeating
// class stops.
//
// Every surface that marks a session as repeating used to show an unlabelled
// 14px loop glyph and nothing else, so the end date of a series existed only in
// the Firestore document that created it. This component is that fact, rendered.

import { useTranslations } from 'next-intl'
import { useSessionSeries, type SeriesRecurrence } from '@/hooks/useSessionSeries'

const PATTERN_KEY = {
  daily: { one: 'freqDaily', many: 'seriesEveryDays' },
  weekly: { one: 'freqWeekly', many: 'seriesEveryWeeks' },
  monthly: { one: 'freqMonthly', many: 'seriesEveryMonths' },
  yearly: { one: 'freqYearly', many: 'seriesEveryYears' },
} as const

/**
 * Renders the summary for a series. While it loads — or if the series document
 * has been deleted out from under its sessions — it renders `fallback`, so a
 * caller that has nothing else to say ("Part of a recurring series") never ends
 * up with a bare icon and an empty line.
 */
export function SeriesSummary({
  seriesId,
  className,
  fallback,
}: {
  seriesId: string
  className?: string
  fallback?: string
}) {
  const t = useTranslations('Sessions')
  const { data } = useSessionSeries(seriesId)

  const recurrence: SeriesRecurrence | undefined = data?.recurrence
  if (!recurrence) return fallback ? <span className={className}>{fallback}</span> : null

  const frequency = recurrence.frequency ?? 'weekly'
  const interval = recurrence.interval ?? 1
  const keys = PATTERN_KEY[frequency] ?? PATTERN_KEY.weekly
  const pattern = interval > 1 ? t(keys.many, { count: interval }) : t(keys.one)

  const ends =
    recurrence.endCondition === 'date' && recurrence.endDate
      ? t('seriesUntil', {
          date: recurrence.endDate
            .toDate()
            .toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }),
        })
      : recurrence.endCondition === 'count' && recurrence.maxOccurrences
        ? t('seriesEndsAfterCount', { count: recurrence.maxOccurrences })
        : t('seriesNoEnd')

  return <span className={className}>{`${pattern} · ${ends}`}</span>
}
