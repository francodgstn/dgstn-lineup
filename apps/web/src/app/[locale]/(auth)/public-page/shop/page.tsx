'use client'

// Shop settings — the storefront, as a SECTION of Public pages. Holds the
// sellable channels (subscriptions / products / courses) that used to crowd the
// hub card, plus payments (Stripe Connect) and the storefront currency. Content
// itself is still managed under Offer; this is about the shop as a public
// surface.
//
// It renders inside the settings shell (see ../layout.tsx) alongside the hub and
// Space. That pane is narrower than the full page this used to be, so the two
// sections STACK rather than sitting side by side — a two-column grid of
// three-row lists inside a detail pane gives each column about half the width it
// needs and reads as cramped, which is the opposite of the problem the move was
// solving. Each section's rows are gathered into one divided panel, the shape
// settings/booking and the activity form use.

import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { TEAMS_COLLECTION, PRODUCTS_SUBCOLLECTION, COURSES_COLLECTION } from '@linyup/shared'
import { PageHeader } from '@/components/layout/PageHeader'
import { PaymentSettingsLink } from '@/components/connect/PaymentSettingsLink'
import { Tag, Package, GraduationCap, ExternalLink, ChevronRight, Plus, CreditCard, ArrowUpRight } from 'lucide-react'

function pluginSetupHref(pluginId: string): Route {
  return `/settings/plugins?plugin=${pluginId}` as Route
}

// One sellable channel — a live count + manage link, or a set-up link when the
// backing plugin isn't installed.
function ChannelRow({
  icon: Icon, label, count, manageHref, setupPluginId, setUpLabel,
}: {
  icon: React.ElementType
  label: string
  count: number | null
  manageHref: Route
  setupPluginId?: string
  setUpLabel: string
}) {
  const enabled = !setupPluginId
  return (
    <Link
      href={enabled ? manageHref : pluginSetupHref(setupPluginId!)}
      className="group flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {enabled ? (
        <span className="text-xs text-muted-foreground tabular-nums">{count ?? 0}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Plus className="h-3 w-3" /> {setUpLabel}
        </span>
      )}
      <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground" />
    </Link>
  )
}

export default function ShopSettingsPage() {
  const t = useTranslations('ShopSettings')
  const { currentTeamId, team } = useAuth()
  const { publicUrl, flags } = usePublicSurfaces()

  const { data: subTypes = [] } = useSubscriptionTypes(currentTeamId)
  const subCount = subTypes.length
  const { data: productCount = null } = useQuery({
    queryKey: ['shop-settings', 'product-count', currentTeamId],
    enabled: !!currentTeamId && flags.productsActive,
    queryFn: async () =>
      (await getDocs(collection(db, TEAMS_COLLECTION, currentTeamId!, PRODUCTS_SUBCOLLECTION))).size,
  })
  const { data: courseCount = null } = useQuery({
    queryKey: ['shop-settings', 'course-count', currentTeamId],
    enabled: !!currentTeamId && flags.coursesActive,
    queryFn: async () =>
      (await getDocs(query(collection(db, COURSES_COLLECTION), where('teamId', '==', currentTeamId)))).size,
  })

  const previewUrl = publicUrl('shop')
  const currency = (team?.default_currency ?? 'CHF').toUpperCase()

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={
          previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {previewUrl.replace(/^https?:\/\//, '')}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            t('subtitle')
          )
        }
        action={<PaymentSettingsLink />}
      />

      {/* Stacked, not side-by-side — see the note at the top of this file. */}
      <div className="space-y-6">
        {/* Sellable channels */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('channelsTitle')}
          </h2>
          <div className="divide-y rounded-lg border">
            <ChannelRow
              icon={Tag}
              label={t('subscriptions')}
              count={subCount}
              manageHref={'/offer/subscriptions' as Route}
              setUpLabel={t('setUp')}
            />
            <ChannelRow
              icon={Package}
              label={t('products')}
              count={productCount}
              manageHref={'/offer/products' as Route}
              setupPluginId={flags.productsActive ? undefined : 'products'}
              setUpLabel={t('setUp')}
            />
            <ChannelRow
              icon={GraduationCap}
              label={t('courses')}
              count={courseCount}
              manageHref={'/offer/online-courses' as Route}
              setupPluginId={flags.coursesActive ? undefined : 'online-courses'}
              setUpLabel={t('setUp')}
            />
          </div>
        </section>

        {/* Payments — configured in payment settings; this is just a shortcut. */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('paymentsTitle')}
          </h2>
          <div className="divide-y rounded-lg border">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <CreditCard className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('paymentsDesc')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('currency')}: <span className="font-mono tabular-nums">{currency}</span>
                </p>
              </div>
            </div>
            <Link
              href={'/settings/team?tab=payments' as Route}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              {t('openSettings')}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          </div>
        </section>
      </div>
    </div>
  )
}
