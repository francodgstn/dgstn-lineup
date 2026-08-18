'use client'

// A labelled disclosure for the OPTIONAL tail of a long form.
//
// ── THE DISCLOSURE RULE (read this before putting a field behind it) ─────────
//
// Only a field whose default is right for a studio that NEVER opens this may
// live here. Concretely: leaving it untouched must produce the behaviour that
// studio would have chosen, and an empty value must render nothing rather than
// something wrong. A default that is wrong is worse than a question.
//
// So these NEVER go behind it, however long the form gets:
//   • anything that decides what someone is CHARGED — a price, a discount, a
//     drop-in or trial fee, a member benefit;
//   • anything that decides WHO CAN GET IN — an access tier, a capacity, a
//     trial door, a subscription allow-list.
// They may be grouped and ordered, never tucked away. `WaiverSettings.tsx`
// carries the same rule for `mayIncludeMinors`, and `Course.accessRule`'s tiers
// are public copy for the same reason (UX-11: a members-tier class must still
// say so publicly).
//
// `defaultOpen` exists for ONE job: an EDIT form whose stored doc already has a
// value in here must open showing it. A field the studio filled in and then
// cannot find is a worse bug than the one this component fixes.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function MoreOptions({
  label,
  hint,
  defaultOpen = false,
  children,
  className,
}: {
  /** Visible trigger text — always a translated string, never a bare "Advanced". */
  label: string
  /** One line saying what is inside, so the trigger is not a mystery box. */
  hint?: string
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={cn('space-y-3', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            !open && '-rotate-90',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  )
}
