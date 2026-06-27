'use client'

// "Public page" hub — the orientation layer for everything customer-facing. It
// keeps the deep management pages where they are and just makes the system
// legible: one screen showing your public URL, default landing, and every public
// surface (bio-link, shop, portal, website, booking, signup) with live/set-up
// status, a preview link, and a Manage/Set-up CTA that routes to the right place.
// Surface availability comes from the shared usePublicSurfaces hook.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import type { PublicSurface } from '@linyup/shared'
import { TEAMS_COLLECTION, PRODUCTS_SUBCOLLECTION, COURSES_COLLECTION } from '@linyup/shared'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Globe, ShoppingBag, GraduationCap, Package, Tag, CalendarCheck, UserPlus,
  ExternalLink, Copy, Check, ChevronRight, Plus, Settings2,
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

// One public surface = a card with status, a preview link, and a primary action.
function SurfaceCard({
  icon: Icon, title, desc, live, previewUrl, action, t, children,
}: {
  icon: React.ElementType
  title: string
  desc: string
  live: boolean
  previewUrl: string | null
  action: React.ReactNode
  t: (k: string) => string
  children?: React.ReactNode
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
      {children}
      <div className="mt-auto">{action}</div>
    </Card>
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

// A row inside the Shop card — one sellable channel (subscriptions / products / courses).
function ShopRow({
  icon: Icon, label, count, manageHref, setupPluginId, t,
}: {
  icon: React.ElementType
  label: string
  count: number | null
  manageHref: Route
  setupPluginId?: string
  t: (k: string) => string
}) {
  const enabled = !setupPluginId
  return (
    <Link
      href={enabled ? manageHref : pluginSetupHref(setupPluginId!)}
      className="group flex items-center gap-2.5 rounded-lg border px-3 py-2 hover:bg-muted/50 transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {enabled ? (
        <span className="text-xs text-muted-foreground tabular-nums">{count ?? 0}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Plus className="h-3 w-3" /> {t('setUp')}
        </span>
      )}
      <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground" />
    </Link>
  )
}

export default function PublicPageHub() {
  const t = useTranslations('PublicHub')
  const { currentTeamId } = useAuth()
  const { slug, publicUrl, defaultSurface, setDefaultSurface, flags } = usePublicSurfaces()

  const [copied, setCopied] = useState(false)
  const [pendingDefault, setPendingDefault] = useState<PublicSurface | null>(null)

  // Counts for the Shop card — small collections, read on demand.
  const { data: subTypes = [] } = useSubscriptionTypes(currentTeamId)
  const subCount = subTypes.length
  const { data: productCount = null } = useQuery({
    queryKey: ['public-hub', 'product-count', currentTeamId],
    enabled: !!currentTeamId && flags.productsActive,
    queryFn: async () =>
      (await getDocs(collection(db, TEAMS_COLLECTION, currentTeamId!, PRODUCTS_SUBCOLLECTION))).size,
  })
  const { data: courseCount = null } = useQuery({
    queryKey: ['public-hub', 'course-count', currentTeamId],
    enabled: !!currentTeamId && flags.coursesActive,
    queryFn: async () =>
      (await getDocs(query(collection(db, COURSES_COLLECTION), where('teamId', '==', currentTeamId)))).size,
  })

  const homeUrl = publicUrl('')
  const shopLive =
    subCount > 0 || (flags.productsActive && (productCount ?? 0) > 0) || (flags.coursesActive && (courseCount ?? 0) > 0)

  // Surfaces eligible to be the default landing (PublicSurface enum), gated to
  // live ones so we never set a dead default.
  const defaultOptions: { value: PublicSurface; label: string }[] = [
    { value: 'bio-link', label: t('surfaceBioLink') },
    ...(flags.spaceLive ? [{ value: 'space' as const, label: t('surfaceSpace') }] : []),
    ...(flags.siteLive ? [{ value: 'site' as const, label: t('surfaceWebsite') }] : []),
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

      {/* Surface cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Bio-link — the always-on root */}
        <SurfaceCard
          icon={Globe}
          title={t('surfaceBioLink')}
          desc={t('bioLinkDesc')}
          live
          previewUrl={homeUrl}
          action={<ManageLink href={'/team/bio-link' as Route} label={t('manage')} />}
          t={t}
        />

        {/* Shop — finally a backend home: its three channels in one place */}
        <SurfaceCard
          icon={ShoppingBag}
          title={t('surfaceShop')}
          desc={t('shopDesc')}
          live={shopLive}
          previewUrl={publicUrl('shop')}
          action={null}
          t={t}
        >
          <div className="flex flex-col gap-1.5">
            <ShopRow icon={Tag} label={t('shopSubscriptions')} count={subCount}
              manageHref={'/offer/subscriptions' as Route} t={t} />
            <ShopRow icon={Package} label={t('shopProducts')} count={productCount}
              manageHref={'/offer/products' as Route}
              setupPluginId={flags.productsActive ? undefined : 'products'} t={t} />
            <ShopRow icon={GraduationCap} label={t('shopCourses')} count={courseCount}
              manageHref={'/offer/online-courses' as Route}
              setupPluginId={flags.coursesActive ? undefined : 'online-courses'} t={t} />
          </div>
        </SurfaceCard>

        {/* Space / Portal — currently the course library, the first portal module */}
        <SurfaceCard
          icon={GraduationCap}
          title={t('surfaceSpace')}
          desc={t('spaceDesc')}
          live={flags.spaceLive}
          previewUrl={publicUrl('space')}
          action={
            flags.coursesActive
              ? <ManageLink href={'/offer/online-courses' as Route} label={t('manageCourses')} />
              : <SetupLink href={pluginSetupHref('online-courses')} label={t('setUp')} />
          }
          t={t}
        />

        {/* Website */}
        <SurfaceCard
          icon={Globe}
          title={t('surfaceWebsite')}
          desc={t('websiteDesc')}
          live={flags.siteLive}
          previewUrl={publicUrl('site')}
          action={
            flags.websiteActive
              ? <ManageLink href={'/plugins/website' as Route} label={t('manage')} />
              : <SetupLink href={pluginSetupHref('website')} label={t('setUp')} />
          }
          t={t}
        />

        {/* Booking — base feature, always live */}
        <SurfaceCard
          icon={CalendarCheck}
          title={t('surfaceBooking')}
          desc={t('bookingDesc')}
          live={flags.bookingLive}
          previewUrl={publicUrl('booking')}
          action={<ManageLink href={'/settings/booking' as Route} label={t('manage')} />}
          t={t}
        />

        {/* Signup — membership capture */}
        <SurfaceCard
          icon={UserPlus}
          title={t('surfaceSignup')}
          desc={t('signupDesc')}
          live
          previewUrl={publicUrl('signup')}
          action={<ManageLink href={'/offer/subscriptions' as Route} label={t('manage')} />}
          t={t}
        />
      </div>
    </div>
  )
}
