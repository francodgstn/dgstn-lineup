'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'
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
  /** `products` plugin installed. */
  productsActive: boolean
  /** `online-courses` plugin installed. */
  coursesActive: boolean
  /** `website` plugin installed. */
  websiteActive: boolean
  /** A published website exists (plugin + content) — the /site surface is live. */
  siteLive: boolean
  /** A published course exists (plugin + content) — the /space portal is live. */
  spaceLive: boolean
  /** A sellable channel is enabled — the /shop surface is live. */
  shopLive: boolean
  /** Booking is a base feature — always live. */
  bookingLive: boolean
  /** `documents` plugin installed. */
  documentsActive: boolean
  /** ≥1 published + public Document exists (plugin + content) — the /documents surface is live. */
  documentsLive: boolean
  /** `custom-forms` plugin installed. */
  formsActive: boolean
  /** ≥1 published form exists (plugin + content) — the /forms surface is live. */
  formsLive: boolean
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
  // private team doc — read them once here, cached.
  const { data: activeSurfaces } = useQuery<Partial<ActivePublicSurfaces>>({
    queryKey: ['public-surfaces', currentTeamId],
    enabled: !!currentTeamId,
    staleTime: 60_000,
    queryFn: async () => {
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, currentTeamId!, 'public_profile', currentTeamId!))
      return (snap.data()?.active_public_surfaces ?? {}) as Partial<ActivePublicSurfaces>
    },
  })

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
    productsActive: isInstalled('products'),
    coursesActive: isInstalled('online-courses'),
    websiteActive: isInstalled('website'),
    siteLive: activeSurfaces?.site ?? false,
    spaceLive: activeSurfaces?.space ?? false,
    shopLive: activeSurfaces?.shop ?? false,
    bookingLive: activeSurfaces?.booking ?? true,
    documentsActive: isInstalled('documents'),
    documentsLive: activeSurfaces?.documents ?? false,
    formsActive: isInstalled('custom-forms'),
    formsLive: activeSurfaces?.forms ?? false,
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
