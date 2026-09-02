'use client'

import { Button } from '@/components/ui/button'
import { Download, FileText } from 'lucide-react'
import type { EventCheckin } from '@linyup/shared'
import { useFightingCupCategories } from './useCategories'
import { exportFightingCupPdf } from './pdfExport'
import { exportFightingCupCsv } from './csvExport'
import { Tip } from '@/components/ui/tip'

/**
 * Lineup export buttons for fighting-cup events. Rendered by CheckinPanel in the
 * check-in toolbar (in place of the generic CSV button) whenever the event type
 * is backed by a plugin that declares hasPdfExport / hasCsvExport.
 */
export function Exports({
  eventId,
  eventTitle,
  eventDate,
  checkins,
}: {
  eventId: string
  eventTitle: string
  eventDate: string
  checkins: EventCheckin[]
}) {
  const { data: categories = [] } = useFightingCupCategories(eventId)
  const disabled = checkins.length === 0

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => exportFightingCupCsv(checkins, categories, eventTitle)}
      >
        <Download className="h-3.5 w-3.5 mr-1.5" />
        Export CSV
      </Button>
      <Tip label={categories.length === 0 ? 'Add categories first' : undefined}>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || categories.length === 0}
          onClick={() => exportFightingCupPdf(checkins, categories, eventTitle, eventDate)}
          aria-label={categories.length === 0 ? 'Add categories first' : undefined}
        >
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          Lineup PDF
        </Button>
      </Tip>
    </>
  )
}
