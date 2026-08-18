'use client'

// THE LAYER ROW — "which calendars are shown", not "filter the list down to one".
//
// This row used to be a single-select filter: All | Classes | Appointments |
// Events, exactly one lit at a time, so seeing classes AND appointments but not
// events was not expressible. Every calendar app the user already owns models
// this as a list of calendars you tick on and off, and that is what this is now:
// four independent layers, plus the two shortcuts that make a set of toggles
// usable — SHOW ALL, and RESET (back to the default set).
//
// "All" disappeared as a chip in the process, which is the point: it was a
// fifth, mutually-exclusive member pretending to be the absence of a filter.
// Its job is done by "Show all", which is an ACTION, sits with the other action,
// and disables itself once everything is already shown.
//
// Bookable hours is the one layer with a surface it cannot draw on — the LIST
// has no representation of a published window (a window is not an entry, it is
// the absence of one). Rather than let the chip lie there, it is disabled in
// list view and says why.

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  CALENDAR_LAYERS,
  type CalendarLayer,
  type CalendarLayersValue,
} from '@/hooks/useCalendarLayers'

interface Props {
  layers: CalendarLayersValue
  /** Bookable hours only draws on the calendar — see the header. */
  calendarView: boolean
  /** Called when a layer is switched OFF, so the page can drop sub-filters that
   *  only make sense while it is shown (the class activity picker). */
  onLayerHidden?: (layer: CalendarLayer) => void
}

export function CalendarLayerChips({ layers, calendarView, onLayerHidden }: Props) {
  const t = useTranslations('Calendar')

  const label: Record<CalendarLayer, string> = {
    classes: t('filterClasses'),
    appointments: t('filterAppointments'),
    bookableHours: t('bookableHours'),
    events: t('filterEvents'),
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {CALENDAR_LAYERS.map((layer) => {
        const shown = layers.isVisible(layer)
        const calendarOnly = layer === 'bookableHours' && !calendarView
        const chip = (
          <button
            key={layer}
            type="button"
            role="switch"
            aria-checked={shown}
            aria-label={shown ? t('layerHide', { layer: label[layer] }) : t('layerShow', { layer: label[layer] })}
            disabled={calendarOnly}
            onClick={() => {
              layers.toggle(layer)
              if (shown) onLayerHidden?.(layer)
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              shown
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
              calendarOnly && 'pointer-events-none opacity-40'
            )}
          >
            {/* Filled square = drawn, hollow = hidden. The same tick-box idiom
                every calendar sidebar uses, so the chip states its meaning
                without the row needing a heading. */}
            <span
              aria-hidden
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-[3px] border-[1.5px] border-current',
                shown && 'bg-current'
              )}
            />
            {label[layer]}
          </button>
        )
        // A disabled button does not receive hover in every browser, so the
        // explanation hangs on a wrapper rather than on the control itself.
        return calendarOnly ? (
          <span key={layer} title={t('layerCalendarOnly')}>
            {chip}
          </span>
        ) : (
          chip
        )
      })}

      <span aria-hidden className="mx-1 h-4 w-px self-center bg-border" />

      <button
        type="button"
        onClick={layers.showAll}
        disabled={layers.allVisible}
        className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {t('layersShowAll')}
      </button>
      <button
        type="button"
        onClick={layers.resetToDefault}
        disabled={layers.isDefault}
        className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {t('layersReset')}
      </button>
    </div>
  )
}
