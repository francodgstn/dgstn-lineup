'use client'

/**
 * THE QUOTE — the page's one element with no job to do, and therefore the one
 * that has to be placed rather than parked.
 *
 * It has moved twice. It began as the incumbent's last line, below everything,
 * which is a sign-off nobody scrolls to. It was then pinned to the foot of the
 * right-hand figure RAIL, using air that the rail had anyway — the best home it
 * has had. That rail is gone (2026-08-18: six figures in two columns fill the
 * top-right slot, and the block below it is a donut with a legend), so there is
 * no column of spare air left to pin it to.
 *
 * So it closes the WORKING AREA instead: one centred line between the second
 * row and the Trends seam. That keeps it on the first screen rather than
 * banishing it under the charts, costs ~36px, and puts it exactly where a pause
 * belongs — after the last thing you act on, before the first thing you study.
 *
 * IT MUST NOT READ AS A SYSTEM MESSAGE. Beside real figures, a small italic
 * grey line looks like a status or a warning. The treatment is unmistakably a
 * quotation and nothing else: a muted quote glyph, upright text (no italic), an
 * em-dashed attribution — and `figure`/`blockquote`/`figcaption` markup, so it
 * announces itself as an aside to a screen reader too.
 */

import { getDailyQuote } from '@/data/quotes'

export function DailyAside() {
  const quote = getDailyQuote()
  return (
    <figure className="mx-auto max-w-xl text-center">
      <blockquote className="text-sm leading-relaxed text-muted-foreground">
        <span aria-hidden className="font-heading mr-1 text-base text-primary/25">
          &ldquo;
        </span>
        {quote.text}
      </blockquote>
      <figcaption className="mt-1 text-xs text-muted-foreground/60">— {quote.author}</figcaption>
    </figure>
  )
}
