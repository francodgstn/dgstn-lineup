'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, routableSurfaces } from '@linyup/shared'
import type { PublicSurface, SaasPlan, ActivePublicSurfaces } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'

// Single source of truth for the team's PUBLIC-facing surfaces — which channels
// are enabled/live and where they live. Consumed by the "Public page" hub and the
// bio-link page-link picker so both read identical availability (no drift).
//
// Distinction that matters: a plugin being *installed* (e.g. `coursesActive`) is
// not the same as a surface being *live* (`spaceLive` = plugin installed AND a
// published course exists). Plugin-install state comes from useInstalledPlugins;
// the live signal is the `active_public_surfaces` that syncTeamPublicProfile
// computes onto the team's world-readable public_profile doc (not the team doc).

export interface PublicSurfaceFlags {
  /** Stripe Connect on → memberships can be sold and checked out. */
  connectEnabled: boolean
  /** CAN THE STUDIO ACTUALLY BE PAID? `TeamPublicProfile.payments_enabled` — the
   *  SAME fact the public surfaces read, i.e. both halves the server enforces
   *  (chargeable account AND operator kill-switch up), where `connectEnabled`
   *  above sees only the account. Absent ⇒ false, like everywhere else.
   *  It is what tells a shop that is a TILL from a shop that is a read-only
   *  PRICE LIST — `shopLive` no longer answers that (see below). */
  paymentsEnabled: boolean
  /** `products` plugin installed. */
  productsActive: boolean
  /** `online-courses` plugin installed. */
  coursesActive: boolean
  /** `website` plugin installed. */
  websiteActive: boolean
  /** A published website exists (plugin + content) — the /site surface is live. */
  siteLive: boolean
  /** The contacts' personal portal (membership, bookings, profile, their courses).
   *  A base surface, decoupled from the course catalogue — effectively always live. */
  spaceLive: boolean
  /** The /shop surface is live. It ALWAYS is (`routableSurfaces`): with a
   *  chargeable Connect account it is a till, without one it is a read-only
   *  price list. `connectEnabled` above is the flag that tells the two apart —
   *  this one only says the page is publishable. */
  shopLive: boolean
  /** Booking is a base feature — always live. */
  bookingLive: boolean
  /** ≥1 public document MIRROR exists — the /documents surface is live.
   *  There is deliberately no `documentsActive` beside this: Documents is a
   *  default feature on every plan, so there is no install to be "active", and
   *  the two flags would only ever have disagreed by drifting. */
  documentsLive: boolean
  /** `custom-forms` plugin installed. */
  formsActive: boolean
  /** ≥1 published form exists (plugin + content) — the /forms surface is live. */
  formsLive: boolean
  /** `kiosk` plugin installed — the /kiosk check-in surface is live (it reads the
   *  team's own sessions, so install is the only gate; no published content). */
  kioskActive: boolean
}

export interface UsePublicSurfacesResult {
  slug: string | null
  /** Absolute base for public links (client origin); '' during SSR. */
  baseUrl: string
  /** Full public URL for a surface sub-path ('' | 'shop' | 'space' | …). */
  publicUrl: (subPath?: string) => string | null
  defaultSurface: PublicSurface
  setDefaultSurface: (surface: PublicSurface) => Promise<void>
  flags: PublicSurfaceFlags
  isAtLeast: (plan: SaasPlan) => boolean
}

export function usePublicSurfaces(): UsePublicSurfacesResult {
  const { currentTeamId, team } = useAuth()
  const { isInstalled } = useInstalledPlugins()
  const { isAtLeast } = usePlan()

  const slug = team?.slug ?? null
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  // Live-surface signals live on the public_profile (world-readable), not the
  // private team doc — read them once here, cached. `payments_enabled` comes
  // off the same doc in the same read: the studio's own screens should ask the
  // paid-ness question exactly the way its visitors' screens do.
  const { data: publicProfile } = useQuery<{
    active: Partial<ActivePublicSurfaces>
    paymentsEnabled: boolean
  }>({
    queryKey: ['public-surfaces', currentTeamId],
    enabled: !!currentTeamId,
    staleTime: 60_000,
    queryFn: async () => {
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, currentTeamId!, 'public_profile', currentTeamId!))
      return {
        active: (snap.data()?.active_public_surfaces ?? {}) as Partial<ActivePublicSurfaces>,
        paymentsEnabled: snap.data()?.payments_enabled === true,
      }
    },
  })
  const activeSurfaces = publicProfile?.active

  const publicUrl = useCallback(
    (subPath = '') => {
      if (!slug) return null
      const clean = subPath.replace(/^\/+/, '')
      return `${baseUrl}/public/${slug}${clean ? `/${clean}` : ''}`
    },
    [baseUrl, slug],
  )

  const flags: PublicSurfaceFlags = {
    connectEnabled: team?.payments?.connectStatus === 'enabled',
    paymentsEnabled: publicProfile?.paymentsEnabled ?? false,
    productsActive: isInstalled('products'),
    coursesActive: isInstalled('online-courses'),
    websiteActive: isInstalled('website'),
    siteLive: activeSurfaces?.site ?? false,
    spaceLive: activeSurfaces?.space ?? false,
    shopLive: routableSurfaces(activeSurfaces).shop ?? false,
    bookingLive: activeSurfaces?.booking ?? true,
    documentsLive: activeSurfaces?.documents ?? false,
    formsActive: isInstalled('custom-forms'),
    formsLive: activeSurfaces?.forms ?? false,
    kioskActive: isInstalled('kiosk'),
  }

  const defaultSurface: PublicSurface = team?.default_public_surface ?? 'bio-link'

  const setDefaultSurface = useCallback(
    async (surface: PublicSurface) => {
      if (!currentTeamId) return
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), { default_public_surface: surface })
    },
    [currentTeamId],
  )

  return { slug, baseUrl, publicUrl, defaultSurface, setDefaultSurface, flags, isAtLeast }
}
