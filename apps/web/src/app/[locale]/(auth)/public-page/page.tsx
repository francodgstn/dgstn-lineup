'use client'

// "Public pages" hub — the orientation layer for everything customer-facing. It
// keeps the deep management pages where they are and just makes the system
// legible. Layout is hero + list:
//
//  • Hero — the one thing every studio owner comes here for: their public link
//    (copy/open) and which surface visitors land on. This is the page's anchor.
//  • Surface list — every public surface as a compact row (icon · title · desc ·
//    preview · single CTA). Live surfaces read full-strength with a "Live" marker
//    and sort first; not-yet-set-up ones are dimmed and sink below. Rows beat a
//    card grid here because the page is a directory: hierarchy (link first, live
//    channels next, untapped ones quietly available) matters more than symmetry.
//
// Surface availability comes from usePublicSurfaces. Richer per-surface content
// (Shop channels, Space content) lives on the surface's own detail page.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import type { PublicSurface } from '@linyup/shared'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Globe, Monitor, MonitorCheck, ShoppingBag, GraduationCap, CalendarCheck, UserPlus,
  ClipboardList, FileText, ExternalLink, Copy, Check, Plus, Settings2,
} from 'lucide-react'

// Plugin a surface needs; clicking "Set up" deep-links the plugins page, whose
// modal handles the included / add-on / upgrade flow for the current plan.
function pluginSetupHref(pluginId: string): Route {
  return `/settings/plugins?plugin=${pluginId}` as Route
}

function ManageLink({ href, label }: { href: Route; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
    >
      <Settings2 className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}

function SetupLink({ href, label }: { href: Route; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
    >
      <Plus className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}

// One public surface = one compact row. Live rows read full-strength with a
// "Live" marker; not-live rows dim so the eye lands on what's actually public.
function SurfaceRow({
  icon: Icon, title, desc, live, previewUrl, action, t,
}: {
  icon: React.ElementType
  title: string
  desc: string
  live: boolean
  previewUrl: string | null
  action: React.ReactNode
  t: (k: string) => string
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4 ${live ? '' : 'opacity-65'}`}>
      <div
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
          live ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-tight">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground leading-snug">{desc}</p>
      </div>
      {live && (
        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-600 sm:inline-flex dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {t('statusLive')}
        </span>
      )}
      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t('preview')}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
      <div className="shrink-0">{action}</div>
    </div>
  )
}

type SurfaceDef = {
  key: string
  icon: React.ElementType
  title: string
  desc: string
  live: boolean
  previewUrl: string | null
  action: React.ReactNode
}

export default function PublicPageHub() {
  const t = useTranslations('PublicHub')
  const { slug, publicUrl, defaultSurface, setDefaultSurface, flags } = usePublicSurfaces()

  const [copied, setCopied] = useState(false)
  const [pendingDefault, setPendingDefault] = useState<PublicSurface | null>(null)

  const homeUrl = publicUrl('')

  // Surfaces eligible to be the default landing: every available page that has a
  // single landing URL. Base surfaces (bio-link, booking, signup) are always
  // offered; plugin/content surfaces appear once live. Forms are excluded — they
  // have no index page to land on (only per-form URLs). Mirrors the surface list
  // order below.
  const defaultOptions: { value: PublicSurface; label: string }[] = [
    { value: 'bio-link', label: t('surfaceBioLink') },
    ...(flags.siteLive ? [{ value: 'site' as const, label: t('surfaceWebsite') }] : []),
    ...(flags.shopLive ? [{ value: 'shop' as const, label: t('surfaceShop') }] : []),
    ...(flags.spaceLive ? [{ value: 'space' as const, label: t('surfaceSpace') }] : []),
    { value: 'booking', label: t('surfaceBooking') },
    { value: 'signup', label: t('surfaceSignup') },
    ...(flags.documentsLive ? [{ value: 'documents' as const, label: t('surfaceDocuments') }] : []),
  ]
  const currentDefault = pendingDefault ?? defaultSurface

  async function copyUrl() {
    if (!homeUrl) return
    try {
      await navigator.clipboard.writeText(homeUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  async function onDefaultChange(surface: PublicSurface) {
    setPendingDefault(surface)
    await setDefaultSurface(surface)
  }

  // Every public surface, in one list. Landing surfaces first (they're what a
  // visitor can be dropped on at /public/{slug}), then the standalone pages.
  // Shop and Space route to their own detail pages; the rest link straight to
  // their existing editors. The list is re-sorted live-first at render.
  const surfaces: SurfaceDef[] = [
    {
      key: 'bio-link', icon: Globe, title: t('surfaceBioLink'), desc: t('bioLinkDesc'),
      live: true, previewUrl: homeUrl,
      action: <ManageLink href={'/team/bio-link' as Route} label={t('manage')} />,
    },
    {
      key: 'website', icon: Monitor, title: t('surfaceWebsite'), desc: t('websiteDesc'),
      live: flags.siteLive, previewUrl: publicUrl('site'),
      action: flags.websiteActive
        ? <ManageLink href={'/plugins/website' as Route} label={t('manage')} />
        : <SetupLink href={pluginSetupHref('website')} label={t('setUp')} />,
    },
    {
      key: 'shop', icon: ShoppingBag, title: t('surfaceShop'), desc: t('shopDesc'),
      live: flags.shopLive, previewUrl: publicUrl('shop'),
      action: <ManageLink href={'/public-page/shop' as Route} label={t('manage')} />,
    },
    {
      key: 'space', icon: GraduationCap, title: t('surfaceSpace'), desc: t('spaceDesc'),
      live: flags.spaceLive, previewUrl: publicUrl('space'),
      action: <ManageLink href={'/public-page/space' as Route} label={t('manage')} />,
    },
    {
      key: 'booking', icon: CalendarCheck, title: t('surfaceBooking'), desc: t('bookingDesc'),
      live: flags.bookingLive, previewUrl: publicUrl('booking'),
      action: <ManageLink href={'/settings/booking' as Route} label={t('manage')} />,
    },
    {
      key: 'kiosk', icon: MonitorCheck, title: t('surfaceKiosk'), desc: t('kioskDesc'),
      live: flags.kioskActive, previewUrl: publicUrl('kiosk'),
      action: flags.kioskActive
        ? <ManageLink href={'/plugins/kiosk' as Route} label={t('manage')} />
        : <SetupLink href={pluginSetupHref('kiosk')} label={t('setUp')} />,
    },
    {
      key: 'signup', icon: UserPlus, title: t('surfaceSignup'), desc: t('signupDesc'),
      live: true, previewUrl: publicUrl('signup'),
      action: <ManageLink href={'/offer/subscriptions' as Route} label={t('manage')} />,
    },
    {
      key: 'forms', icon: ClipboardList, title: t('surfaceForms'), desc: t('formsDesc'),
      live: flags.formsLive, previewUrl: null,
      action: flags.formsActive
        ? <ManageLink href={'/plugins/custom-forms' as Route} label={t('manage')} />
        : <SetupLink href={pluginSetupHref('custom-forms')} label={t('setUp')} />,
    },
    {
      key: 'documents', icon: FileText, title: t('surfaceDocuments'), desc: t('documentsDesc'),
      live: flags.documentsLive, previewUrl: publicUrl('documents'),
      action: flags.documentsActive
        ? <ManageLink href={'/plugins/documents' as Route} label={t('manage')} />
        : <SetupLink href={pluginSetupHref('documents')} label={t('setUp')} />,
    },
  ]

  // Live-first, preserving the defined order within each group. Stable sort keeps
  // landing surfaces ahead of standalone pages inside each half.
  const orderedSurfaces = [...surfaces].sort((a, b) => Number(b.live) - Number(a.live))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Hero — public link + default landing */}
      <Card className="p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Globe className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('yourPublicUrl')}</p>
              {homeUrl ? (
                <div className="mt-1 flex items-center gap-2">
                  <code className="truncate rounded bg-muted px-2 py-1 text-sm font-medium">{`/public/${slug}`}</code>
                  <button
                    type="button"
                    onClick={copyUrl}
                    title={t('copy')}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a
                    href={homeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('open')}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t('noSlug')}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 md:border-l md:pl-5">
            <span className="text-xs font-medium text-muted-foreground">{t('defaultLanding')}</span>
            <Select value={currentDefault} onValueChange={(v) => { if (v) onDefaultChange(v) }}>
              <SelectTrigger className="w-[150px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {defaultOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('defaultLandingHint')}</p>
      </Card>

      {/* Surface list — one row per public surface, live-first */}
      <Card className="gap-0 py-0">
        <div className="divide-y divide-border">
          {orderedSurfaces.map((s) => (
            <SurfaceRow
              key={s.key}
              icon={s.icon}
              title={s.title}
              desc={s.desc}
              live={s.live}
              previewUrl={s.previewUrl}
              action={s.action}
              t={t}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}
