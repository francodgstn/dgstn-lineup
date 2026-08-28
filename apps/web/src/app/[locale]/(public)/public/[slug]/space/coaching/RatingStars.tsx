'use client'

// A 1–5 star rating, shared by the evaluation form, the check-in form and the
// read-only `latest_score` badge on a goal card.
//
// `value: 0` MEANS UNSET, and is only meaningful when interactive. A rating
// input that opens pre-filled at "3" lets a stray click submit a score
// indistinguishable, later, from a deliberate neutral one — every caller of
// this component in `onChange` mode starts its own state at 0 and disables
// its Submit button until every star it renders has been touched. This
// component itself does not enforce that; it just never claims 0 is a rating.

import { useTranslations } from 'next-intl'
import { Star } from 'lucide-react'

const FILLED_COLOR = '#f59e0b'

interface Props {
  /** 1–5, or 0 for unset. */
  value: number
  onChange?: (value: number) => void
  size?: number
  readOnly?: boolean
  /** Colour for an unfilled star. Leave unset inside the neutral app-token
   *  Dialogs (the default Tailwind muted token is already correct there); pass
   *  the host surface's own muted colour on a tenant-themed card — RatingStars
   *  has no theme of its own, same split `QueryErrorState` makes and for the
   *  same reason (a studio's dark theme can render an app-token muted colour
   *  invisible). */
  emptyColor?: string
}

export function RatingStars({ value, onChange, size = 22, readOnly = false, emptyColor }: Props) {
  const t = useTranslations('SpaceCoaching')
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value
        const style = { width: size, height: size, color: filled ? FILLED_COLOR : emptyColor }
        const starClassName = filled ? 'fill-current' : emptyColor ? undefined : 'text-muted-foreground/40'
        if (readOnly) {
          return <Star key={n} aria-hidden className={starClassName} style={style} />
        }
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange?.(n)}
            aria-label={t('ratingAriaLabel', { n })}
            aria-pressed={filled}
            className="rounded-full p-0.5 transition-transform hover:scale-110"
          >
            <Star className={starClassName} style={style} />
          </button>
        )
      })}
    </div>
  )
}
