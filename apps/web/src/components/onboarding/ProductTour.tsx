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
 * WHAT IT TEACHES. Three steps over the sidebar's three regions, in the order a
 * reader meets them:
 *
 *     the working areas -> quick access -> search and the utilities
 *
 * It is deliberately SHORT. An earlier version spent seven steps walking
 * activity -> session -> booking -> payment with a step each; the substance of
 * that path now lives in the working-areas step's copy, which names it, while
 * the steps themselves stay on the one thing a first run has to deliver — where
 * things are. (UX-47's objection was that a tour taught the CHROME and never
 * said the words activities, sessions, bookings or payments. Naming them here is
 * what keeps that fixed; the copy keys for the per-stage steps are retained, so
 * they can come back as steps if this proves too thin.)
 *
 * WHY THE ANCHORS ARE STILL OPTIONAL. Every region below is always rendered, so
 * in practice all three anchor. `anchor()` stays because the sidebar is hidden
 * under `md` and because a future step may point at something conditional —
 * driver.js renders a step with no `element` as a centred card, which is a
 * degradation worth keeping rather than a crash.
 *
 * TWO ANCHORS DIED WHEN THE NAV AND DASHBOARD CHANGED, and both are gone from
 * the step list rather than left to silently centre themselves:
 *   - `setup-checklist` — the component was deleted when the new dashboard
 *     replaced the old one, so its step described a card that no longer exists.
 *   - `nav-howTo` — How-to has been an icon in the utility row for a while, and
 *     is now inside the collapsed "More" flyout as well. It is covered by the
 *     utilities step instead.
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
            // THE WORKING AREAS, as one region. Anchored to the container, not
            // to a row inside it: Run / Offer / Grow is an accordion, so any
            // single row may be collapsed to zero height, and a step that
            // frames nothing is worse than one that frames the whole group.
            // Naming the path in the copy is how this keeps UX-47's lesson —
            // the reader is told what the sections are FOR, not just that they
            // exist.
            ...anchor('[data-tour="nav-features"]'),
            popover: {
              title: t('tour.featuresTitle'),
              description: t('tour.featuresBody'),
              side,
              align,
            },
          },
          {
            // The head tiles and Shortcuts, framed together — see the wrapper's
            // note in the sidebar. Always present, so this step always anchors.
            ...anchor('[data-tour="nav-quick-access"]'),
            popover: {
              title: t('tour.quickAccessTitle'),
              description: t('tour.quickAccessBody'),
              side,
              align,
            },
          },
          {
            // Search plus the three occasional destinations beside it. One step,
            // because they are one row — and because collapsing the sidebar
            // folds the last three behind a single "More" control, which a step
            // per icon could not describe.
            ...anchor('[data-tour="nav-utilities"]'),
            popover: {
              title: t('tour.utilitiesTitle'),
              description: t('tour.utilitiesBody'),
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
