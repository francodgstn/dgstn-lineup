'use client'

// The step rail above a goal's task list: one circle per task, connected, green
// advancing as they get ticked.
//
// DELIBERATELY NOT A PERCENTAGE BAR. A goal's tasks are a short, named sequence
// ("bring a gi", "drill the entry", "spar it") — five of them, not five hundred
// — so the honest picture is the steps themselves, and a filled bar would hide
// which ones are left. It reuses the SAME icons the task rows use
// (CheckCircle2 / Circle) so a circle on the rail and a circle in the list below
// are visibly the same thing.
//
// Each circle shows ITS OWN state; a connector is green only when the step it
// leaves is done. So a list finished out of order reads as it actually is —
// green, grey, green — rather than being rounded up into a lie.

import { CheckCircle2, Circle } from 'lucide-react'
import type { Goal } from '@linyup/shared'

export function GoalProgressBar({ steps, label }: { steps: Goal[]; label: string }) {
  // Nothing to draw for a goal with no tasks — the caller still renders its
  // "no tasks yet" line, which says more than an empty rail would.
  if (steps.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 items-center min-w-0" aria-hidden="true">
        {steps.map((step, i) => {
          const done = step.status === 'achieved'
          return (
            <div key={step.id} className="flex items-center min-w-0 first:flex-none flex-1 last:flex-none">
              {i > 0 && (
                <div
                  className={`h-0.5 flex-1 min-w-2 ${
                    steps[i - 1].status === 'achieved' ? 'bg-green-500' : 'bg-muted-foreground/25'
                  }`}
                />
              )}
              {done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
              )}
            </div>
          )
        })}
      </div>
      {/* The count stays: the rail says which, this says how many — and it is
          the part that survives being read at a glance on a phone. */}
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{label}</span>
    </div>
  )
}
