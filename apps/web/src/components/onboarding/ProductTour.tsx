'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { markTourDone } from '@/lib/onboarding'
import 'driver.js/dist/driver.css'

// Event other components can dispatch to (re)start the tour on demand.
export const START_TOUR_EVENT = 'linyup:start-tour'

// Guards a single auto-start per SPA session (component remounts on navigation).
let autoStartedThisSession = false

/**
 * The first-run product tour.
 *
 * WHAT IT TEACHES (UX-47). It used to spend its steps on the CHROME — theme and
 * language, the nav container, the shortcuts block, quick search, How-to — and
 * never once said the words activities, sessions, bookings or payments. A
 * studio finished it knowing how to recolour the sidebar and nothing about the
 * product. It now walks the path a studio actually walks:
 *
 *     activity → session → booking → payment
 *
 * and ends at the setup checklist, which is that same path with the studio's
 * own data filled in.
 *
 * WHY THE ANCHORS ARE OPTIONAL. The nav's working areas are an ACCORDION — only
 * one of Run / Offer / Grow is open at a time, and the closed ones sit inside a
 * `grid-rows-[0fr]` panel, present in the DOM at zero height. Highlighting one
 * of those would frame nothing, so each product step attaches to its nav row
 * only when that row is actually visible, and otherwise runs as a centred card
 * (driver.js renders a step with no `element` that way). The tour therefore
 * says the same thing whatever the reader last had open — which is the property
 * a first-run explanation needs most.
 */

/** A step anchors to `selector` only if it is on screen — see the note above. */
function anchor(selector: string): { element?: string } {
  if (typeof document === 'undefined') return {}
  const el = document.querySelector(selector)
  if (!el) return {}
  const rect = el.getBoundingClientRect()
  return rect.height > 0 && rect.width > 0 ? { element: selector } : {}
}

export function ProductTour() {
  const t = useTranslations('Onboarding')
  const { user, profile, loading } = useAuth()

  useEffect(() => {
    let cancelled = false

    async function start(force: boolean) {
      if (typeof window === 'undefined' || !user) return
      // Never run inside an embedded preview (e.g. the landing-page iframe).
      if (window.self !== window.top) return
      // Anchors live in the desktop sidebar (hidden under md).
      if (window.innerWidth < 768) return
      if (!force) {
        if (loading || !profile) return
        if (autoStartedThisSession || profile.onboarding?.tourDone) return
      }
      // Bail if the app shell hasn't rendered yet. `nav-features` is the
      // working-areas container itself — always present and always visible,
      // unlike the individual rows inside it.
      if (!document.querySelector('[data-tour="nav-features"]')) return
      autoStartedThisSession = true

      const { driver } = await import('driver.js')
      if (cancelled) return

      const side = 'right' as const
      const align = 'start' as const

      const driverObj = driver({
        showProgress: true,
        nextBtnText: t('tour.next'),
        prevBtnText: t('tour.prev'),
        doneBtnText: t('tour.done'),
        steps: [
          { popover: { title: t('tour.welcomeTitle'), description: t('tour.welcomeBody') } },
          {
            ...anchor('[data-tour="nav-activities"]'),
            popover: {
              title: t('tour.activitiesTitle'),
              description: t('tour.activitiesBody'),
              side,
              align,
            },
          },
          {
            ...anchor('[data-tour="nav-calendar"]'),
            popover: {
              title: t('tour.sessionsTitle'),
              description: t('tour.sessionsBody'),
              side,
              align,
            },
          },
          {
            ...anchor('[data-tour="nav-bookings"]'),
            popover: {
              title: t('tour.bookingsTitle'),
              description: t('tour.bookingsBody'),
              side,
              align,
            },
          },
          {
            ...anchor('[data-tour="nav-payments"]'),
            popover: {
              title: t('tour.paymentsTitle'),
              description: t('tour.paymentsBody'),
              side,
              align,
            },
          },
          {
            // The dashboard card — present on /dashboard until it's finished or
            // dismissed; a centred card anywhere else.
            ...anchor('[data-tour="setup-checklist"]'),
            popover: {
              title: t('tour.checklistTitle'),
              description: t('tour.checklistBody'),
              side: 'bottom',
              align,
            },
          },
          {
            // `nav-howTo` has had no element since How-to moved into the
            // utility icon row, so this step reads as a centred card and its
            // copy names where the icon is rather than saying "here".
            ...anchor('[data-tour="nav-howTo"]'),
            popover: {
              title: t('tour.helpTitle'),
              description: t('tour.helpBody'),
              side,
              align,
            },
          },
        ],
        onDestroyed: () => {
          // Fires whether the user finished or closed early — mark done either way.
          void markTourDone(user.uid)
        },
      })
      driverObj.drive()
    }

    void start(false)

    const onStart = () => void start(true)
    window.addEventListener(START_TOUR_EVENT, onStart)
    return () => {
      cancelled = true
      window.removeEventListener(START_TOUR_EVENT, onStart)
    }
  }, [user, profile, loading, t])

  return null
}
