'use client'

import { useEffect, useRef, useState } from 'react'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { EMBED_WIDGETS_COLLECTION, SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import type {
  EmbedWidgetSet,
  PublishedSite,
  WebsiteSection,
  SiteMeta,
  SiteFont,
  SocialLink,
} from '@linyup/shared'
import { SectionBlock, type RenderCtx } from '@/components/site/sections'
import { buildPalette, FONT_STACK } from '@/components/site/theme'

// What we render once resolution settles, independent of where it came from.
interface Resolved {
  section: WebsiteSection
  themeMeta: { theme: SiteMeta['theme']; accentColor?: string }
  font: SiteFont
  transparent: boolean
  slug: string
  teamId: string
  socialLinks?: SocialLink[]
}

/**
 * Renders a single embeddable section in isolation, chrome-less, for iframing
 * into a studio's own website. Resolves **widget-first**: a standalone widget
 * (embed_widgets/{teamId}, authored without building a Linyup site) wins; if none
 * matches the id we fall back to a published site section (site_published) so
 * snippets created from the website builder keep working. Both reads are fully
 * public (no auth, public mirrors only) and reuse the same SectionBlock renderer.
 *
 * Reports its content height to the parent frame so public/embed.js can size the
 * host iframe (live sections like schedule/pricing load data async, growing the
 * height after first paint).
 */
export default function EmbedSection({ slug, sectionId }: { slug: string; sectionId: string }) {
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [loading, setLoading] = useState(true)
  const [systemDark, setSystemDark] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      // 1) Standalone widget (decoupled from any published site).
      try {
        const wsnap = await getDocs(
          query(collection(db, EMBED_WIDGETS_COLLECTION), where('slug', '==', slug), limit(1))
        )
        if (!wsnap.empty) {
          const set = wsnap.docs[0].data() as EmbedWidgetSet
          const w = set.widgets?.find((x) => x.id === sectionId && !x.hidden)
          if (w) {
            if (!cancelled) {
              setResolved({
                section: w,
                themeMeta: { theme: w.theme?.theme ?? 'light', accentColor: w.theme?.accentColor },
                font: w.theme?.font ?? 'sans',
                transparent: w.theme?.background === 'transparent',
                slug: set.slug,
                teamId: set.teamId,
                socialLinks: set.socialLinks,
              })
              setLoading(false)
            }
            return
          }
        }
      } catch {
        /* fall through to site sections */
      }

      // 2) Fall back to a published site section.
      try {
        const ssnap = await getDocs(
          query(collection(db, SITE_PUBLISHED_COLLECTION), where('slug', '==', slug), limit(1))
        )
        if (!ssnap.empty) {
          const site = ssnap.docs[0].data() as PublishedSite
          const sec = site.sections.find((s) => s.id === sectionId && !s.hidden)
          if (sec && !cancelled) {
            setResolved({
              section: sec,
              themeMeta: { theme: site.meta.theme, accentColor: site.meta.accentColor },
              font: site.meta.font,
              transparent: false,
              slug: site.slug,
              teamId: site.teamId,
              socialLinks: site.socialLinks,
            })
          }
        }
      } catch {
        /* leave unresolved → unavailable */
      }
      if (!cancelled) setLoading(false)
    }

    run()
    return () => {
      cancelled = true
    }
  }, [slug, sectionId])

  // Resolve the 'auto' theme against the viewer's system preference.
  useEffect(() => {
    if (resolved?.themeMeta.theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [resolved?.themeMeta.theme])

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
  }, [slug, sectionId, resolved, loading])

  if (loading) return <div ref={rootRef} style={{ minHeight: 1 }} />

  if (!resolved) {
    return (
      <div
        ref={rootRef}
        style={{ padding: '16px', fontFamily: 'system-ui, sans-serif', fontSize: 14, color: '#64748b' }}
      >
        This section is unavailable.
      </div>
    )
  }

  const palette = buildPalette(resolved.themeMeta, systemDark)
  const font = FONT_STACK[resolved.font] ?? FONT_STACK.sans
  const ctx: RenderCtx = {
    palette,
    slug: resolved.slug,
    teamId: resolved.teamId,
    preview: false,
    socialLinks: resolved.socialLinks,
  }

  // `@container` so the sections' container-query variants (@2xl:, @3xl:) respond
  // to the iframe width, exactly as they do inside WebsiteRenderer. A transparent
  // background lets the host page show through so the widget blends in.
  return (
    <div
      ref={rootRef}
      className="@container"
      style={{
        background: resolved.transparent ? 'transparent' : palette.bg,
        color: palette.text,
        fontFamily: font,
      }}
    >
      <SectionBlock section={resolved.section} ctx={ctx} />
    </div>
  )
}
