'use client'

/**
 * "This already happened."
 *
 * Shown at the top of the session and event edit dialogs when the thing being
 * edited has already finished. Editing history is legitimate — correcting an
 * attendance count, fixing a name that was wrong on the night, tidying notes
 * after the fact — so this INFORMS and does not block. Nothing is disabled and
 * saving behaves exactly as it always has.
 *
 * What it prevents is the other case: a recurring class looks identical at every
 * occurrence, and a manager who scrolled the wrong way edits last Tuesday
 * believing it is next Tuesday. There is nothing else on either dialog that says
 * which one is open — the date is a field among fifteen, and by the time you are
 * reading fields you have already assumed the answer.
 *
 * Deliberately NOT a confirmation step. A guard that fires on every legitimate
 * back-fill would be dismissed without reading within a week, and would then be
 * worth nothing on the day it was right.
 *
 * Sits directly under the `partOfSeries` banner in SessionFormDialog and shares
 * its shape — same row geometry, same size, amber instead of primary. A past
 * occurrence of a series shows both, which is correct: they answer different
 * questions.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'

export function PastItemNotice({ className = '' }: { className?: string }) {
  const t = useTranslations('Sessions')
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 ${className}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>{t('pastItemNotice')}</span>
    </div>
  )
}
