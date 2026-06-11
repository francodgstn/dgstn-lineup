'use client'

import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import type { SiteMeta, WebsiteSection, SocialLink } from '@linyup/shared'
import { buildPalette, FONT_STACK, ctaHref } from './theme'
import { SectionBlock, sectionNavLabel, SOCIAL_ICONS, type RenderCtx } from './sections'

/** Structural subset satisfied by both SiteDraft (builder preview) and
 *  PublishedSite (public route). */
export interface RenderableSite {
  teamId: string
  name: string
  slug: string
  meta: SiteMeta
  sections: WebsiteSection[]
  socialLinks?: SocialLink[]
  showBranding?: boolean
}

export default function WebsiteRenderer({
  site,
  preview = false,
}: {
  site: RenderableSite
  preview?: boolean
}) {
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    if (site.meta.theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [site.meta.theme])

  const palette = buildPalette(site.meta, systemDark)
  const font = FONT_STACK[site.meta.font] ?? FONT_STACK.sans
  const ctx: RenderCtx = {
    palette, slug: site.slug, teamId: site.teamId, preview, socialLinks: site.socialLinks,
  }

  const navItems = site.meta.header.showNav
    ? site.sections
        .filter((s) => s.type !== 'hero')
        .map((s) => ({ id: s.id, label: sectionNavLabel(s) }))
        .filter((n) => n.label)
    : []

  const headerHref = site.meta.header.ctaLabel
    ? ctaHref(
        { action: site.meta.header.ctaAction ?? 'booking', url: site.meta.header.ctaUrl },
        site.slug,
      )
    : undefined

  const socials = (site.socialLinks ?? []).filter((s) => s.url)
  const year = new Date().getFullYear()
  const inert = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="min-h-full w-full" style={{ background: palette.bg, color: palette.text, fontFamily: font }}>
      {/* Header */}
      <header
        className="sticky top-0 z-20 backdrop-blur"
        style={{ background: `${palette.bg}d9`, borderBottom: `1px solid ${palette.border}` }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <a
            href={preview ? undefined : '#top'}
            onClick={preview ? inert : undefined}
            className="font-bold tracking-tight"
            style={{ color: palette.text }}
          >
            {site.meta.title || site.name}
          </a>
          <nav className="hidden items-center gap-5 md:flex">
            {navItems.map((n) => (
              <a
                key={n.id}
                href={preview ? undefined : `#${n.id}`}
                onClick={preview ? inert : undefined}
                className="text-sm transition-opacity hover:opacity-70"
                style={{ color: palette.muted }}
              >
                {n.label}
              </a>
            ))}
            {site.meta.header.ctaLabel && (
              <a
                href={preview ? undefined : headerHref}
                onClick={preview ? inert : undefined}
                className="rounded-full px-4 py-1.5 text-sm font-semibold"
                style={{ background: palette.accent, color: palette.onAccent }}
              >
                {site.meta.header.ctaLabel}
              </a>
            )}
          </nav>
        </div>
      </header>

      <main id="top">
        {site.sections.map((s: WebsiteSection) => (
          <SectionBlock key={s.id} section={s} ctx={ctx} />
        ))}
      </main>

      {/* Footer */}
      <footer className="py-10" style={{ background: palette.surface, borderTop: `1px solid ${palette.border}` }}>
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 text-center">
          {site.meta.footer.showSocial && socials.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {socials.map((s) => {
                const Icon = SOCIAL_ICONS[s.platform] ?? Globe
                return (
                  <a
                    key={s.platform}
                    href={preview ? undefined : s.url}
                    onClick={preview ? inert : undefined}
                    target={preview ? undefined : '_blank'}
                    rel={preview ? undefined : 'noopener noreferrer'}
                    aria-label={s.platform}
                    className="flex h-9 w-9 items-center justify-center rounded-full border transition-opacity hover:opacity-70"
                    style={{ borderColor: palette.border, color: palette.text }}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                )
              })}
            </div>
          )}
          <p className="text-sm" style={{ color: palette.muted }}>© {year} {site.name}</p>
          {site.showBranding && (
            <p className="text-xs" style={{ color: palette.muted }}>
              Powered by{' '}
              <a
                href={preview ? undefined : 'https://linyup.com'}
                onClick={preview ? inert : undefined}
                target={preview ? undefined : '_blank'}
                rel="noopener noreferrer"
                className="font-medium hover:underline"
                style={{ color: palette.muted }}
              >
                Linyup
              </a>
            </p>
          )}
        </div>
      </footer>
    </div>
  )
}
