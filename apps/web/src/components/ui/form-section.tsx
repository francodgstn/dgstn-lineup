'use client'

/**
 * ONE FORM RHYTHM: stacked sections separated by a rule, never a page of boxes.
 *
 * ── THE TWO IDIOMS THIS REPLACES ────────────────────────────────────────────
 * Long forms in this app grew two different shapes. The session dialog stacks
 * `<section>`s under small uppercase labels with a hairline between them. The
 * subscription and activity dialogs put every setting group in its own
 * `rounded-lg border border-dashed p-3` card. Read side by side they look like
 * two products, and the boxed one reads worse for the reason boxes always do at
 * this density: each border draws an edge the eye has to cross, so eight
 * settings become eight objects to parse rather than one list to read down.
 *
 * The stacked shape won (Franco, 2026-08-23). A rule is the lightest mark that
 * still says "new group", it costs no horizontal space, and nested inside a
 * dialog that already has a border it does not add a second frame.
 *
 * ── WHEN A BOX IS STILL RIGHT ───────────────────────────────────────────────
 * A box means "this is a different KIND of thing", not "this is the next
 * setting". A repeated row that can be added and removed (a price, a duration,
 * a question) still gets one, because each is an item in a list rather than a
 * section of the form. Warnings and empty states keep theirs too — they are
 * asides, and an aside with no edge reads as body copy.
 *
 * Use `<FormSection title=…>` for a group of settings, and put nothing round it.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function FormSection({
  title,
  description,
  action,
  className,
  children,
}: {
  /** Small, uppercase, muted — a label for the group, not a heading competing
   *  with the dialog's own title. */
  title?: ReactNode
  /** One line under the title, when the group needs a sentence to make sense. */
  description?: ReactNode
  /** A control belonging to the group as a whole (an "Add" button, a switch). */
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    // `first:*` resets so the topmost section carries no rule and no dead space
    // above it — a form must not open with a horizontal line.
    <section
      className={cn(
        'space-y-3 border-t pt-5 first:border-t-0 first:pt-0',
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            {title && (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
              </h3>
            )}
            {description && (
              <p className="text-xs font-normal text-muted-foreground">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
