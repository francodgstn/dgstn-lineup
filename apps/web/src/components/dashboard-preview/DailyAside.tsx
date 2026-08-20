'use client'

/**
 * THE QUOTE — the page's one element with no job to do, and therefore the one
 * that has to be placed rather than parked.
 *
 * It has moved three times, and has come back to where it worked. It began as
 * the incumbent's last line, below everything — a sign-off nobody scrolls to.
 * It was then pinned to the foot of the right-hand figure RAIL, using air that
 * the rail had anyway, which was the best home it has had. When the rail became
 * a two-column figure block there was no spare column of air left, so it spent
 * a round as a centred full-width band between the working area and the Trends
 * seam — which cost the page ~86px to say nothing, and the queue was short.
 *
 * It is back at the FOOT OF THE REFERENCE COLUMN (Franco, 2026-08-18): under
 * the donut, pushed down by the column's `justify-between`, holding the bottom
 * edge while the queue beside it grew into the 86px the band was using. That is
 * the whole argument for this placement — the quote occupies air that another
 * block cannot use, and it costs the layout nothing it wanted.
 *
 * LEFT-ALIGNED, not centred: it now lives in a ~417px column under a donut and
 * a legend that both align left. It was centred only because it used to span
 * the page.
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
    // RULED OFF FROM THE DONUT ABOVE IT (Franco, 2026-08-21). The quote sits at
    // the foot of a column whose other occupant is a chart with a legend, and
    // with only air between them a reader coming down the column meets the
    // quote as if it were one more legend row. A muted rule says "different
    // kind of thing" in a way that whitespace at this scale cannot.
    //
    // The rule and its padding are paid for out of the column's OWN slack: the
    // column is `justify-between` at a fixed height, so a taller quote eats the
    // free air above it rather than pushing the page down. That matters because
    // this element already sits on the fold — see the dashboard page's row 2
    // note, and never let this be the block that gives way.
    <figure className="border-t pt-4">
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
