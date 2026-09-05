'use client'

// The step rail above a goal's task list: one circle per task on a track that
// fills green as they get ticked.
//
// DELIBERATELY NOT JUST A PERCENTAGE BAR. A goal's tasks are a short, named
// sequence ("bring a gi", "drill the entry", "spar it") — five of them, not five
// hundred — so the steps themselves have to be visible, and a bare bar would
// hide how many are left. It reuses the SAME icons the task rows use
// (CheckCircle2 / Circle), so a circle on the rail and a circle in the list
// below are visibly the same thing.
//
// TWO READINGS, ON PURPOSE, and they answer different questions:
//   • the FILL is how far along the goal is — done ÷ total, a summary;
//   • each CIRCLE is that task's own state.
// They are drawn together because a list finished out of order is a real thing:
// the fill says "two of four", the circles say WHICH two, and neither has to
// lie to keep the other honest.

import { CheckCircle2, Circle } from 'lucide-react'
import type { Goal } from '@linyup/shared'

export function GoalProgressBar({ steps, label }: { steps: Goal[]; label: string }) {
  // Nothing to draw for a goal with no tasks — the caller still renders its
  // "no tasks yet" line, which says more than an empty rail would.
  if (steps.length === 0) return null

  const done = steps.filter((s) => s.status === 'achieved').length
  const pct = Math.round((done / steps.length) * 100)

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex min-w-0 flex-1 items-center" aria-hidden="true">
        {/* The track, and the green that advances along it. Inset by half an
            icon at each end so the fill starts and finishes UNDER the first and
            last circles rather than poking out past them. */}
        <div className="absolute inset-x-2 h-1 rounded-full bg-muted-foreground/20" />
        <div
          className="absolute left-2 h-1 rounded-full bg-green-500 transition-[width] duration-300"
          style={{ width: `calc((100% - 1rem) * ${pct} / 100)` }}
        />
        {/* Evenly spread across the full width — `justify-between` rather than
            flexing the connectors, which bunched the last two circles together
            whenever a goal had three tasks. */}
        <div className="relative flex w-full items-center justify-between">
          {steps.map((step) => (
            <span key={step.id} className="rounded-full bg-card leading-none">
              {step.status === 'achieved' ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
            </span>
          ))}
        </div>
      </div>
      {/* The rail says which, this says how many — and this is the part that
          survives being read at a glance on a phone. */}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{label}</span>
    </div>
  )
}
