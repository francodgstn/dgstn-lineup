'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Globe, Menu, X } from 'lucide-react'
import type { SiteMeta, WebsiteSection, OrgSiteSection, OrgSiteTeamRef, SocialLink } from '@linyup/shared'
import { buildPalette, FONT_STACK, ctaHref } from './theme'
import { SectionBlock, sectionNavLabel, bookProps, SOCIAL_ICONS, type RenderCtx } from './sections'
import type { BookIntent } from '@/components/booking/BookingOverlay'

/** Structural subset satisfied by SiteDraft/PublishedSite (team sites, builder
 *  preview) AND OrgSiteDraft/OrgPublishedSite (org sites). `teamId` is only
 *  present on team-shaped sites; org sites pass their scope via the separate
 *  `orgId`/`orgTeams` props below instead of through `site`. */
export interface RenderableSite {
  teamId?: string
  name: string
  slug: string
  meta: SiteMeta
  sections: (WebsiteSection | OrgSiteSection)[]
  socialLinks?: SocialLink[]
  showBranding?: boolean
}

export default function WebsiteRenderer({
  site,
  preview = false,
  orgId,
  orgTeams,
  onBook,
  surfaceLinks,
  memberControl,
  paymentsEnabled,
}: {
  site: RenderableSite
  preview?: boolean
  /** Org sites only — the org id and its embedded member-team snapshot. */
  orgId?: string
  orgTeams?: OrgSiteTeamRef[]
  /**
   * Opens the booking overlay in place. Only the live team site passes this;
   * optional so the builder canvas, the org site and the embed — none of which
   * have a `PublicTeamProvider` — keep working untouched.
   */
  onBook?: (intent: BookIntent) => void
  /**
   * Cross-surface links (shop, Space, …) derived by the host from
   * `active_public_surfaces`. Optional so the builder canvas, the org site and
   * the embed — none of which resolve a team — are untouched.
   */
  surfaceLinks?: { href: string; label: string }[]
  /** "Sign in" / "Hi Anna" — the host owns the contact session. */
  memberControl?: { label: string; onClick: () => void }
  /** Whether the studio has a chargeable Stripe Connect account. Passed only by
   *  the live team site (the one host that resolves the team) — see
   *  RenderCtx.paymentsEnabled for why absent is not the same as false. */
  paymentsEnabled?: boolean
}) {
  const locale = useLocale()
  const t = useTranslations('Site')
  const [systemDark, setSystemDark] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

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
    palette,
    slug: site.slug,
    locale,
    teamId: site.teamId,
    orgId,
    orgTeams,
    preview,
    paymentsEnabled,
    socialLinks: site.socialLinks,
    // Second, independent guard (bookProps checks `preview` too): the builder
    // renders this component inside /(auth) with NO PublicTeamProvider, so a
    // leaked onBook would make the overlay throw and blank the canvas.
    onBook: preview ? undefined : onBook,
  }

  const navItems = site.meta.header.showNav
    ? site.sections
        .filter((s) => s.type !== 'hero' && s.showInNav !== false)
        .map((s) => ({ id: s.id, label: sectionNavLabel(s, t) }))
        .filter((n) => n.label)
    : []
  const hasMenu = navItems.length > 0 || !!site.meta.header.ctaLabel

  const inert = (e: React.MouseEvent) => e.preventDefault()

  const headerAction = site.meta.header.ctaAction ?? 'booking'
  const headerHref = site.meta.header.ctaLabel
    ? ctaHref({ action: headerAction, url: site.meta.header.ctaUrl }, site.slug, locale)
    : undefined

  // The header CTA is the most-clicked booking entry on the whole site, so it
  // opens the overlay like every other one. Signup/external CTAs stay plain
  // navigations. Null when this isn't a booking CTA.
  const headerBookProps =
    headerAction === 'booking' ? bookProps(headerHref, ctx, { kind: 'root' }) : null

  /** Plain-navigation fallback, matching the nav links' preview behaviour. */
  const headerLinkProps = { href: preview ? undefined : headerHref, onClick: preview ? inert : undefined }

  const socials = (site.socialLinks ?? []).filter((s) => s.url)
  const year = new Date().getFullYear()

  return (
    <div className="@container min-h-full w-full" style={{ background: palette.bg, color: palette.text, fontFamily: font }}>
      {/* Header */}
      <header
        className="sticky top-0 z-20 backdrop-blur"
        style={{ background: palette.headerBg, borderBottom: `1px solid ${palette.border}` }}
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
          <nav className="hidden items-center gap-5 @3xl:flex">
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
                {...(headerBookProps ?? headerLinkProps)}
                className="rounded-full px-4 py-1.5 text-sm font-semibold"
                style={{ background: palette.accent, color: palette.onAccent }}
              >
                {site.meta.header.ctaLabel}
              </a>
            )}
            {/* Derived from active_public_surfaces — a member on the website
                previously had no route to their Space or the shop at all. */}
            {surfaceLinks?.map((l) => (
              <a
                key={l.href}
                href={preview ? undefined : l.href}
                onClick={preview ? inert : undefined}
                className="text-sm transition-opacity hover:opacity-70"
                style={{ color: palette.muted }}
              >
                {l.label}
              </a>
            ))}
            {memberControl && (
              <button
                type="button"
                onClick={preview ? undefined : memberControl.onClick}
                className="text-sm font-medium transition-opacity hover:opacity-70"
                style={{ color: palette.accent }}
              >
                {memberControl.label}
              </button>
            )}
          </nav>

          {/* Mobile hamburger */}
          {hasMenu && (
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Menu"
              aria-expanded={mobileOpen}
              className="flex h-9 w-9 items-center justify-center rounded-md transition-opacity hover:opacity-70 @3xl:hidden"
              style={{ color: palette.text }}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>

        {/* Mobile menu panel */}
        {hasMenu && mobileOpen && (
          <div
            className="@3xl:hidden"
            style={{ background: palette.bg, borderTop: `1px solid ${palette.border}` }}
          >
            <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-3">
              {navItems.map((n) => (
                <a
                  key={n.id}
                  href={preview ? undefined : `#${n.id}`}
                  onClick={(e) => {
                    if (preview) inert(e)
                    setMobileOpen(false)
                  }}
                  className="rounded-md py-2 text-sm transition-opacity hover:opacity-70"
                  style={{ color: palette.muted }}
                >
                  {n.label}
                </a>
              ))}
              {site.meta.header.ctaLabel && (
                <a
                  {...(headerBookProps ?? headerLinkProps)}
                  onClick={(e) => {
                    // Dismiss the menu first, then let the CTA do its thing —
                    // otherwise the overlay opens behind an open mobile menu.
                    setMobileOpen(false)
                    if (headerBookProps) headerBookProps.onClick?.(e)
                    else if (preview) inert(e)
                  }}
                  className="mt-2 rounded-full px-4 py-2 text-center text-sm font-semibold"
                  style={{ background: palette.accent, color: palette.onAccent }}
                >
                  {site.meta.header.ctaLabel}
                </a>
              )}
              {surfaceLinks?.map((l) => (
                <a
                  key={l.href}
                  href={preview ? undefined : l.href}
                  onClick={(e) => {
                    if (preview) inert(e)
                    setMobileOpen(false)
                  }}
                  className="rounded-md py-2 text-sm transition-opacity hover:opacity-70"
                  style={{ color: palette.muted }}
                >
                  {l.label}
                </a>
              ))}
              {memberControl && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false)
                    if (!preview) memberControl.onClick()
                  }}
                  className="rounded-md py-2 text-left text-sm font-medium transition-opacity hover:opacity-70"
                  style={{ color: palette.accent }}
                >
                  {memberControl.label}
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      <main id="top">
        {site.sections.map((s: WebsiteSection | OrgSiteSection) => (
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
              {t('poweredBy')}{' '}
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
