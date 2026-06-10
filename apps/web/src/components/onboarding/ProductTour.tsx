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
 * Phase 3 of the onboarding initiative: a short guided tour anchored to the
 * sidebar nav. Auto-runs once for new users (no onboarding.tourDone), and can
 * be replayed via the START_TOUR_EVENT (account menu → "Replay tour").
 *
 * Mounted in the authenticated layout so the nav anchors exist on any page.
 * The tour highlights sidebar items, which are hidden below the md breakpoint,
 * so it only runs on wider viewports.
 */
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
      // Bail if the nav hasn't rendered yet.
      if (!document.querySelector('[data-tour="nav-activities"]')) return
      autoStartedThisSession = true

      const { driver } = await import('driver.js')
      if (cancelled) return

      const driverObj = driver({
        showProgress: true,
        nextBtnText: t('tour.next'),
        prevBtnText: t('tour.prev'),
        doneBtnText: t('tour.done'),
        // Order mirrors the setup flow: activities first (required for scheduling).
        steps: [
          { popover: { title: t('tour.welcomeTitle'), description: t('tour.welcomeBody') } },
          { element: '[data-tour="nav-activities"]', popover: { title: t('tour.activitiesTitle'), description: t('tour.activitiesBody'), side: 'right', align: 'start' } },
          { element: '[data-tour="nav-calendar"]', popover: { title: t('tour.calendarTitle'), description: t('tour.calendarBody'), side: 'right', align: 'start' } },
          { element: '[data-tour="nav-contacts"]', popover: { title: t('tour.contactsTitle'), description: t('tour.contactsBody'), side: 'right', align: 'start' } },
          { element: '[data-tour="nav-portal"]', popover: { title: t('tour.portalTitle'), description: t('tour.portalBody'), side: 'right', align: 'start' } },
          { element: '[data-tour="nav-automations"]', popover: { title: t('tour.automationsTitle'), description: t('tour.automationsBody'), side: 'right', align: 'start' } },
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
