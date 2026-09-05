'use client'

// Space's themed twin of the admin's step rail
// (contacts/[id]/GoalProgressBar.tsx) — READ ITS HEADER FIRST, the design
// reasoning is not restated here. Only the colours move: Tailwind's semantic
// tokens (green-500, muted-foreground) become the tenant's own bioLink theme
// via useSpaceTheme(), the same split RatingStars' `emptyColor` makes and for
// the same reason — a studio's dark theme can render an app-token colour
// invisible, or fight its own accent.
//
// TWO READINGS, UNCHANGED FROM THE ADMIN:
//   • the FILL is done ÷ total — a summary of how far along the goal is;
//   • each CIRCLE is that one step's own state.
// A goal finished out of order is real: the fill says "two of four", the
// circles say WHICH two.

import { CheckCircle2, Circle } from 'lucide-react'
import type { Goal } from '@linyup/shared'
import { useSpaceTheme } from '../useSpaceTheme'

export function GoalProgressBar({ steps, label }: { steps: Goal[]; label: string }) {
  const { accent, textMuted, cardBg, cardBorder } = useSpaceTheme()

  // Nothing to draw for a goal with no steps — same as the admin: the caller
  // decides what, if anything, to show instead (GoalCard simply omits the
  // rail row).
  if (steps.length === 0) return null

  const done = steps.filter((s) => s.status === 'achieved').length
  const pct = Math.round((done / steps.length) * 100)

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex min-w-0 flex-1 items-center" aria-hidden="true">
        {/* The track, and the fill that advances along it. Inset by half an
            icon at each end so the fill starts and finishes UNDER the first
            and last circles rather than poking out past them. */}
        <div className="absolute inset-x-2 h-1 rounded-full" style={{ background: cardBorder }} />
        <div
          className="absolute left-2 h-1 rounded-full transition-[width] duration-300"
          style={{ width: `calc((100% - 1rem) * ${pct} / 100)`, background: accent }}
        />
        {/* Evenly spread across the full width — `justify-between` rather
            than flexing the connectors, which would bunch the last two
            circles together whenever a goal had three steps. */}
        <div className="relative flex w-full items-center justify-between">
          {steps.map((step) => (
            <span key={step.id} className="rounded-full leading-none" style={{ background: cardBg }}>
              {step.status === 'achieved' ? (
                <CheckCircle2 className="h-4 w-4" style={{ color: accent }} />
              ) : (
                <Circle className="h-4 w-4" style={{ color: textMuted, opacity: 0.5 }} />
              )}
            </span>
          ))}
        </div>
      </div>
      {/* The rail says which, this says how many — and it is the part that
          survives being read at a glance on a phone. */}
      <span className="shrink-0 text-xs tabular-nums" style={{ color: textMuted }}>
        {label}
      </span>
    </div>
  )
}
