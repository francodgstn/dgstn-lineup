'use client'

import { useEffect, useRef, useState } from 'react'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import type { PublishedSite } from '@linyup/shared'
import { SectionBlock, type RenderCtx } from '@/components/site/sections'
import { buildPalette, FONT_STACK } from '@/components/site/theme'

/**
 * Renders a single published website section in isolation for embedding. Reuses
 * the exact public read from PublicSite (site_published by slug — no auth, no
 * restricted data) and the same SectionBlock renderer + theme helpers the full
 * site uses, minus the header/footer/nav chrome.
 *
 * Reports its content height to the parent frame on every layout change so
 * public/embed.js can size the host iframe to fit (live sections like schedule
 * and pricing load their data async, which grows the height after first paint).
 */
export default function EmbedSection({ slug, sectionId }: { slug: string; sectionId: string }) {
  const [site, setSite] = useState<PublishedSite | null>(null)
  const [loading, setLoading] = useState(true)
  const [systemDark, setSystemDark] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Single public read — mirrors PublicSite.tsx.
  useEffect(() => {
    const q = query(
      collection(db, SITE_PUBLISHED_COLLECTION),
      where('slug', '==', slug),
      limit(1)
    )
    getDocs(q)
      .then((snap) => {
        if (!snap.empty) setSite(snap.docs[0].data() as PublishedSite)
      })
      .catch(() => {
        /* leave null → unavailable */
      })
      .finally(() => setLoading(false))
  }, [slug])

  // Mirror WebsiteRenderer's auto-theme handling.
  useEffect(() => {
    if (site?.meta.theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [site?.meta.theme])

  // Tell the parent how tall we are (embed.js resizes the iframe to match).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const post = () => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      window.parent?.postMessage({ type: 'linyup:embed:height', slug, sectionId, height }, '*')
    }
    post()
    const ro = new ResizeObserver(post)
    ro.observe(el)
    return () => ro.disconnect()
  }, [slug, sectionId, site, loading])

  if (loading) return <div ref={rootRef} style={{ minHeight: 1 }} />

  const section = site?.sections.find((s) => s.id === sectionId && !s.hidden)
  if (!site || !section) {
    return (
      <div
        ref={rootRef}
        style={{ padding: '16px', fontFamily: 'system-ui, sans-serif', fontSize: 14, color: '#64748b' }}
      >
        This section is unavailable.
      </div>
    )
  }

  const palette = buildPalette(site.meta, systemDark)
  const font = FONT_STACK[site.meta.font] ?? FONT_STACK.sans
  const ctx: RenderCtx = {
    palette,
    slug: site.slug,
    teamId: site.teamId,
    preview: false,
    socialLinks: site.socialLinks,
  }

  // `@container` so the sections' container-query variants (@2xl:, @3xl:) respond
  // to the iframe width, exactly as they do inside WebsiteRenderer.
  return (
    <div
      ref={rootRef}
      className="@container"
      style={{ background: palette.bg, color: palette.text, fontFamily: font }}
    >
      <SectionBlock section={section} ctx={ctx} />
    </div>
  )
}
