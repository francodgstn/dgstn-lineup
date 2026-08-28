'use client'

/**
 * THE ORGANISATION TIER CANNOT SHOW ONE NUMBER, so it shows the rate and lets
 * you build your own.
 *
 * Every other tier is a scalar — CHF 9, CHF 35 — and the card renders it. This
 * one is CHF 25 PER STUDIO, so the honest headline is the rate, and the number a
 * visitor actually wants (what do *I* pay) is one they compose: step the studio
 * count, watch the total. Two studios is 50, five is 125, ten is 250.
 *
 * ── THE RATE IS FLAT, SO NEVER "FROM" ───────────────────────────────────────
 * "From CHF 25" describes a price that climbs with size. This one does not: no
 * base fee, no tiers, no volume discount, the tenth studio costs what the second
 * did. The tier was published as "From CHF 103" while it carried a base fee, and
 * `orgPriceFrom()` was deleted rather than renamed so the framing cannot come
 * back by habit (Franco, 2026-08-28).
 *
 * ── ABOVE TEN IS A FOURTH STATE, NOT A HIDDEN PLAN ──────────────────────────
 * Past ten studios the number is quoted rather than listed — and that is the
 * easiest thing here to get wrong, because the shape everyone reaches for is
 * "Enterprise · Contact sales", which is precisely what this product positions
 * against. The landing page's own subtitle says so: "No 'request a demo to see
 * pricing'".
 *
 * So the quote state keeps everything except the total: same card, same rate on
 * the same line, still per studio, and the ask is a number back rather than a
 * meeting. It is the same tier one step further along, which is why it lives
 * inside this control instead of in a card of its own.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Minus, Plus } from 'lucide-react'
import {
  ORG_MAX_LISTED_STUDIOS,
  ORG_MIN_STUDIOS,
  ORG_PER_STUDIO,
  orgMonthlyForStudios,
} from '@linyup/shared'

/** One past the listed maximum — the value that means "more than ten". */
const QUOTE_STEP = ORG_MAX_LISTED_STUDIOS + 1

export function OrgStudioPricer({
  /** Rendered under the stepper. The billing card wants it; a dialog does not. */
  showTotal = true,
  className,
}: {
  showTotal?: boolean
  className?: string
}) {
  const t = useTranslations('Pricing')
  // Opens at the minimum rather than at something flattering: the first number
  // somebody sees should be the one that is true of the smallest organisation.
  const [studios, setStudios] = useState(ORG_MIN_STUDIOS)
  const quoting = studios >= QUOTE_STEP

  const clamp = (n: number) => Math.min(QUOTE_STEP, Math.max(ORG_MIN_STUDIOS, n))

  return (
    <div className={className}>
      {/* THE RATE, at the weight the other cards give their price — this tier
          has to read as comparable at a glance, not as a special case. */}
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold">CHF {ORG_PER_STUDIO.monthly}</span>
        <span className="text-xs text-muted-foreground">{t('perStudioMonth')}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center rounded-lg border">
          <button
            type="button"
            onClick={() => setStudios((n) => clamp(n - 1))}
            disabled={studios <= ORG_MIN_STUDIOS}
            aria-label={t('orgFewerStudios')}
            className="flex h-8 w-8 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {/* tabular-nums so the row does not jump between 9 and 10. */}
          <span className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums">
            {quoting ? t('orgStudiosPlus', { count: ORG_MAX_LISTED_STUDIOS }) : studios}
          </span>
          <button
            type="button"
            onClick={() => setStudios((n) => clamp(n + 1))}
            disabled={quoting}
            aria-label={t('orgMoreStudios')}
            className="flex h-8 w-8 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="text-xs text-muted-foreground">{t('orgStudiosLabel')}</span>
      </div>

      {showTotal && (
        // Fixed height across both states so stepping to the quote does not
        // resize the card and shove the button under the cursor.
        <p className="mt-2 min-h-[1.25rem] text-sm">
          {quoting ? (
            <span className="text-muted-foreground">{t('orgQuoteNote')}</span>
          ) : (
            <span className="font-medium">
              {t('orgTotalLine', { total: orgMonthlyForStudios(studios) })}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
