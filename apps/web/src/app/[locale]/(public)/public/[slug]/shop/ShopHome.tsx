'use client'

// Public self-checkout ("shop"): lists what a studio sells — memberships (public
// subscription types), products (merch/equipment) AND online courses (one-off
// purchase) — and lets a member pay via Stripe Connect. Branded with the team's
// bio-link palette. No login required — just an email; the webhook links/creates the
// contact (and grants a course entitlement). The three surfaces are separated behind
// a tab toggle so they never visually mix.

import { useEffect, useMemo, useRef, useState } from 'react'
import { collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable, type FunctionsError } from 'firebase/functions'
import { useTranslations, useLocale } from 'next-intl'
import { ShoppingBag, GraduationCap, Loader2, X } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { resolveBackground, getTextColor } from '@/lib/bioLink'
import { formatCurrency } from '@/lib/format'
import { resolveProductPrice, type CheckoutContactMode } from '@linyup/shared'
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
  checkout_contact_mode?: CheckoutContactMode
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

interface CourseEntry {
  id: string
  title: string
  summary?: string
  coverImageUrl?: string
  priceAmount: number
}

// Raw shape of a course's world-readable public_profile summary (syncCoursePublicProfile).
interface RawCoursePublicProfile {
  accessType?: string
  priceAmount?: number | null
  title?: string
  summary?: string
  coverImageUrl?: string | null
  order?: number
}

type Tab = 'memberships' | 'products' | 'courses'

type Checkout =
  | { kind: 'membership'; typeId: string; typeName: string; price: PlanPrice; mode: CheckoutContactMode }
  | { kind: 'product'; product: ProductEntry; variantId: string | null }
  | { kind: 'course'; course: CourseEntry }

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
  focusCourseId,
  initialTab,
}: {
  focusTypeId: string | null
  focusCourseId: string | null
  initialTab: Tab | null
}) {
  const t = useTranslations('Shop')
  const locale = useLocale()
  const { slug, teamId, team } = usePublicTeam()

  const [plans, setPlans] = useState<PlanEntry[]>([])
  const [products, setProducts] = useState<ProductEntry[]>([])
  const [courses, setCourses] = useState<CourseEntry[]>([])
  const [currency, setCurrency] = useState('CHF')
  const [loading, setLoading] = useState(true)
  const [systemDark, setSystemDark] = useState(false)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'memberships')
  const [tabTouched, setTabTouched] = useState(false)
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [courseFocusHandled, setCourseFocusHandled] = useState(false)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    let cancelled = false
    // Memberships + products live on the team's single public_profile doc; sellable
    // courses are world-readable per-course public_profile summaries (same collection-
    // group query the Space uses), filtered to the 'purchase' tier.
    const profileP = getDoc(doc(db, 'teams', teamId, 'public_profile', teamId))
    const coursesP = getDocs(
      query(
        collectionGroup(db, 'public_profile'),
        where('type', '==', 'course'),
        where('teamId', '==', teamId)
      )
    )
    Promise.all([profileP, coursesP])
      .then(([snap, courseSnap]) => {
        if (cancelled) return
        const planList = (snap.data()?.aggregator_subscription_types ?? []) as PlanEntry[]
        const productList = (snap.data()?.products ?? []) as ProductEntry[]
        setPlans(Array.isArray(planList) ? planList : [])
        setProducts(Array.isArray(productList) ? productList : [])
        setCurrency((snap.data()?.default_currency as string | undefined) ?? 'CHF')
        const courseList: CourseEntry[] = courseSnap.docs
          .map((d) => ({ id: d.ref.parent.parent?.id ?? d.id, data: d.data() as RawCoursePublicProfile }))
          .filter(
            ({ data }) =>
              data.accessType === 'purchase' &&
              typeof data.priceAmount === 'number' &&
              data.priceAmount > 0
          )
          .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
          .map(({ id, data }) => ({
            id,
            title: data.title ?? '',
            summary: data.summary || undefined,
            coverImageUrl: data.coverImageUrl || undefined,
            priceAmount: data.priceAmount as number,
          }))
        setCourses(courseList)
      })
      .catch(() => {
        if (cancelled) return
        setPlans([])
        setProducts([])
        setCourses([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
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
  const hasCourses = courses.length > 0
  const availableTabs = useMemo<Tab[]>(() => {
    const out: Tab[] = []
    if (hasMemberships) out.push('memberships')
    if (hasProducts) out.push('products')
    if (hasCourses) out.push('courses')
    return out
  }, [hasMemberships, hasProducts, hasCourses])
  const showTabs = availableTabs.length > 1

  // Default the active tab to whichever surface has items, unless the user (or the
  // ?tab= param) chose one. ?type= focusing always implies memberships.
  useEffect(() => {
    if (loading || tabTouched || initialTab) return
    if (focusTypeId) setTab('memberships')
    else if (focusCourseId && hasCourses) setTab('courses')
    else setTab(availableTabs[0] ?? 'memberships')
  }, [loading, tabTouched, initialTab, focusTypeId, focusCourseId, hasCourses, availableTabs])

  // Pre-focus a subscription card from ?type=.
  useEffect(() => {
    if (!focusTypeId || loading || tab !== 'memberships') return
    const el = cardRefs.current[focusTypeId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusTypeId, loading, tab])

  // Deep-link from the Space "Buy" CTA (?course=): open that course's checkout once.
  useEffect(() => {
    if (!focusCourseId || loading || courseFocusHandled) return
    const c = courses.find((x) => x.id === focusCourseId)
    if (c) {
      setCheckout({ kind: 'course', course: c })
      setEmail(prefillEmail())
      setError(null)
    }
    setCourseFocusHandled(true)
  }, [focusCourseId, loading, courseFocusHandled, courses])

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

  function openMembership(
    typeId: string,
    typeName: string,
    price: PlanPrice,
    mode: CheckoutContactMode
  ) {
    setCheckout({ kind: 'membership', typeId, typeName, price, mode })
    setEmail(prefillEmail())
    setFirstName('')
    setLastName('')
    setError(null)
  }

  function openProduct(product: ProductEntry) {
    const firstVariant = product.variants && product.variants.length > 0 ? product.variants[0].id : null
    setCheckout({ kind: 'product', product, variantId: firstVariant })
    setEmail(prefillEmail())
    setError(null)
  }

  function openCourse(course: CourseEntry) {
    setCheckout({ kind: 'course', course })
    setEmail(prefillEmail())
    setError(null)
  }

  // The amount shown in the checkout modal.
  const checkoutAmount = (() => {
    if (!checkout) return 0
    if (checkout.kind === 'membership') return checkout.price.amount
    if (checkout.kind === 'course') return checkout.course.priceAmount
    return resolveProductPrice(checkout.product, checkout.variantId)
  })()

  async function submit() {
    if (!checkout || !EMAIL_RE.test(email.trim())) {
      setError(t('emailInvalid'))
      return
    }
    // Memberships (unless mode 'off') collect the buyer's name so checkout creates a
    // real contact.
    if (
      checkout.kind === 'membership' &&
      checkout.mode !== 'off' &&
      (!firstName.trim() || !lastName.trim())
    ) {
      setError(t('nameRequired'))
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
            firstName: string
            lastName: string
            slug: string
            locale: string
            origin?: string
          },
          { url: string }
        >(functions, 'createMembershipCheckout')
        const res = await fn({
          teamId,
          subscriptionTypeId: checkout.typeId,
          priceId: checkout.price.id,
          memberEmail: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          slug,
          locale,
          origin: window.location.origin,
        })
        if (res.data?.url) window.location.href = res.data.url
        else throw new Error('no-url')
      } else if (checkout.kind === 'product') {
        const fn = httpsCallable<
          {
            teamId: string
            productId: string
            variantId?: string
            memberEmail: string
            slug: string
            locale: string
            origin?: string
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
          origin: window.location.origin,
        })
        if (res.data?.url) window.location.href = res.data.url
        else throw new Error('no-url')
      } else {
        const fn = httpsCallable<
          {
            teamId: string
            courseId: string
            memberEmail: string
            slug: string
            locale: string
            origin?: string
          },
          { url: string }
        >(functions, 'createCourseCheckout')
        const res = await fn({
          teamId,
          courseId: checkout.course.id,
          memberEmail: email.trim(),
          slug,
          locale,
          origin: window.location.origin,
        })
        if (res.data?.url) window.location.href = res.data.url
        else throw new Error('no-url')
      }
    } catch (err) {
      const code = (err as FunctionsError)?.code
      setError(
        code === 'functions/already-exists'
          ? t('alreadySubscribed')
          : code === 'functions/failed-precondition'
            ? t('notAvailable')
            : t('checkoutError')
      )
      setSubmitting(false)
    }
  }

  const checkoutTitle =
    checkout?.kind === 'membership'
      ? checkout.typeName
      : checkout?.kind === 'product'
        ? checkout.product.name
        : checkout?.kind === 'course'
          ? checkout.course.title
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

        {/* Memberships ⇄ Products ⇄ Courses toggle (only when 2+ surfaces exist) */}
        {showTabs && (
          <div
            className="mt-6 inline-flex rounded-full p-1"
            style={{ background: onDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}
          >
            {availableTabs.map((key) => {
              const active = tab === key
              const label =
                key === 'memberships' ? t('tabMemberships') : key === 'products' ? t('tabProducts') : t('tabCourses')
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
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: textMuted }} />
          </div>
        ) : !hasMemberships && !hasProducts && !hasCourses ? (
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
                        onClick={() =>
                          openMembership(
                            plan.id,
                            plan.name,
                            price,
                            plan.checkout_contact_mode ?? 'minimal'
                          )
                        }
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
        ) : tab === 'products' ? (
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
        ) : (
          <section className="mt-6 grid grid-cols-2 gap-4">
            {!showTabs && (
              <h2
                className="col-span-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: textMuted }}
              >
                {t('coursesSection')}
              </h2>
            )}
            {courses.map((course) => (
              <div
                key={course.id}
                className="rounded-2xl border overflow-hidden flex flex-col"
                style={{ background: cardBg, borderColor: cardBorder }}
              >
                <div
                  className="aspect-video flex items-center justify-center overflow-hidden"
                  style={{ background: onDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
                >
                  {course.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={course.coverImageUrl} alt={course.title} className="h-full w-full object-cover" />
                  ) : (
                    <GraduationCap className="h-8 w-8" style={{ color: textMuted }} />
                  )}
                </div>
                <div className="p-3 flex flex-col gap-1 flex-1">
                  <p className="text-sm font-semibold leading-tight line-clamp-2">{course.title}</p>
                  {course.summary && (
                    <p className="text-xs line-clamp-2" style={{ color: textMuted }}>
                      {course.summary}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-medium">{formatCurrency(course.priceAmount, currency)}</p>
                  <button
                    type="button"
                    onClick={() => openCourse(course)}
                    className="mt-2 w-full rounded-full px-4 py-2 text-sm font-semibold"
                    style={{ background: accent, color: '#ffffff' }}
                  >
                    {t('buy')}
                  </button>
                </div>
              </div>
            ))}
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

            {checkout.kind === 'course' && (
              <p className="mt-3 text-xs" style={{ color: textMuted }}>
                {t('courseAccessNote')}
              </p>
            )}

            {checkout.kind === 'membership' && checkout.mode !== 'off' && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium">{t('firstNameLabel')}</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={t('firstNameLabel')}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: cardBorder, background: onDark ? 'rgba(0,0,0,0.2)' : '#fff', color: textMain }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium">{t('lastNameLabel')}</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={t('lastNameLabel')}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: cardBorder, background: onDark ? 'rgba(0,0,0,0.2)' : '#fff', color: textMain }}
                  />
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
