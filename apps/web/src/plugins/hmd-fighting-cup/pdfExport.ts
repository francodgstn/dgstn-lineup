import jsPDF from 'jspdf'
import type { EventCheckin, EventCategory } from '@linyup/shared'

interface CheckinWithCategory extends EventCheckin {
  categories?: EventCategory[]
}

export function exportFightingCupPdf(
  checkins: CheckinWithCategory[],
  categories: EventCategory[],
  eventTitle: string,
  eventDate: string,
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  const margin = 14

  let y = margin

  // Title
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

  // Group checkins by category
  for (const cat of [...categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const inCat = checkins.filter((c) => {
      const cats = c.checkin_data?.categories as string[] | undefined
      return cats?.includes(cat.id)
    })
    if (inCat.length === 0) continue

    // Category header
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setFillColor(240, 240, 240)
    doc.rect(margin, y - 4, pageW - margin * 2, 7, 'F')
    doc.text(cat.name, margin + 2, y)
    y += 5

    // Column headers
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120)
    doc.text('#', margin + 2, y)
    doc.text('Name', margin + 12, y)
    doc.text('Weight', margin + 90, y)
    doc.text('Status', margin + 120, y)
    doc.setTextColor(0)
    y += 3
    doc.setDrawColor(200)
    doc.line(margin, y, pageW - margin, y)
    y += 3

    // Rows
    doc.setFontSize(9)
    for (let i = 0; i < inCat.length; i++) {
      const c = inCat[i]
      const weight = (c.checkin_data?.weight as number | undefined)
      const name = `${c.contact.firstname} ${c.contact.lastname}`

      if (y > 270) {
        doc.addPage()
        y = margin
      }

      doc.text(String(i + 1), margin + 2, y)
      doc.text(name, margin + 12, y)
      doc.text(weight != null ? `${weight} kg` : '—', margin + 90, y)
      doc.text(c.is_completed ? '✓' : '', margin + 120, y)
      y += 6
    }

    y += 4
  }

  // Total footer
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Total competitors: ${checkins.length}`, margin, y)

  doc.save(`${eventTitle.replace(/[^a-z0-9]/gi, '_')}_lineup.pdf`)
}
