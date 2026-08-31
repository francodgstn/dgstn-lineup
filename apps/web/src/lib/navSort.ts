/**
 * THE ORDER OF ROWS INSIDE A NAV SECTION — one rule, in one place.
 *
 * ── WHY A RULE AT ALL ───────────────────────────────────────────────────────
 * Rows used to be ordered by declaration, which was documented as "frequency of
 * use, most-used first". That is a real ranking and it beat alphabetical the day
 * it was written — but it has to be RE-DECIDED every time a row is added, and
 * rows are added and removed here constantly. What it degrades into is not a
 * ranking; it is the order things happened to be written in, which nobody can
 * read off the screen and nobody can check. A studio cannot tell a considered
 * order from an accidental one, so it gets no benefit from the considered part
 * and pays the scanning cost of the accidental part (Franco, 2026-08-31).
 *
 * Alphabetical is the order a reader can PREDICT. It costs nothing to maintain,
 * it is the same answer for every reviewer, and it makes "where is X" answerable
 * without having learned the list.
 *
 * ── WHY THERE IS AN EXCEPTION, AND EXACTLY ONE ──────────────────────────────
 * This was tried once as pure alphabetical (6d94638f) and reverted the next day:
 * Schedule — the destination a studio opens every single session — sorted to the
 * BOTTOM of Run, behind every row it opens less often, and landed somewhere
 * different again in German, French and Italian (UX-29). That is a real defect,
 * not a taste, and shipping it again knowingly would be worse than either order.
 *
 * So: **alphabetical, except a row explicitly marked `lead`.** Leads come first,
 * in declaration order among themselves. The marker is deliberately hard to
 * justify — a lead is a row whose position is load-bearing, not a row somebody
 * likes — and each one carries its reason where it is declared. If the lead list
 * starts growing, the rule has been lost and the ranking is back.
 *
 * ── LOCALE ──────────────────────────────────────────────────────────────────
 * Sorting is on the TRANSLATED label through a locale collator, so a German
 * reader gets a list alphabetical in German. That means the order differs per
 * locale — which was half of UX-29's complaint, but only because the order was
 * ALSO unpredictable there. Sorted by the English label instead, a German list
 * would be in no discernible order at all, which is strictly worse.
 */

export interface SortableNavRow {
  /** The translated label, already resolved — this module holds no i18n. */
  label: string
  /** Pin to the head of the section. See the note above before adding one. */
  lead?: boolean
}

/**
 * Alphabetical by label within a section, leads first.
 *
 * Returns a NEW array — every caller here holds a module-level constant, and
 * sorting one in place would reorder it for the whole process.
 */
export function sortNavRows<T extends SortableNavRow>(rows: readonly T[], locale: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const leadA = a.row.lead === true
      const leadB = b.row.lead === true
      // Leads keep DECLARATION order among themselves: there are one or two per
      // section and their order is the thing being asserted, so alphabetising
      // them would throw away the only part that was decided.
      if (leadA !== leadB) return leadA ? -1 : 1
      if (leadA && leadB) return a.index - b.index
      return collator.compare(a.row.label, b.row.label) || a.index - b.index
    })
    .map((e) => e.row)
}
