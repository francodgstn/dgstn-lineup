'use client'

/**
 * SCHEDULE CALENDAR LAYERS — a VIEW PREFERENCE, and deliberately nothing else.
 *
 * WHAT IT IS: which of the four things the Schedule can draw are currently
 * DRAWN — Classes, Appointments, Bookable hours, Events. The mental model is
 * the one every calendar app already taught the user: a chip is "is this
 * calendar shown", not "filter the list down to this". Toggling one is the same
 * gesture as unticking a calendar in the sidebar of Google/Apple Calendar.
 *
 * WHAT IT IS NOT: nav memory. It is **not** a member of the census owned by
 * `contexts/NavPinsContext.tsx` and must never be added there. That census
 * answers WHERE YOU GO (shortcuts, open tabs, recently viewed contacts) and
 * every entry in it is a destination or a record. This answers WHAT IS DRAWN on
 * one page. Folding a view preference into it would undo exactly the distinction
 * UX-23 drew, and the next reader would have to re-derive it.
 *
 * SCOPE. One page, one key, per browser — no team scoping, because a layer is
 * not a fact about a tenant (unlike recently-viewed contacts, which are people
 * belonging to one team). A studio that hides a layer finds it hidden tomorrow,
 * on that browser, in every team it opens.
 *
 * THE DEFAULT IS NOT "EVERYTHING". Classes, Appointments and Events are on;
 * **Bookable hours is off**. Published hours are a MANAGEMENT view — the answer
 * to "when am I sellable", asked while setting up a coach — not what a studio
 * wants behind its week every morning, and on a busy week several coaches'
 * windows are the layer most likely to make the grid unreadable. It is one click
 * away and it is remembered, so a studio that does want it every day pays that
 * click exactly once.
 *
 * A LAYER IS NEVER A COUNT. Nothing here may feed a header figure: the "N
 * upcoming" in the Schedule header comes from `useUpcomingCount`, its own
 * server-side count over its own window, precisely so it cannot move when the
 * view moves (UX-20). Hiding a layer changes what is drawn and nothing else.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

export const CALENDAR_LAYERS = ['classes', 'appointments', 'bookableHours', 'events'] as const
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number]

/** See the header: everything except Bookable hours. */
export const DEFAULT_CALENDAR_LAYERS: readonly CalendarLayer[] = ['classes', 'appointments', 'events']

const STORAGE_KEY = 'linyup_schedule_layers'

function isLayer(v: unknown): v is CalendarLayer {
  return typeof v === 'string' && (CALENDAR_LAYERS as readonly string[]).includes(v)
}

/** `null` = never stored. An empty array is a real answer ("I hid everything"). */
function readStored(): CalendarLayer[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isLayer)
  } catch {
    return null
  }
}

function persist(layers: CalendarLayer[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layers))
  } catch {
    /* ignore (private mode, quota) */
  }
}

const sameSet = (a: readonly CalendarLayer[], b: readonly CalendarLayer[]) =>
  a.length === b.length && a.every((l) => b.includes(l))

export interface CalendarLayersValue {
  /** The layers currently drawn. */
  visible: ReadonlySet<CalendarLayer>
  isVisible: (layer: CalendarLayer) => boolean
  /** Show/hide one layer. */
  toggle: (layer: CalendarLayer) => void
  /** Shortcut: draw everything. */
  showAll: () => void
  /** Shortcut: back to DEFAULT_CALENDAR_LAYERS. */
  resetToDefault: () => void
  /** In declaration order, so a message listing them reads the same every time. */
  hiddenLayers: CalendarLayer[]
  allVisible: boolean
  isDefault: boolean
}

export function useCalendarLayers(): CalendarLayersValue {
  // Starts at the default and hydrates after mount — localStorage does not exist
  // during SSR, and reading it in the initialiser would hydrate-mismatch.
  const [layers, setLayers] = useState<CalendarLayer[]>(() => [...DEFAULT_CALENDAR_LAYERS])

  useEffect(() => {
    const stored = readStored()
    if (stored) setLayers(stored)
  }, [])

  const write = useCallback((next: CalendarLayer[]) => {
    setLayers(next)
    persist(next)
  }, [])

  const toggle = useCallback(
    (layer: CalendarLayer) =>
      setLayers((prev) => {
        const next = prev.includes(layer)
          ? prev.filter((l) => l !== layer)
          : CALENDAR_LAYERS.filter((l) => l === layer || prev.includes(l))
        persist(next)
        return next
      }),
    []
  )

  const showAll = useCallback(() => write([...CALENDAR_LAYERS]), [write])
  const resetToDefault = useCallback(() => write([...DEFAULT_CALENDAR_LAYERS]), [write])

  const visible = useMemo(() => new Set(layers), [layers])
  const isVisible = useCallback((layer: CalendarLayer) => visible.has(layer), [visible])
  const hiddenLayers = useMemo(() => CALENDAR_LAYERS.filter((l) => !visible.has(l)), [visible])

  return {
    visible,
    isVisible,
    toggle,
    showAll,
    resetToDefault,
    hiddenLayers,
    allVisible: hiddenLayers.length === 0,
    isDefault: sameSet(layers, DEFAULT_CALENDAR_LAYERS),
  }
}
