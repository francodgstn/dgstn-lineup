'use client'

import { createContext, useContext, type ReactNode } from 'react'

// ─── Booking chrome ───────────────────────────────────────────────────────────
//
// The public booking funnels (class `BookingForm`, `AppointmentPicker`) render in
// two places: as a full page at /public/{slug}/booking|appointments, and as an
// overlay on top of the studio's website. The flow logic is identical; only the
// frame and the meaning of "leave the flow" differ.
//
// This context is that seam. Its DEFAULT value is exactly the page behaviour, so
// the route variants need no provider at all and are unaffected.

export type ChromeKind = 'page' | 'overlay'

export interface BookingChromeValue {
  kind: ChromeKind
  /**
   * Overlay only. "Leave the flow" means CLOSE, not navigate — the visitor came
   * from the website behind the panel and expects to land back on it.
   */
  onClose?: () => void
  /**
   * How the flow leaves for a different route (Stripe). Overlay hosts remember
   * where to come back to before handing off.
   */
  navigate: (href: string) => void
  /**
   * Swap the CLASS funnel for the APPOINTMENT one, in place.
   *
   * Appointments are a separate flow (a per-provider slot picker), but from the
   * visitor's point of view picking "Personal Training" off the activity list is
   * just the next step — bouncing them to a full page mid-overlay is jarring.
   * Only overlay hosts provide this; page chrome leaves it undefined and the
   * flow navigates as before.
   */
  switchToAppointments?: (activityId: string) => void
}

const PAGE_CHROME: BookingChromeValue = {
  kind: 'page',
  navigate: (href) => {
    if (typeof window !== 'undefined') window.location.href = href
  },
}

const BookingChromeContext = createContext<BookingChromeValue>(PAGE_CHROME)

/** Defaults to page chrome, so an unwrapped flow behaves exactly as before. */
export function useBookingChrome(): BookingChromeValue {
  return useContext(BookingChromeContext)
}

export function BookingChromeProvider({
  value,
  children,
}: {
  value: BookingChromeValue
  children: ReactNode
}) {
  return <BookingChromeContext.Provider value={value}>{children}</BookingChromeContext.Provider>
}
