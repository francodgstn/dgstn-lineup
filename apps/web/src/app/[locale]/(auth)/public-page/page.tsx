'use client'

// "Public pages" hub — the orientation layer for everything customer-facing. It
// keeps the deep management pages where they are and just makes the system
// legible: one screen showing your public URL, default landing, and every public
// surface with live/set-up status, a preview link, and a Manage/Set-up CTA that
// routes to the right place. Surface availability comes from usePublicSurfaces.
//
// Cards are deliberately uniform (icon · title · status · one-line desc · preview
// · single CTA) so the grid stays balanced; richer per-surface content (Shop
// channels, Space content) lives on the surface's own detail page.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import type { PublicSurface } from '@linyup/shared'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Globe, Monitor, ShoppingBag, GraduationCap, CalendarCheck, UserPlus,
  ClipboardList, FileText, ExternalLink, Copy, Check, Plus, Settings2,
} from 'lucide-react'

// Plugin a surface needs; clicking "Set up" deep-links the plugins page, whose
// modal handles the included / add-on / upgrade flow for the current plan.
function pluginSetupHref(pluginId: string): Route {
  return `/settings/plugins?plugin=${pluginId}` as Route
}

function StatusChip({ live, t }: { live: boolean; t: (k: string) => string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        live
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
      {live ? t('statusLive') : t('statusSetup')}
    </span>
  )
}

function ManageLink({ href, label }: { href: Route; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
    >
      <Settings2 className="h-3.5 w-3.5" />
      {label}
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
      {label}
    </Link>
  )
}

// One public surface = a uniform card: status, a preview link, and a single CTA.
function SurfaceCard({
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
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium leading-tight">{title}</p>
            <StatusChip live={live} t={t} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{desc}</p>
        </div>
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
      </div>
      <div className="mt-auto">{action}</div>
    </Card>
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

  // Surfaces eligible to be the default landing (PublicSurface enum), gated to
  // live ones so we never set a dead default.
  const defaultOptions: { value: PublicSurface; label: string }[] = [
    { value: 'bio-link', label: t('surfaceBioLink') },
    ...(flags.spaceLive ? [{ value: 'space' as const, label: t('surfaceSpace') }] : []),
    ...(flags.siteLive ? [{ value: 'site' as const, label: t('surfaceWebsite') }] : []),
    ...(flags.shopLive ? [{ value: 'shop' as const, label: t('surfaceShop') }] : []),
    { value: 'booking', label: t('surfaceBooking') },
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

  // Landing surfaces = those a visitor can be dropped on at /public/{slug}
  // (the PublicSurface enum / default-landing options). Shop and Space route to
  // their own detail pages; the rest link straight to their existing editors.
  const landing: SurfaceDef[] = [
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
  ]

  // Additional pages = standalone public pages that aren't landing targets.
  const additional: SurfaceDef[] = [
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

  const groups: { title: string; items: SurfaceDef[] }[] = [
    { title: t('groupLanding'), items: landing },
    { title: t('groupAdditional'), items: additional },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Public URL + default landing */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('yourPublicUrl')}</p>
            <div className="mt-1 flex items-center gap-2">
              {homeUrl ? (
                <>
                  <code className="truncate rounded bg-muted px-2 py-1 text-sm">{`/public/${slug}`}</code>
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
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noSlug')}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
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
        <p className="mt-2 text-xs text-muted-foreground">{t('defaultLandingHint')}</p>
      </Card>

      {/* Surface cards, grouped */}
      {groups.map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((s) => (
              <SurfaceCard
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
        </section>
      ))}
    </div>
  )
}
