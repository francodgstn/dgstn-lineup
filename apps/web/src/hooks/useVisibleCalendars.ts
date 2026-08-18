'use client'

/**
 * SCHEDULE CALENDARS — a VIEW PREFERENCE, and deliberately nothing else.
 *
 * WHAT IT IS: which of the four things the Schedule can draw are currently
 * DRAWN — Classes, Appointments, Bookable hours, Events. The mental model is
 * the one every calendar app already taught the user: each is a CALENDAR you
 * tick on or off, not a filter that narrows the list down to one. Unticking one
 * is the same gesture as unticking a calendar in the sidebar of Google or Apple
 * Calendar.
 *
 * THE WORD IS "CALENDARS", not "layers". Layers is a drawing-tool word that no
 * studio arrives with; every app that ships this exact control calls the things
 * calendars. This shipped as "layers" for a few commits (994af302) and was
 * renamed through — code, copy and storage key — while the vocabulary was days
 * old. Do not reintroduce the old word.
 *
 * "CALENDARS" (the things shown) vs "CALENDAR" (the view, opposite of List).
 * The page has both, a few pixels apart. The plural is always used for these
 * four, and no label for them is ever the bare singular — see
 * `components/schedule/VisibleCalendarsMenu.tsx`.
 *
 * WHAT IT IS NOT: nav memory. It is **not** a member of the census owned by
 * `contexts/NavPinsContext.tsx` and must never be added there. That census
 * answers WHERE YOU GO (shortcuts, open tabs, recently viewed contacts) and
 * every entry in it is a destination or a record. This answers WHAT IS DRAWN on
 * one page. Folding a view preference into it would undo exactly the distinction
 * UX-23 drew, and the next reader would have to re-derive it.
 *
 * SCOPE. One page, one key, per browser — no team scoping, because a shown
 * calendar is not a fact about a tenant (unlike recently-viewed contacts, which
 * are people belonging to one team). A studio that hides one finds it hidden
 * tomorrow, on that browser, in every team it opens.
 *
 * THE STORAGE KEY WAS RENAMED WITH THE VOCABULARY, and no migration was
 * written. That is a decision, not an oversight: a browser holding the old
 * `linyup_schedule_layers` value simply falls back to the default set, which is
 * the DELIBERATE default (below) rather than an empty screen — and the value
 * being reset is a per-browser view preference that has existed for a few days,
 * pre-launch. A read-the-old-key shim would be machinery for a hypothesis.
 *
 * THE DEFAULT IS NOT "EVERYTHING". Classes, Appointments and Events are on;
 * **Bookable hours is off**. Published hours are a MANAGEMENT view — the answer
 * to "when am I sellable", asked while setting up a coach — not what a studio
 * wants behind its week every morning, and on a busy week several coaches'
 * windows are the thing most likely to make the grid unreadable. It is one click
 * away and it is remembered, so a studio that does want it every day pays that
 * click exactly once.
 *
 * A CALENDAR IS NEVER A COUNT. Nothing here may feed a header figure: the "N
 * upcoming" in the Schedule header comes from `useUpcomingCount`, its own
 * server-side count over its own window, precisely so it cannot move when the
 * view moves (UX-20). Hiding one changes what is drawn and nothing else.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

export const SCHEDULE_CALENDARS = ['classes', 'appointments', 'bookableHours', 'events'] as const
export type ScheduleCalendar = (typeof SCHEDULE_CALENDARS)[number]

/** See the header: everything except Bookable hours. */
export const DEFAULT_VISIBLE_CALENDARS: readonly ScheduleCalendar[] = [
  'classes',
  'appointments',
  'events',
]

const STORAGE_KEY = 'linyup_schedule_calendars'

function isCalendar(v: unknown): v is ScheduleCalendar {
  return typeof v === 'string' && (SCHEDULE_CALENDARS as readonly string[]).includes(v)
}

/** `null` = never stored. An empty array is a real answer ("I hid everything"). */
function readStored(): ScheduleCalendar[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isCalendar)
  } catch {
    return null
  }
}

function persist(calendars: ScheduleCalendar[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calendars))
  } catch {
    /* ignore (private mode, quota) */
  }
}

const sameSet = (a: readonly ScheduleCalendar[], b: readonly ScheduleCalendar[]) =>
  a.length === b.length && a.every((c) => b.includes(c))

export interface VisibleCalendarsValue {
  /** The calendars currently drawn. */
  visible: ReadonlySet<ScheduleCalendar>
  isVisible: (calendar: ScheduleCalendar) => boolean
  /** Show/hide one calendar. */
  toggle: (calendar: ScheduleCalendar) => void
  /** Shortcut: draw everything. */
  showAll: () => void
  /** Shortcut: back to DEFAULT_VISIBLE_CALENDARS. */
  resetToDefault: () => void
  /** In declaration order, so a message listing them reads the same every time. */
  hidden: ScheduleCalendar[]
  allVisible: boolean
  isDefault: boolean
}

export function useVisibleCalendars(): VisibleCalendarsValue {
  // Starts at the default and hydrates after mount — localStorage does not exist
  // during SSR, and reading it in the initialiser would hydrate-mismatch.
  const [calendars, setCalendars] = useState<ScheduleCalendar[]>(() => [
    ...DEFAULT_VISIBLE_CALENDARS,
  ])

  useEffect(() => {
    const stored = readStored()
    if (stored) setCalendars(stored)
  }, [])

  const write = useCallback((next: ScheduleCalendar[]) => {
    setCalendars(next)
    persist(next)
  }, [])

  const toggle = useCallback(
    (calendar: ScheduleCalendar) =>
      setCalendars((prev) => {
        const next = prev.includes(calendar)
          ? prev.filter((c) => c !== calendar)
          : SCHEDULE_CALENDARS.filter((c) => c === calendar || prev.includes(c))
        persist(next)
        return next
      }),
    []
  )

  const showAll = useCallback(() => write([...SCHEDULE_CALENDARS]), [write])
  const resetToDefault = useCallback(() => write([...DEFAULT_VISIBLE_CALENDARS]), [write])

  const visible = useMemo(() => new Set(calendars), [calendars])
  const isVisible = useCallback((calendar: ScheduleCalendar) => visible.has(calendar), [visible])
  const hidden = useMemo(
    () => SCHEDULE_CALENDARS.filter((c) => !visible.has(c)),
    [visible]
  )

  return {
    visible,
    isVisible,
    toggle,
    showAll,
    resetToDefault,
    hidden,
    allVisible: hidden.length === 0,
    isDefault: sameSet(calendars, DEFAULT_VISIBLE_CALENDARS),
  }
}
