'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Download, FileText } from 'lucide-react'
import type { EventCheckin } from '@linyup/shared'
import { useRankingSystems } from '@/hooks/useRankingSystems'
import { useFightingCupCategories } from './useCategories'
import { useCompetitorDetails } from './useCompetitorDetails'
import { exportFightingCupPdf } from './pdfExport'
import { exportFightingCupCsv } from './csvExport'
import { Tip } from '@/components/ui/tip'

/**
 * Lineup export buttons for fighting-cup events. Rendered by CheckinPanel in the
 * check-in toolbar (in place of the generic CSV button) whenever the event type
 * is backed by a plugin that declares hasPdfExport / hasCsvExport.
 *
 * The PDF wants age, belt and club, which the check-in document does not carry —
 * see `useCompetitorDetails`. That query runs alongside this toolbar rather than
 * on the click, so the sheet is ready when somebody asks for it; the button
 * stays usable while it loads and prints blanks in those three columns if it
 * never arrives, because a sheet with gaps beats no sheet at the table.
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
  const t = useTranslations('FightingCup')
  const { data: categories = [] } = useFightingCupCategories(eventId)
  const { rankingSystems } = useRankingSystems()
  const { data: details } = useCompetitorDetails(
    checkins,
    rankingSystems,
    new Date(eventDate) instanceof Date && !Number.isNaN(new Date(eventDate).getTime())
      ? new Date(eventDate)
      : new Date()
  )
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
        {t('exportCsv')}
      </Button>
      <Tip label={categories.length === 0 ? t('addCategoriesFirst') : undefined}>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || categories.length === 0}
          onClick={() =>
            exportFightingCupPdf(checkins, categories, eventTitle, eventDate, details, {
              category: t('colCategory'),
              gender: t('colGender'),
              ageRange: t('colAgeRange'),
              competitors: t('colCompetitors'),
              group: t('colGroup'),
              lastname: t('colLastname'),
              firstname: t('colFirstname'),
              age: t('colAge'),
              belt: t('colBelt'),
              weight: t('colWeight'),
              club: t('colClub'),
              cat: t('colCat'),
              entered: t('entered'),
              total: t('totalCompetitors'),
            })
          }
          aria-label={categories.length === 0 ? t('addCategoriesFirst') : undefined}
        >
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          {t('lineupPdf')}
        </Button>
      </Tip>
    </>
  )
}
