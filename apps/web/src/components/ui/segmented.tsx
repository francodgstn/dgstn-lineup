'use client'

// A segmented control — a row of mutually exclusive pills in a bordered tray.
//
// The same control had been hand-written at two sizes on the contact detail page
// alone (the membership segment toggle and the activity period pills), identical
// but for padding and text size. Two copies of a control are two places for its
// focus, hover and selected states to drift.
//
// Presentational only: it owns no state and knows nothing about URLs. The caller
// holds the value — which on the contact page means `useTabParam`, so a segment
// survives a refresh.

import type { ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Accessible name when `label` is an abbreviation ("3M", "30d"). */
  title?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
  className = '',
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  /** `sm` is the compact form used for period pills; `md` for a section toggle. */
  size?: 'sm' | 'md'
  ariaLabel?: string
  className?: string
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-background p-0.5 ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            title={o.title}
            className={`rounded-md font-medium transition-colors ${pad} ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
