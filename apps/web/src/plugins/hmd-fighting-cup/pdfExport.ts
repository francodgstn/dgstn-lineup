import jsPDF from 'jspdf'
import type { EventCheckin, EventCategory } from '@linyup/shared'
import type { CompetitorDetail } from './useCompetitorDetails'

const POOL_SIZE_KG = 5

/** The column headings, supplied by the caller so the sheet speaks the studio's
 *  language. Defaults are English rather than the old sheet's Italian: the
 *  product ships in four languages and hardcoding one is what `i18n:check`
 *  exists to prevent. */
export interface PdfLabels {
  category: string
  gender: string
  ageRange: string
  competitors: string
  group: string
  lastname: string
  firstname: string
  age: string
  belt: string
  weight: string
  club: string
  cat: string
  entered: string
  total: string
}

const DEFAULT_LABELS: PdfLabels = {
  category: 'Category',
  gender: 'Gender',
  ageRange: 'Age',
  competitors: 'Competitors',
  group: 'Group',
  lastname: 'Lastname',
  firstname: 'Firstname',
  age: 'Age',
  belt: 'Belt',
  weight: 'Weight',
  club: 'Club',
  cat: 'Cat.',
  entered: 'entered',
  total: 'Total competitors',
}

/** `da X a Y` as the old sheet wrote it, with the open ends it never had. */
function ageRangeLabel(cat: EventCategory): string {
  const lo = cat.min_age
  const hi = cat.max_age
  if (lo == null && hi == null) return ''
  if (lo != null && hi != null) return `${lo}–${hi}`
  return lo != null ? `${lo}+` : `≤${hi}`
}

/** jsPDF does not wrap, and an overlong club name would print straight through
 *  the next column. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}


function checkinWeight(c: EventCheckin): number | null {
  const w = c.checkin_data?.weight as number | undefined
  return typeof w === 'number' && !Number.isNaN(w) ? w : null
}

function checkinCategories(c: EventCheckin): string[] {
  const cats = c.checkin_data?.categories as string[] | undefined
  return Array.isArray(cats) ? cats : []
}

/** Assign each competitor a 5 kg pool number, counting up from the lightest
 *  competitor in the category. Competitors without a weight get pool `null`. */
function assignPools(checkins: EventCheckin[]): Map<string, number | null> {
  const weights = checkins.map(checkinWeight).filter((w): w is number => w != null)
  const result = new Map<string, number | null>()
  if (weights.length === 0) {
    checkins.forEach((c) => result.set(c.id, null))
    return result
  }
  const start = Math.floor(Math.min(...weights) / POOL_SIZE_KG) * POOL_SIZE_KG
  for (const c of checkins) {
    const w = checkinWeight(c)
    result.set(c.id, w == null ? null : Math.floor((w - start) / POOL_SIZE_KG) + 1)
  }
  return result
}

/**
 * Lineup PDF — the sheet the officials work from at the table.
 *
 * A summary of every category with its head count, then ONE PAGE PER CATEGORY
 * listing its competitors in 5 kg pools.
 *
 * ── THE COLUMNS ARE THE OLD LINEUP'S COLUMNS ────────────────────────────────
 * Group · Lastname · Firstname · Age · Belt · Weight · Club · Cat., exactly as
 * `PdfFightingCupExport.js` printed them in hmd-lineup. This had drifted to
 * Pool · # · Name · Weight · Status — a tidier sheet that dropped the three
 * things the table actually checks a competitor against (their age against the
 * category's bracket, their belt against its level, and which club to call when
 * somebody is missing), and added a check mark nobody reads on paper (Franco,
 * 2026-09-05: keep the old layout exactly).
 *
 * `Cat.` is how many categories this competitor is entered in — the warning
 * that somebody is due on two mats.
 *
 * Age, belt and club are not on the check-in document; `useCompetitorDetails`
 * fetches them, and a competitor whose contact cannot be read prints blanks
 * rather than costing everyone the sheet.
 *
 * The old heading read `{gender} {style} {level} da X a Y anni (N iscritti)`.
 * The structure is kept and the ITALIAN IS NOT: this product ships in four
 * languages, and hardcoding one is the thing `i18n:check` exists to stop. Style
 * and level are no longer separate fields either — the migration folded them
 * into the category NAME — so the heading leads with the name it was given.
 */
export function exportFightingCupPdf(
  checkins: EventCheckin[],
  categories: EventCategory[],
  eventTitle: string,
  eventDate: string,
  /** Age / belt / club per contact id. Absent ⇒ those columns print blank. */
  details?: Map<string, CompetitorDetail>,
  /** Column headings and the head-count suffix, from the caller's locale. */
  labels?: PdfLabels,
) {
  // LANDSCAPE. Eight columns do not fit across a portrait A4 at a size anybody
  // can read across a table — which is most of why the columns were dropped the
  // first time rather than the page being turned.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = 297
  const margin = 14
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) }
  const detail = (id: string): CompetitorDetail =>
    details?.get(id) ?? { age: null, belt: null, club: null }

  // The old sheet sorted style → gender → level → youngest. Style and level are
  // gone into the name, so: gender, then age bracket, then name — with an
  // explicit `sort_order` still winning, because somebody who dragged the
  // categories into an order meant it.
  const sorted = [...categories].sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (so !== 0) return so
    const g = (a.gender ?? '').localeCompare(b.gender ?? '')
    if (g !== 0) return g
    const age = (a.min_age ?? 0) - (b.min_age ?? 0)
    if (age !== 0) return age
    return a.name.localeCompare(b.name)
  })
  const inCategory = (cat: EventCategory) =>
    checkins.filter((c) => checkinCategories(c).includes(cat.id))

  let y = margin

  // ── Title ──
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(eventTitle, margin, y)
  y += 6
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(eventDate, margin, y)
  doc.setTextColor(0)
  y += 10

  // ── Summary table ──
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary', margin, y)
  y += 5
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120)
  doc.text(L.category, margin + 2, y)
  doc.text(L.gender, margin + 150, y)
  doc.text(L.ageRange, margin + 180, y)
  doc.text(L.competitors, margin + 220, y)
  doc.setTextColor(0)
  y += 2
  doc.setDrawColor(200)
  doc.line(margin, y, pageW - margin, y)
  y += 4

  doc.setFontSize(9)
  for (const cat of sorted) {
    if (y > 185) { doc.addPage(); y = margin }
    doc.text(cat.name, margin + 2, y)
    doc.text(cat.gender ?? '—', margin + 150, y)
    doc.text(ageRangeLabel(cat), margin + 180, y)
    doc.text(String(inCategory(cat).length), margin + 220, y)
    y += 5.5
  }

  // ── One page per category with competitors ──
  for (const cat of sorted) {
    // BY POOL, then by weight inside it — the old sheet ordered by group,
    // because the table works one pool at a time.
    const byWeight = inCategory(cat).sort(
      (a, b) => (checkinWeight(a) ?? Infinity) - (checkinWeight(b) ?? Infinity),
    )
    if (byWeight.length === 0) continue
    const poolOf = assignPools(byWeight)
    const entries = [...byWeight].sort(
      (a, b) => (poolOf.get(a.id) ?? Infinity) - (poolOf.get(b.id) ?? Infinity),
    )

    doc.addPage()
    y = margin

    // Category header
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    // The old heading's shape: what the category is, its bracket, its count.
    doc.text(
      `${cat.name}${cat.gender ? ` · ${cat.gender}` : ''} ${ageRangeLabel(cat)}  (${entries.length} ${L.entered})`,
      margin,
      y,
    )
    y += 7

    // Column headers
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120)
    doc.text(L.group, margin + 2, y)
    doc.text(L.lastname, margin + 16, y)
    doc.text(L.firstname, margin + 66, y)
    doc.text(L.age, margin + 116, y)
    doc.text(L.belt, margin + 130, y)
    doc.text(L.weight, margin + 180, y)
    doc.text(L.club, margin + 200, y)
    doc.text(L.cat, margin + 258, y)
    doc.setTextColor(0)
    y += 2
    doc.setDrawColor(200)
    doc.line(margin, y, pageW - margin, y)
    y += 4

    doc.setFontSize(9)
    for (const c of entries) {
      const weight = checkinWeight(c)
      const pool = poolOf.get(c.id)
      const d = detail(c.contact.id)

      // A4 landscape is 210mm tall; rows stop short of the bottom margin.
      if (y > 190) {
        doc.addPage()
        y = margin
      }

      doc.text(pool != null ? String(pool) : '—', margin + 2, y)
      doc.text(clip(c.contact.lastname, 26), margin + 16, y)
      doc.text(clip(c.contact.firstname, 26), margin + 66, y)
      doc.text(d.age != null ? String(d.age) : '—', margin + 116, y)
      doc.text(clip(d.belt ?? '—', 26), margin + 130, y)
      doc.text(weight != null ? `${weight} kg` : '—', margin + 180, y)
      doc.text(clip(d.club ?? '—', 30), margin + 200, y)
      doc.text(String(checkinCategories(c).length), margin + 258, y)
      y += 6
    }
  }

  // ── Footer total ──
  if (y > 190) { doc.addPage(); y = margin }
  y += 4
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`${L.total}: ${checkins.length}`, margin, y)

  doc.save(`${eventTitle.replace(/[^a-z0-9]/gi, '_')}_lineup.pdf`)
}
