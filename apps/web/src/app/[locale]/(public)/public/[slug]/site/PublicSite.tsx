'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { useLocale, useTranslations } from 'next-intl'
import { db } from '@/lib/firebase'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
import {
  SITE_PUBLISHED_COLLECTION,
  parseDocId,
  parseDateKey,
  parseSlug,
  resolveSiteSurfaceLinks,
} from '@linyup/shared'
import type { PublishedSite, PublicSurface } from '@linyup/shared'
import { useRouter } from '@/i18n/navigation'
import { publicHref, publicHrefLocalized } from '@/lib/publicRoutes'
import { usePublicTeam } from '../PublicTeamProvider'
import { usePublicContactAuth } from '../PublicContactAuthProvider'
import WebsiteRenderer from '@/components/site/WebsiteRenderer'
import { BookingOverlay, type BookIntent } from '@/components/booking/BookingOverlay'
import { takeBookingConfirmed } from '@/lib/bookingReturn'

// Resolves a published site by slug from the fully-public site_published
// collection — no auth, no restricted data. This is the single read a future
// headless website app (subdomain / custom domain) would perform.
//
// It is also the ONLY place in the website render chain that sits inside
// `PublicTeamProvider` (via the /public/[slug] layout) and outside the embed, so
// it is where the booking overlay is hosted. The builder canvas and the embed
// render the same blocks without a provider and must never receive `onBook`.
export default function PublicSite({ slug }: { slug: string }) {
  const { team } = usePublicTeam()
  const { isAuthenticated, contact, openSignIn } = usePublicContactAuth()
  const locale = useLocale()
  const router = useRouter()
  // Standalone nav labels, NOT PublicSurfaceLinks — those are sentence fragments
  // fused with a preposition ("zum Shop") for the "To {name}" back links.
  const tSurfaces = useTranslations('PublicSurfaceNav')
  const tSpace = useTranslations('Space')
  const [site, setSite] = useState<PublishedSite | null>(null)
  const [loading, setLoading] = useState(true)
  const [bookIntent, setBookIntent] = useState<BookIntent | null>(null)
  // The session a real, verified payment confirmed — NOT a boolean: pinning it to
  // the id stops the confirmation leaking onto a LATER, different booking if the
  // visitor opens another class while this page is still mounted.
  // Set only when /pay/result vouched for the payment, never from the `?booked=1`
  // query, which anyone can put in a link. See bookingReturn.ts.
  const [paidSessionId, setPaidSessionId] = useState<string | null>(null)

  useEffect(() => {
    const q = query(collection(db, SITE_PUBLISHED_COLLECTION), where('slug', '==', slug), limit(1))
    getDocs(q)
      .then((snap) => {
        if (!snap.empty) setSite(snap.docs[0].data() as PublishedSite)
      })
      .catch((err: unknown) => {
        reportPublicLoadFailure('site/published', err) // terminal not-found, but never silent
      })
      .finally(() => setLoading(false))
  }, [slug])

  // Reopen the overlay from the URL, so a refresh or a shared link lands the
  // visitor back where they were instead of on a bare website. Same param names
  // as the canonical /booking route — one contract, two hosts.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const apply = () => {
      const params = new URLSearchParams(window.location.search)
      if (!params.has('book')) {
        setBookIntent(null)
        return
      }
      // Attacker-supplied like any inbound param — a crafted link must not put
      // an arbitrary id into a Firestore path.
      const sessionId = parseDocId(params.get('session'))
      const appointmentId = parseDocId(params.get('appointment'))
      const activitySlug = parseSlug(params.get('activity'))
      setBookIntent(
        sessionId
          ? { kind: 'session', sessionId }
          : appointmentId
            ? {
                kind: 'appointment',
                activityId: appointmentId,
                providerId: parseDocId(params.get('provider')),
                date: parseDateKey(params.get('date')),
              }
            : activitySlug
              ? { kind: 'activity', activitySlug }
              : { kind: 'root' }
      )
    }
    apply()
    // Read-and-clear once on mount: a reload must not replay the confirmation.
    const onMount = new URLSearchParams(window.location.search)
    if (onMount.has('booked') && takeBookingConfirmed()) {
      setPaidSessionId(parseDocId(onMount.get('session')) ?? null)
    }
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  /** Mirror the open panel into the URL, so reload/share reopen the same thing. */
  const writeBookUrl = (intent: BookIntent, mode: 'push' | 'replace') => {
    const params = new URLSearchParams(window.location.search)
    params.set('book', '1')
    params.delete('session')
    params.delete('activity')
    params.delete('appointment')
    params.delete('provider')
    params.delete('date')
    if (intent.kind === 'session') params.set('session', intent.sessionId)
    if (intent.kind === 'activity') params.set('activity', intent.activitySlug)
    if (intent.kind === 'appointment') {
      params.set('appointment', intent.activityId)
      if (intent.providerId) params.set('provider', intent.providerId)
      if (intent.date) params.set('date', intent.date)
    }
    const url = `${window.location.pathname}?${params.toString()}`
    // Spread the existing state — the App Router keeps its route tree there.
    const state = { ...(window.history.state ?? {}) }
    if (mode === 'push') window.history.pushState(state, '', url)
    else window.history.replaceState(state, '', url)
  }

  // Opening pushes a history entry so Back closes the panel; closing pops it, so
  // the two stay symmetric and the stack never drifts.
  const openBooking = useCallback(
    (intent: BookIntent) => {
      setBookIntent(intent)
      writeBookUrl(intent, 'push')
    },
    []
  )

  /**
   * Swap the panel from the class funnel to the appointment picker in place.
   *
   * `replace`, not `push`: the visitor is refining the SAME booking intent, not
   * taking a step they should be able to Back out of into a half-state — Back
   * should still close the overlay in one press.
   */
  const switchToAppointments = useCallback((activityId: string) => {
    const intent: BookIntent = { kind: 'appointment', activityId }
    setBookIntent(intent)
    writeBookUrl(intent, 'replace')
  }, [])

  const closeBooking = useCallback(() => {
    setBookIntent(null)
    const params = new URLSearchParams(window.location.search)
    if (params.has('book')) {
      // Pop the entry `openBooking` pushed, so Back doesn't have to be pressed
      // twice and the site's own scroll position is restored.
      window.history.back()
    }
  }, [])

  // Cross-surface reachability, derived from what's actually live — no studio
  // configuration, no new data model. The website deliberately keeps its own
  // chrome (PublicContactBar opts out of /site), so these render as the site's
  // own palette-styled nav entries rather than the floating pill.
  const surfaceLinks = useMemo(() => {
    const live = team.active_public_surfaces
    const candidates: PublicSurface[] = ['shop', 'space', 'documents']
    const liveSurfaces = candidates.filter((s) => live?.[s as keyof typeof live])
    // Studio overrides (hide / relabel / reorder) applied over what's live.
    return resolveSiteSurfaceLinks(site?.meta.header, liveSurfaces, (s) => tSurfaces(s)).map(
      ({ surface, label }) => ({
        href: publicHrefLocalized(locale, slug, surface, { from: 'site' }),
        label,
      })
    )
  }, [team.active_public_surfaces, site?.meta.header, locale, slug, tSurfaces])

  const memberControl = useMemo(
    () =>
      // Absent ⇒ shown; only an explicit `false` hides it.
      site?.meta.header.showSignIn === false
        ? undefined
        : isAuthenticated && contact
          ? { label: tSpace('openSpace'), onClick: () => router.push(publicHref(slug, 'space')) }
          : { label: tSpace('signIn'), onClick: () => openSignIn() },
    [site?.meta.header.showSignIn, isAuthenticated, contact, tSpace, router, slug, openSignIn]
  )

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!site) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-lg font-semibold">Site not found</p>
        <p className="text-sm text-muted-foreground">No published website exists at this URL.</p>
      </div>
    )
  }

  return (
    <>
      <WebsiteRenderer
        site={site}
        onBook={openBooking}
        surfaceLinks={surfaceLinks}
        memberControl={memberControl}
      />
      <BookingOverlay
        slug={slug}
        intent={bookIntent}
        paidSessionId={paidSessionId}
        onSwitchToAppointments={switchToAppointments}
        onClose={closeBooking}
      />
    </>
  )
}
