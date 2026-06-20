'use client'

// Public self-checkout ("shop"): lists what a studio sells — memberships (public
// subscription types) AND products (merch/equipment) — and lets a member pay via
// Stripe Connect. Branded with the team's bio-link palette. No login required —
// just an email; the webhook links/creates the contact. Memberships and products
// are separated behind a tab toggle so the two never visually mix.

import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable, type FunctionsError } from 'firebase/functions'
import { useTranslations, useLocale } from 'next-intl'
import { ShoppingBag, Loader2, X } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { resolveBackground, getTextColor } from '@/lib/bioLink'
import { formatCurrency } from '@/lib/format'
import { resolveProductPrice } from '@linyup/shared'
import { usePublicTeam } from '../PublicTeamProvider'

interface PlanPrice {
  id?: string
  amount: number
  recurrence: string
  label?: string
  included_months?: number
}
interface PlanEntry {
  id: string
  name: string
  description?: string
  prices?: PlanPrice[]
}

interface ProductVariantEntry {
  id: string
  label: string
  priceAmount?: number
}
interface ProductEntry {
  id: string
  name: string
  description?: string
  imageUrl?: string
  priceAmount: number
  variantLabel?: string
  variants?: ProductVariantEntry[]
}

type Tab = 'memberships' | 'products'

type Checkout =
  | { kind: 'membership'; typeId: string; typeName: string; price: PlanPrice }
  | { kind: 'product'; product: ProductEntry; variantId: string | null }

function prefillEmail(): string {
  try {
    const raw = localStorage.getItem('linyup:space:session')
    if (raw) return (JSON.parse(raw)?.contact?.email as string | undefined) ?? ''
  } catch {
    /* ignore */
  }
  return ''
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ShopHome({
  focusTypeId,
  initialTab,
}: {
  focusTypeId: string | null
  initialTab: Tab | null
}) {
  const t = useTranslations('Shop')
  const locale = useLocale()
  const { slug, teamId, team } = usePublicTeam()

  const [plans, setPlans] = useState<PlanEntry[]>([])
  const [products, setProducts] = useState<ProductEntry[]>([])
  const [currency, setCurrency] = useState('CHF')
  const [loading, setLoading] = useState(true)
  const [systemDark, setSystemDark] = useState(false)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'memberships')
  const [tabTouched, setTabTouched] = useState(false)
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    getDoc(doc(db, 'teams', teamId, 'public_profile', teamId))
      .then((snap) => {
        const planList = (snap.data()?.aggregator_subscription_types ?? []) as PlanEntry[]
        const productList = (snap.data()?.products ?? []) as ProductEntry[]
        setPlans(Array.isArray(planList) ? planList : [])
        setProducts(Array.isArray(productList) ? productList : [])
        setCurrency((snap.data()?.default_currency as string | undefined) ?? 'CHF')
      })
      .catch(() => {
        setPlans([])
        setProducts([])
      })
      .finally(() => setLoading(false))
  }, [teamId])

  useEffect(() => {
    if (team?.bioLinkTheme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [team?.bioLinkTheme])

  const hasMemberships = plans.length > 0
  const hasProducts = products.length > 0
  const showTabs = hasMemberships && hasProducts

  // Default the active tab to whichever surface has items, unless the user (or the
  // ?tab= param) chose one. ?type= focusing always implies memberships.
  useEffect(() => {
    if (loading || tabTouched || initialTab) return
    if (focusTypeId) setTab('memberships')
    else if (!hasMemberships && hasProducts) setTab('products')
    else setTab('memberships')
  }, [loading, tabTouched, initialTab, focusTypeId, hasMemberships, hasProducts])

  // Pre-focus a subscription card from ?type=.
  useEffect(() => {
    if (!focusTypeId || loading || tab !== 'memberships') return
    const el = cardRefs.current[focusTypeId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusTypeId, loading, tab])

  const isDark = team?.bioLinkTheme === 'dark' || (team?.bioLinkTheme === 'auto' && systemDark)
  const bg = team?.bioLinkBackground
  const bgStyle = resolveBackground(bg, isDark)
  const onDark = getTextColor(bg, isDark) === 'light'
  const accent = team?.bioLinkAccentColor ?? '#6366f1'
  const textMain = onDark ? '#f9fafb' : '#111827'
  const textMuted = onDark ? 'rgba(249,250,251,0.65)' : '#6b7280'
  const cardBg = onDark ? 'rgba(255,255,255,0.08)' : '#ffffff'
  const cardBorder = onDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)'

  const recurrenceSuffix = useMemo(
    () =>
      (r: string): string => {
        const key = `recurrence.${r}`
        const val = t(key as Parameters<typeof t>[0])
        return val === key ? '' : val
      },
    [t]
  )

  function openMembership(typeId: string, typeName: string, price: PlanPrice) {
    setCheckout({ kind: 'membership', typeId, typeName, price })
    setEmail(prefillEmail())
    setError(null)
  }

  function openProduct(product: ProductEntry) {
    const firstVariant = product.variants && product.variants.length > 0 ? product.variants[0].id : null
    setCheckout({ kind: 'product', product, variantId: firstVariant })
    setEmail(prefillEmail())
    setError(null)
  }

  // The amount shown in the checkout modal.
  const checkoutAmount = (() => {
    if (!checkout) return 0
    if (checkout.kind === 'membership') return checkout.price.amount
    return resolveProductPrice(checkout.product, checkout.variantId)
  })()

  async function submit() {
    if (!checkout || !EMAIL_RE.test(email.trim())) {
      setError(t('emailInvalid'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (checkout.kind === 'membership') {
        if (!checkout.price.id) throw new Error('no-price')
        const fn = httpsCallable<
          {
            teamId: string
            subscriptionTypeId: string
            priceId: string
            memberEmail: string
            slug: string
            locale: string
          },
          { url: string }
        >(functions, 'createMembershipCheckout')
        const res = await fn({
          teamId,
          subscriptionTypeId: checkout.typeId,
          priceId: checkout.price.id,
          memberEmail: email.trim(),
          slug,
          locale,
        })
        if (res.data?.url) window.location.href = res.data.url
        else throw new Error('no-url')
      } else {
        const fn = httpsCallable<
          {
            teamId: string
            productId: string
            variantId?: string
            memberEmail: string
            slug: string
            locale: string
          },
          { url: string }
        >(functions, 'createProductCheckout')
        const res = await fn({
          teamId,
          productId: checkout.product.id,
          ...(checkout.variantId ? { variantId: checkout.variantId } : {}),
          memberEmail: email.trim(),
          slug,
          locale,
        })
        if (res.data?.url) window.location.href = res.data.url
        else throw new Error('no-url')
      }
    } catch (err) {
      const code = (err as FunctionsError)?.code
      setError(code === 'functions/failed-precondition' ? t('notAvailable') : t('checkoutError'))
      setSubmitting(false)
    }
  }

  const checkoutTitle =
    checkout?.kind === 'membership'
      ? checkout.typeName
      : checkout?.kind === 'product'
        ? checkout.product.name
        : ''

  return (
    <div className="min-h-screen w-full" style={{ background: bgStyle, color: textMain }}>
      <div className="max-w-[640px] mx-auto px-5 pb-16">
        <div className="pt-10 flex items-center gap-3">
          {team?.profileImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={team.profileImage}
              alt={team?.name ?? ''}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <ShoppingBag className="h-9 w-9" style={{ color: accent }} />
          )}
          <div>
            <h1 className="text-xl font-bold leading-tight">{team?.name ?? t('title')}</h1>
            <p className="text-sm" style={{ color: textMuted }}>
              {t('subtitle')}
            </p>
          </div>
        </div>

        {/* Memberships ⇄ Products toggle (only when both exist) */}
        {showTabs && (
          <div
            className="mt-6 inline-flex rounded-full p-1"
            style={{ background: onDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}
          >
            {(['memberships', 'products'] as Tab[]).map((key) => {
              const active = tab === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTab(key)
                    setTabTouched(true)
                  }}
                  className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    background: active ? accent : 'transparent',
                    color: active ? '#ffffff' : textMuted,
                  }}
                >
                  {key === 'memberships' ? t('tabMemberships') : t('tabProducts')}
                </button>
              )
            })}
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: textMuted }} />
          </div>
        ) : !hasMemberships && !hasProducts ? (
          <p className="mt-10 text-center text-sm" style={{ color: textMuted }}>
            {t('noItems')}
          </p>
        ) : tab === 'memberships' ? (
          <section className="mt-6 space-y-4">
            {!showTabs && (
              <h2
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: textMuted }}
              >
                {t('subscriptionsSection')}
              </h2>
            )}
            {plans.map((plan) => (
              <div
                key={plan.id}
                ref={(el) => {
                  cardRefs.current[plan.id] = el
                }}
                className="rounded-2xl border p-5 transition-shadow"
                style={{
                  background: cardBg,
                  borderColor: focusTypeId === plan.id ? accent : cardBorder,
                  boxShadow: focusTypeId === plan.id ? `0 0 0 1px ${accent}` : undefined,
                }}
              >
                <p className="text-base font-semibold">{plan.name}</p>
                {plan.description && (
                  <p className="mt-1 text-sm" style={{ color: textMuted }}>
                    {plan.description}
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {(plan.prices ?? []).map((price, i) => (
                    <div key={price.id ?? i} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm font-medium">
                          {formatCurrency(price.amount, currency)}
                          <span style={{ color: textMuted }}> {recurrenceSuffix(price.recurrence)}</span>
                        </span>
                        {(price.label || price.included_months) && (
                          <span className="ml-2 text-xs" style={{ color: textMuted }}>
                            {price.label}
                            {price.included_months
                              ? ` · ${t('includedMonths', { count: price.included_months })}`
                              : ''}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={!price.id}
                        onClick={() => openMembership(plan.id, plan.name, price)}
                        className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
                        style={{ background: accent, color: '#ffffff' }}
                      >
                        {t('buy')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <section className="mt-6 grid grid-cols-2 gap-4">
            {!showTabs && (
              <h2
                className="col-span-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: textMuted }}
              >
                {t('productsSection')}
              </h2>
            )}
            {products.map((product) => {
              const fromVariant =
                product.variants && product.variants.length > 0
                  ? Math.min(
                      ...product.variants.map((v) =>
                        typeof v.priceAmount === 'number' ? v.priceAmount : product.priceAmount
                      )
                    )
                  : product.priceAmount
              const showFrom =
                product.variants && product.variants.some((v) => typeof v.priceAmount === 'number')
              return (
                <div
                  key={product.id}
                  className="rounded-2xl border overflow-hidden flex flex-col"
                  style={{ background: cardBg, borderColor: cardBorder }}
                >
                  <div
                    className="aspect-square flex items-center justify-center overflow-hidden"
                    style={{ background: onDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
                  >
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <ShoppingBag className="h-8 w-8" style={{ color: textMuted }} />
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-1 flex-1">
                    <p className="text-sm font-semibold leading-tight line-clamp-2">{product.name}</p>
                    {product.description && (
                      <p className="text-xs line-clamp-2" style={{ color: textMuted }}>
                        {product.description}
                      </p>
                    )}
                    <p className="mt-1 text-sm font-medium">
                      {showFrom && (
                        <span className="text-xs font-normal" style={{ color: textMuted }}>
                          {t('priceFrom')}{' '}
                        </span>
                      )}
                      {formatCurrency(fromVariant, currency)}
                    </p>
                    <button
                      type="button"
                      onClick={() => openProduct(product)}
                      className="mt-2 w-full rounded-full px-4 py-2 text-sm font-semibold"
                      style={{ background: accent, color: '#ffffff' }}
                    >
                      {t('buy')}
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        )}
      </div>

      {/* Email → checkout modal */}
      {checkout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !submitting && setCheckout(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: cardBg, color: textMain }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{checkoutTitle}</p>
                <p className="text-xs" style={{ color: textMuted }}>
                  {formatCurrency(checkoutAmount, currency)}{' '}
                  {checkout.kind === 'membership' ? recurrenceSuffix(checkout.price.recurrence) : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setCheckout(null)}
                aria-label={t('cancel')}
              >
                <X className="h-4 w-4" style={{ color: textMuted }} />
              </button>
            </div>

            {/* Variant selector for products with options (e.g. sizes) */}
            {checkout.kind === 'product' &&
              checkout.product.variants &&
              checkout.product.variants.length > 0 && (
                <div className="mt-4">
                  <label className="block text-xs font-medium">
                    {checkout.product.variantLabel || t('chooseOption')}
                  </label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {checkout.product.variants.map((v) => {
                      const active = checkout.variantId === v.id
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setCheckout({ ...checkout, variantId: v.id })}
                          className="rounded-full border px-3 py-1.5 text-xs font-medium"
                          style={{
                            borderColor: active ? accent : cardBorder,
                            background: active ? accent : 'transparent',
                            color: active ? '#ffffff' : textMain,
                          }}
                        >
                          {v.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

            <label className="mt-4 block text-xs font-medium">{t('emailLabel')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: cardBorder,
                background: onDark ? 'rgba(0,0,0,0.2)' : '#fff',
                color: textMain,
              }}
            />
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-4 flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: accent, color: '#ffffff' }}
            >
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('continueToPayment')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
