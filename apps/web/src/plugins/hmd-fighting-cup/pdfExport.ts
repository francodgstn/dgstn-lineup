import jsPDF from 'jspdf'
import type { EventCheckin, EventCategory } from '@linyup/shared'

const POOL_SIZE_KG = 5

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
 * Lineup PDF: a summary table of categories with competitor counts, followed by
 * one page per category listing competitors grouped into 5 kg weight pools
 * (sorted lightest → heaviest). Mirrors the legacy HMD "Export categories" print.
 */
export function exportFightingCupPdf(
  checkins: EventCheckin[],
  categories: EventCategory[],
  eventTitle: string,
  eventDate: string,
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  const margin = 14

  const sorted = [...categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
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
  doc.text('Category', margin + 2, y)
  doc.text('Competitors', margin + 130, y)
  doc.setTextColor(0)
  y += 2
  doc.setDrawColor(200)
  doc.line(margin, y, pageW - margin, y)
  y += 4

  doc.setFontSize(9)
  for (const cat of sorted) {
    if (y > 275) { doc.addPage(); y = margin }
    doc.text(cat.name, margin + 2, y)
    doc.text(String(inCategory(cat).length), margin + 130, y)
    y += 5.5
  }

  // ── One page per category with competitors ──
  for (const cat of sorted) {
    const entries = inCategory(cat).sort(
      (a, b) => (checkinWeight(a) ?? Infinity) - (checkinWeight(b) ?? Infinity),
    )
    if (entries.length === 0) continue

    doc.addPage()
    y = margin

    // Category header
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text(`${cat.name}  (${entries.length})`, margin, y)
    y += 7

    // Column headers
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120)
    doc.text('Pool', margin + 2, y)
    doc.text('#', margin + 18, y)
    doc.text('Name', margin + 28, y)
    doc.text('Weight', margin + 120, y)
    doc.text('Status', margin + 150, y)
    doc.setTextColor(0)
    y += 2
    doc.setDrawColor(200)
    doc.line(margin, y, pageW - margin, y)
    y += 4

    const pools = assignPools(entries)
    doc.setFontSize(9)
    for (let i = 0; i < entries.length; i++) {
      const c = entries[i]
      const weight = checkinWeight(c)
      const pool = pools.get(c.id)
      const name = `${c.contact.firstname} ${c.contact.lastname}`

      if (y > 280) {
        doc.addPage()
        y = margin
      }

      doc.text(pool != null ? String(pool) : '—', margin + 2, y)
      doc.text(String(i + 1), margin + 18, y)
      doc.text(name, margin + 28, y)
      doc.text(weight != null ? `${weight} kg` : '—', margin + 120, y)
      doc.text(c.is_completed ? '✓' : '', margin + 150, y)
      y += 6
    }
  }

  // ── Footer total ──
  if (y > 280) { doc.addPage(); y = margin }
  y += 4
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Total competitors: ${checkins.length}`, margin, y)

  doc.save(`${eventTitle.replace(/[^a-z0-9]/gi, '_')}_lineup.pdf`)
}
