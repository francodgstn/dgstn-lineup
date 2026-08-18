'use client'

/**
 * A PANEL — the working surface of this dashboard, and the reason the page has
 * a shape at all.
 *
 * This design keeps the incumbent's two materials (a bordered surface for a
 * bounded thing, a bare number on the background) and adds ONE rule of its own:
 * **hierarchy comes from size, never from decoration**. Exactly one block on
 * the page is primary — the day — and it is primary because it is wider and
 * taller than everything else, not because it is tinted, badged or banded.
 *
 * So a panel is deliberately plain: a hairline, a radius, a 40px header, a body
 * of a height its ROW decides. There is no accent bar, no tinted heading band,
 * no icon chrome. The two panels on this page are visually identical and
 * differently sized, which is the whole composition.
 *
 * The header carries the title, an optional muted `meta` line-mate (the count
 * that stops a title from being a bare noun) and one right-hand `action`.
 */

import type React from 'react'
import { cn } from '@/lib/utils'

export function Panel({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex h-full flex-col rounded-xl border bg-card', className)}>{children}</div>
  )
}

export function PanelHeader({
  title,
  meta,
  action,
}: {
  title: React.ReactNode
  meta?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
      <h2 className="font-heading truncate text-sm font-bold tracking-tight text-heading">
        {title}
      </h2>
      {meta ? <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{meta}</p> : <div className="flex-1" />}
      {action}
    </div>
  )
}

/**
 * The body. `lg:min-h-0 lg:flex-1` is what lets the ROW own the height and the
 * longer of the two lists absorb the difference — below `lg` the panel has no
 * height to divide, so it is an ordinary block under its own ceiling.
 */
export function PanelBody({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'max-h-[320px] overflow-y-auto p-2 lg:max-h-none lg:min-h-0 lg:flex-1',
        className
      )}
    >
      {children}
    </div>
  )
}
