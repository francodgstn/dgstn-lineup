'use client'

// THE CALENDARS CONTROL — "which calendars are shown", not "filter the list
// down to one".
//
// This began as a single-select filter (All | Classes | Appointments | Events,
// exactly one lit), became four independent chips, and is now ONE chip that
// opens a menu of checkboxes. Each step fixed a different lie:
//
//  - single-select could not express "classes AND appointments but not events";
//  - four chips in a row beside the coach chip read as four filters OF THE SAME
//    KIND as the coach one, when the coach chip was a single-select filter and
//    these are visibility toggles. Same row, same shape, two different
//    grammars — which is exactly what a studio cannot be expected to infer.
//
// So the four now sit behind one trigger that has the coach chip's shape, and
// the caret is what says "there is more behind this". Inside, the classical
// checkbox idiom every calendar sidebar already taught the user.
//
// THE WORD IS "CALENDARS". It shipped as "layers" for a few commits and was
// renamed through — a layer is a drawing-tool word no studio arrives with, and
// Google and Apple both call precisely this checklist "calendars". See
// `hooks/useVisibleCalendars.ts`.
//
// "CALENDARS" vs "CALENDAR VIEW" — the page has a Calendar/List view toggle a
// few pixels above this chip, so the overload is real and is handled by never
// letting a label here be the bare singular. The trigger says "All calendars",
// or names the ones drawn; the menu is headed "Calendars shown"; and the one
// sentence that has to mention the view says "calendar view" in full, next to
// "the list", so the contrast is on the page rather than in the reader's head.
//
// THE TRIGGER NAMES WHAT IS DRAWN, always — one grammar, never a bare noun.
// "All calendars" when everything is on, the calendar's own name when exactly
// one is, the names joined when it is two or three, "No calendars" when the
// studio has switched everything off (a real, reachable state that must say so
// out loud). A static "Calendars" would tell the studio nothing, and a count
// ("3 of 4") tells it a number instead of a fact; with four short names there is
// no reason to summarise what can simply be said. The coach chip set this
// precedent — it shows the current selection, not the word "Coach".
//
// LIT MEANS "you have hidden something BEYOND the considered default". Not
// merely "something is hidden": bookable hours is off by default on purpose, so
// that rule would leave the chip permanently lit and the signal would mean
// nothing. Not "not all shown" either, for the same reason. And showing
// everything is the least restricted state there is, so it is not lit either.
//
// Bookable hours is the one calendar with a surface it cannot draw on — the
// LIST has no representation of a published window (a window is not an entry,
// it is the absence of one). Its row is therefore disabled in list view AND
// says why on a second line: a disabled control never receives hover, so an
// explanation that lives in a tooltip is an explanation nobody reads.
//
// No colour swatches, deliberately. The grid colours events by event TYPE and
// availability bands by COACH — there is no per-calendar colour anywhere on it,
// so a swatch here would be a new mapping that matches nothing the studio can
// see. The icons are the ones the "+ New" menu already uses for the same four
// things, so recognition carries across the two menus.

import { useTranslations } from 'next-intl'
import { CalendarClock, CalendarDays, CalendarRange, ChevronDown, Eye, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SCHEDULE_CALENDARS,
  type ScheduleCalendar,
  type VisibleCalendarsValue,
} from '@/hooks/useVisibleCalendars'

/** The same icons the "+ New" menu uses for the same four things. */
const CALENDAR_ICON: Record<ScheduleCalendar, LucideIcon> = {
  classes: CalendarDays,
  appointments: User,
  bookableHours: CalendarClock,
  events: CalendarRange,
}

interface Props {
  calendars: VisibleCalendarsValue
  /** Bookable hours only draws on the calendar view — see the header. */
  calendarView: boolean
  /** Called when a calendar is switched OFF, so the page can drop sub-filters
   *  that only make sense while it is shown (the class activity picker). */
  onCalendarHidden?: (calendar: ScheduleCalendar) => void
}

export function VisibleCalendarsMenu({ calendars, calendarView, onCalendarHidden }: Props) {
  const t = useTranslations('Calendar')

  const label: Record<ScheduleCalendar, string> = {
    classes: t('filterClasses'),
    appointments: t('filterAppointments'),
    bookableHours: t('bookableHours'),
    events: t('filterEvents'),
  }

  const shown = SCHEDULE_CALENDARS.filter((c) => calendars.isVisible(c))
  const triggerLabel = calendars.allVisible
    ? t('calendars.all')
    : shown.length === 0
      ? t('calendars.none')
      : shown.map((c) => label[c]).join(', ')

  // See the header: the default hides one on purpose, so "something is hidden"
  // is not news — "you hid something beyond the default" is.
  const lit = !calendars.allVisible && !calendars.isDefault

  return (
    <DropdownMenu>
      {/* Same shape as the coach chip beside it — the two are peers in this row
          and must not be hand-sized independently. The eye is deliberately not a
          calendar glyph: the view toggle a few pixels above already owns those,
          and this control is about visibility, which is also what the
          hidden-calendars notice's EyeOff says. */}
      <DropdownMenuTrigger
        aria-label={t('calendars.heading')}
        title={triggerLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
          lit
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:text-foreground'
        )}
      >
        <Eye className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[13rem] truncate">{triggerLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {/* The group is NOT decoration. `DropdownMenuLabel` is Base UI's
            `Menu.GroupLabel`, which THROWS ("MenuGroupRootContext is missing")
            if it is not inside a `Menu.Group` — a runtime crash on first open
            that typecheck, lint and the production build all pass straight
            over, because the popup only mounts when the menu is opened. It also
            happens to be the right structure: the heading labels the four
            checkboxes, not the two actions below the separator. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('calendars.heading')}</DropdownMenuLabel>
          {SCHEDULE_CALENDARS.map((calendar) => {
            const visible = calendars.isVisible(calendar)
            const calendarOnly = calendar === 'bookableHours' && !calendarView
            const Icon = CALENDAR_ICON[calendar]
            return (
              <DropdownMenuCheckboxItem
                key={calendar}
                checked={visible}
                disabled={calendarOnly}
                // Ticking one must not dismiss the menu — a studio setting up
                // its week ticks two or three in a row. (Base UI's CheckboxItem
                // already defaults `closeOnClick` to false; stated here so a
                // future primitive swap does not silently change it.)
                closeOnClick={false}
                onCheckedChange={() => {
                  calendars.toggle(calendar)
                  if (visible) onCalendarHidden?.(calendar)
                }}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{label[calendar]}</span>
                  {/* Not a tooltip: a disabled row never receives hover. */}
                  {calendarOnly && (
                    <span className="text-xs text-muted-foreground">
                      {t('calendars.calendarViewOnly')}
                    </span>
                  )}
                </span>
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuGroup>

        {/* The two ACTIONS, separated from the checkboxes because they are a
            different kind of thing: a checkbox states one calendar, these two
            set the whole set at once. Show all is RECOVERY ("I cannot find my
            week"); reset returns the DELIBERATE default, which is not the same
            state — it puts bookable hours back off. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={calendars.showAll} disabled={calendars.allVisible}>
          {t('calendars.showAll')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={calendars.resetToDefault} disabled={calendars.isDefault}>
          {t('calendars.resetDefault')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
