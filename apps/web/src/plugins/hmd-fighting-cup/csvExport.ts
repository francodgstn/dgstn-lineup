import type { EventCheckin, EventCategory } from '@linyup/shared'

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/**
 * Competitors CSV: one row per check-in with weight and assigned category names.
 * Richer than the generic check-in CSV (which only has name + status). Opens
 * directly in Excel / Sheets. Mirrors the legacy HMD "Export all participants".
 */
export function exportFightingCupCsv(
  checkins: EventCheckin[],
  categories: EventCategory[],
  eventTitle: string,
) {
  const nameById = new Map(categories.map((c) => [c.id, c.name]))

  const rows: string[][] = [
    ['Last name', 'First name', 'Weight (kg)', 'Categories', 'Status', 'Checked in at'],
  ]

  for (const c of checkins) {
    const weight = c.checkin_data?.weight as number | undefined
    const catIds = (c.checkin_data?.categories as string[] | undefined) ?? []
    const catNames = catIds.map((id) => nameById.get(id) ?? id).join(', ')
    const at = c.created_at
      ? (c.created_at as { toDate(): Date }).toDate().toLocaleString()
      : ''
    rows.push([
      c.contact.lastname,
      c.contact.firstname,
      weight != null ? String(weight) : '',
      catNames,
      c.is_completed ? 'Confirmed' : 'Pending',
      at,
    ])
  }

  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${eventTitle.replace(/[^a-z0-9]/gi, '_')}_competitors.csv`
  a.click()
  URL.revokeObjectURL(url)
}
