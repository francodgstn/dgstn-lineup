'use client'

// Public self-checkout ("shop"): lists what a studio sells — memberships (public
// subscription types), products (merch/equipment) AND online courses (one-off
// purchase) — and lets a member pay via Stripe Connect. Branded with the team's
// bio-link palette. No login required — just an email; the webhook links/creates the
// contact (and grants a course entitlement). The three surfaces are separated behind
// a tab toggle so they never visually mix.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable, type FunctionsError } from 'firebase/functions'
import { useTranslations, useLocale } from 'next-intl'
import { ShoppingBag, GraduationCap, Loader2, X, Play, Lock, LogIn } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { db, functions } from '@/lib/firebase'
import { resolveBackground, getTextColor } from '@/lib/bioLink'
import { formatCurrency } from '@/lib/format'
import {
  resolveProductPrice,
  compareActivities,
  resolvePaymentOptions,
  type CheckoutContactMode,
  type ActivityAccessRule,
  type ActivityMemberBenefit,
  type CourseAccessRule,
} from '@linyup/shared'
import { clientPaymentSnapshot } from '@/lib/paymentSnapshot'
import { resolveActivityTerms, type ActivityTerm } from '@/lib/activityTerms'
import { usePublicTeam } from '../PublicTeamProvider'
import { usePublicContactAuth } from '../PublicContactAuthProvider'
import { DEFAULT_ACCENT } from '@/lib/colors'

interface PlanPrice {
  id?: string
  amount: number
  recurrence: string
  label?: string
  included_months?: number
  credits?: number
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

type CourseAccessType = 'free' | 'registered' | 'subscription' | 'purchase'

interface CourseEntry {
  id: string
  slug: string
  title: string
  summary?: string
  coverImageUrl?: string
  accessType: CourseAccessType
  subscriptionTypeIds?: string[]
  priceAmount?: number // 'purchase' tier only
}

// Raw shape of a course's world-readable public_profile summary (syncCoursePublicProfile).
interface RawCoursePublicProfile {
  accessType?: string
  slug?: string
  subscriptionTypeIds?: string[]
  priceAmount?: number | null
  hideFromShop?: boolean
  title?: string
  summary?: string
  coverImageUrl?: string | null
  order?: number
}

// "Pay per visit" strip (Subscriptions tab): activities with a money story
// (drop-in or priced durations) — routing-only cross-sell into the booking
// flows, no purchase happens here. Same public_profile shape BookingForm /
// sections.tsx read.
interface PayPerVisitEntry {
  id: string
  name: string
  slug: string
  activityType?: string
  dropIn?: { enabled: boolean; priceAmount?: number }
  durations?: Array<{ minutes: number; priceAmount: number | null }>
  memberBenefit?: ActivityMemberBenefit
  accessRule?: ActivityAccessRule
  order?: number
}

// Only activities with an actual money story belong in the strip — a bare
// gated/trial class with no drop-in, or an unpriced appointment, has nothing
// to "pay per visit" for.
function hasMoneyStory(a: PayPerVisitEntry): boolean {
  if (a.activityType === 'appointment') {
    return (a.durations ?? []).some((d) => typeof d.priceAmount === 'number')
  }
  return a.dropIn?.enabled === true && typeof a.dropIn.priceAmount === 'number'
}

type Tab = 'subscriptions' | 'products' | 'courses'

type Checkout =
  | { kind: 'membership'; typeId: string; typeName: string; price: PlanPrice; mode: CheckoutContactMode }
  | { kind: 'product'; product: ProductEntry; variantId: string | null }
  | { kind: 'course'; course: CourseEntry }

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
  const { isAuthenticated, contact, openSignIn, logout } = usePublicContactAuth()

  const [plans, setPlans] = useState<PlanEntry[]>([])
  const [pendingCheckout, setPendingCheckout] = useState<Checkout | null>(null)
  const [products, setProducts] = useState<ProductEntry[]>([])
  const [courses, setCourses] = useState<CourseEntry[]>([])
  const [payPerVisitActivities, setPayPerVisitActivities] = useState<PayPerVisitEntry[]>([])
  const [purchasedCourseIds, setPurchasedCourseIds] = useState<Set<string>>(new Set())
  const [currency, setCurrency] = useState('CHF')
  const [loading, setLoading] = useState(true)
  const [systemDark, setSystemDark] = useState(false)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'subscriptions')
  const [tabTouched, setTabTouched] = useState(false)
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [courseFocusHandled, setCourseFocusHandled] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    let cancelled = false
    // Memberships + products live on the team's single public_profile doc; courses are
    // world-readable per-course public_profile summaries (same collection-group query
    // the Space uses). The shop is the courses' home, so it lists EVERY tier — only
    // courses the studio explicitly hid from the catalogue are dropped.
    const profileP = getDoc(doc(db, 'teams', teamId, 'public_profile', teamId))
    const coursesP = getDocs(
      query(
        collectionGroup(db, 'public_profile'),
        where('type', '==', 'course'),
        where('teamId', '==', teamId)
      )
    )
    // Same public activity mirrors BookingForm / the website Activities block
    // read — filtered down (below) to the ones with an actual money story.
    const activitiesP = getDocs(
      query(
        collectionGroup(db, 'public_profile'),
        where('type', '==', 'activity'),
        where('teamId', '==', teamId)
      )
    )
    Promise.all([profileP, coursesP, activitiesP])
      .then(([snap, courseSnap, activitiesSnap]) => {
        if (cancelled) return
        const planList = (snap.data()?.aggregator_subscription_types ?? []) as PlanEntry[]
        const productList = (snap.data()?.products ?? []) as ProductEntry[]
        setPlans(Array.isArray(planList) ? planList : [])
        setProducts(Array.isArray(productList) ? productList : [])
        setCurrency((snap.data()?.default_currency as string | undefined) ?? 'CHF')
        const courseList: CourseEntry[] = courseSnap.docs
          .map((d) => ({ id: d.ref.parent.parent?.id ?? d.id, data: d.data() as RawCoursePublicProfile }))
          .filter(({ data }) => data.hideFromShop !== true)
          .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
          .map(({ id, data }) => ({
            id,
            slug: data.slug ?? '',
            title: data.title ?? '',
            summary: data.summary || undefined,
            coverImageUrl: data.coverImageUrl || undefined,
            accessType: (data.accessType as CourseAccessType) ?? 'registered',
            subscriptionTypeIds: data.subscriptionTypeIds ?? [],
            priceAmount: typeof data.priceAmount === 'number' ? data.priceAmount : undefined,
          }))
        setCourses(courseList)
        const activityList: PayPerVisitEntry[] = activitiesSnap.docs
          .map((d) => {
            const data = d.data()
            return {
              id: d.id,
              name: (data.name as string) || '',
              slug: (data.slug as string) || '',
              activityType: (data.activityType as string) || undefined,
              dropIn: (data.dropIn as PayPerVisitEntry['dropIn']) ?? undefined,
              durations: Array.isArray(data.durations) ? (data.durations as PayPerVisitEntry['durations']) : undefined,
              memberBenefit: (data.memberBenefit as ActivityMemberBenefit | undefined) ?? undefined,
              accessRule: (data.accessRule as ActivityAccessRule | undefined) ?? undefined,
              order: typeof data.order === 'number' ? (data.order as number) : undefined,
            }
          })
          .filter((a) => a.name && hasMoneyStory(a))
          .sort(compareActivities)
        setPayPerVisitActivities(activityList)
      })
      .catch(() => {
        if (cancelled) return
        setPlans([])
        setProducts([])
        setCourses([])
        setPayPerVisitActivities([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teamId])

  // Which 'purchase'-tier courses the signed-in contact already owns (lifetime
  // entitlements) — so an owned course shows "Open" instead of "Buy".
  useEffect(() => {
    if (!isAuthenticated || !contact?.id) {
      setPurchasedCourseIds(new Set())
      return
    }
    let cancelled = false
    getDocs(
      query(
        collectionGroup(db, 'purchases'),
        where('contactId', '==', contact.id),
        where('teamId', '==', teamId)
      )
    )
      .then((snap) => {
        if (cancelled) return
        setPurchasedCourseIds(
          new Set(snap.docs.map((d) => (d.data().courseId as string | undefined) ?? d.id))
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, contact?.id, teamId])

  useEffect(() => {
    if (team?.bioLinkTheme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [team?.bioLinkTheme])

  const hasSubscriptions = plans.length > 0
  const hasProducts = products.length > 0
  const hasCourses = courses.length > 0
  const availableTabs = useMemo<Tab[]>(() => {
    const out: Tab[] = []
    if (hasSubscriptions) out.push('subscriptions')
    if (hasProducts) out.push('products')
    if (hasCourses) out.push('courses')
    return out
  }, [hasSubscriptions, hasProducts, hasCourses])
  const showTabs = availableTabs.length > 1

  // Default the active tab to whichever surface has items, unless the user (or the
  // ?tab= param) chose one. ?type= focusing always implies memberships.
  useEffect(() => {
    if (loading || tabTouched || initialTab) return
    if (focusTypeId) setTab('subscriptions')
    else if (focusCourseId && hasCourses) setTab('courses')
    else setTab(availableTabs[0] ?? 'subscriptions')
  }, [loading, tabTouched, initialTab, focusTypeId, focusCourseId, hasCourses, availableTabs])

  // Pre-focus a subscription card from ?type=.
  useEffect(() => {
    if (!focusTypeId || loading || tab !== 'subscriptions') return
    const el = cardRefs.current[focusTypeId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusTypeId, loading, tab])

  // LOGIN-FIRST: every purchase requires a contact session — signed-in buyers go
  // straight to the confirm sheet (the purchase attaches to their contact via the
  // session); everyone else signs in or registers (allowRegistration) and the
  // checkout resumes once auth resolves (effect below). No anonymous checkout.
  const startCheckout = useCallback(
    (c: Checkout) => {
      if (isAuthenticated) {
        setCheckout(c)
        setError(null)
      } else {
        setPendingCheckout(c)
        openSignIn({ allowRegistration: true })
      }
    },
    [isAuthenticated, openSignIn]
  )

  // Deep-link from the Space "Buy" CTA (?course=): open that course's checkout once.
  // Only purchase-tier courses are buyable — ignore the param for other tiers.
  useEffect(() => {
    if (!focusCourseId || loading || courseFocusHandled) return
    const c = courses.find((x) => x.id === focusCourseId)
    if (c && c.accessType === 'purchase' && !purchasedCourseIds.has(c.id)) {
      startCheckout({ kind: 'course', course: c })
    }
    setCourseFocusHandled(true)
  }, [focusCourseId, loading, courseFocusHandled, courses, purchasedCourseIds, startCheckout])

  const isDark = team?.bioLinkTheme === 'dark' || (team?.bioLinkTheme === 'auto' && systemDark)
  const bg = team?.bioLinkBackground
  const bgStyle = resolveBackground(bg, isDark)
  const onDark = getTextColor(bg, isDark) === 'light'
  const accent = team?.bioLinkAccentColor ?? DEFAULT_ACCENT
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

  // Money-chip label for one resolved term, for the "pay per visit" strip below.
  // Unlike the public website (generic labels only), the shop already has the
  // subscription-type list loaded — the cross-sell bridge: resolve a SINGLE
  // held type's name ("Included with Premium"); fall back to generic when the
  // benefit spans several types.
  const payPerVisitTermLabel = useCallback(
    (term: ActivityTerm): string | null => {
      const nameFor = (ids?: string[]) =>
        ids?.length === 1 ? plans.find((p) => p.id === ids[0])?.name : undefined
      switch (term.kind) {
        case 'dropIn':
          return t('payPerVisitDropIn', { price: formatCurrency(term.amount ?? 0, currency) })
        case 'price':
          return term.min === term.max
            ? t('payPerVisitFromPrice', { price: formatCurrency(term.min ?? 0, currency) })
            : t('payPerVisitPriceRange', {
                min: formatCurrency(term.min ?? 0, currency),
                max: formatCurrency(term.max ?? 0, currency),
              })
        case 'benefitIncluded': {
          const name = nameFor(term.subscriptionTypeIds)
          return name ? t('payPerVisitIncludedNamed', { name }) : t('payPerVisitIncludedGeneric')
        }
        case 'benefitDiscount': {
          const name = nameFor(term.subscriptionTypeIds)
          return name
            ? t('payPerVisitDiscountNamed', { percent: term.percent ?? 0, name })
            : t('payPerVisitDiscountGeneric', { percent: term.percent ?? 0 })
        }
        default:
          return null
      }
    },
    [plans, currency, t]
  )

  // Resume a pending checkout once sign-in (or registration) resolves — always as
  // the authenticated contact. Unknown emails register in the sign-in dialog; there
  // is no anonymous fallback anymore.
  useEffect(() => {
    if (!pendingCheckout || !isAuthenticated) return
    setCheckout(pendingCheckout)
    setError(null)
    setPendingCheckout(null)
  }, [isAuthenticated, pendingCheckout])

  function openMembership(
    typeId: string,
    typeName: string,
    price: PlanPrice,
    mode: CheckoutContactMode
  ) {
    startCheckout({ kind: 'membership', typeId, typeName, price, mode })
  }

  function openProduct(product: ProductEntry) {
    const firstVariant = product.variants && product.variants.length > 0 ? product.variants[0].id : null
    startCheckout({ kind: 'product', product, variantId: firstVariant })
  }

  function openCourse(course: CourseEntry) {
    startCheckout({ kind: 'course', course })
  }

  // The contact's held union for course-coverage display — today the public
  // contact session only carries the single primary `subscription_type_id`
  // (no `active_subscriptions`/`credit_summary` mirror here), so this is a
  // one-element array in practice; the resolver itself supports the full held
  // union (P6 — see the Space's equivalent `hasAccess`).
  const heldSubscriptionTypeIds = contact?.subscription_type_id ? [contact.subscription_type_id] : []

  // Same resolver the server uses (@linyup/shared) for course access — pure
  // function of the course's accessRule + the visitor's optimistic snapshot.
  const courseOptions = (c: CourseEntry) => {
    const rule: CourseAccessRule = {
      type: c.accessType,
      subscriptionTypeIds: c.subscriptionTypeIds,
      priceAmount: c.priceAmount,
    }
    const snapshot = clientPaymentSnapshot({
      authenticated: isAuthenticated,
      heldSubscriptionTypeIds,
      ownsCourse: purchasedCourseIds.has(c.id),
    })
    return resolvePaymentOptions(snapshot, { kind: 'course', accessRule: rule })
  }

  // What the catalogue card offers for a course, given the visitor's session:
  //  'open'      → can read it now → link to the player
  //  'buy'       → purchase-tier, not owned → checkout
  //  'signin'    → registered/subscription course, needs a login first
  //  'subscribe' → subscription course, signed in but no qualifying membership
  const courseAccess = (c: CourseEntry): 'open' | 'buy' | 'signin' | 'subscribe' => {
    const { options, denial } = courseOptions(c)
    if (options[0]?.type === 'pay') return 'buy'
    if (options.length > 0) return 'open'
    // Purchase-tier misconfig (no price, not owned/included) — the old check
    // always offered 'buy' here regardless of auth state; preserve that.
    if (c.accessType === 'purchase') return 'buy'
    return denial === 'sign_in_required' ? 'signin' : 'subscribe'
  }

  // The amount shown in the checkout modal.
  const checkoutAmount = (() => {
    if (!checkout) return 0
    if (checkout.kind === 'membership') return checkout.price.amount
    if (checkout.kind === 'course') {
      const { options } = courseOptions(checkout.course)
      return options[0]?.type === 'pay' ? options[0].amount : (checkout.course.priceAmount ?? 0)
    }
    return resolveProductPrice(checkout.product, checkout.variantId)
  })()

  async function submit() {
    if (!checkout) return
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
            slug: string
            locale: string
            origin?: string
          },
          { url: string }
        >(functions, 'createCourseCheckout')
        const res = await fn({
          teamId,
          courseId: checkout.course.id,
          slug,
          locale,
          origin: window.location.origin,
        })
        if (res.data?.url) window.location.href = res.data.url
        else throw new Error('no-url')
      }
    } catch (err) {
      const code = (err as FunctionsError)?.code
      if (code === 'functions/unauthenticated' || code === 'functions/permission-denied') {
        // Session expired (or went stale) mid-flow — re-run the sign-in and resume.
        setSubmitting(false)
        setCheckout(null)
        setPendingCheckout(checkout)
        await logout()
        openSignIn({ allowRegistration: true })
        setError(null)
        return
      }
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
                key === 'subscriptions' ? t('tabSubscriptions') : key === 'products' ? t('tabProducts') : t('tabCourses')
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
        ) : !hasSubscriptions && !hasProducts && !hasCourses ? (
          <p className="mt-10 text-center text-sm" style={{ color: textMuted }}>
            {t('noItems')}
          </p>
        ) : tab === 'subscriptions' ? (
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
                          {price.credits ? (
                            <span style={{ color: textMuted }}> · {t('creditsCount', { count: price.credits })}</span>
                          ) : (
                            <span style={{ color: textMuted }}> {recurrenceSuffix(price.recurrence)}</span>
                          )}
                        </span>
                        {(price.label || price.included_months) && (
                          <span className="ml-2 text-xs" style={{ color: textMuted }}>
                            {price.label}
                            {price.included_months
                              ? ` · ${t(price.credits ? 'creditsValidMonths' : 'includedMonths', { count: price.included_months })}`
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

            {/* "Pay per visit" strip — routing only, no purchase here (payment
                always happens in the booking flows). The cross-sell bridge back
                from booking into a membership: benefit chips resolve plan names
                from the aggregator already loaded above. */}
            {payPerVisitActivities.length > 0 && (
              <div className="mt-2 pt-5 border-t" style={{ borderColor: cardBorder }}>
                <h3 className="text-sm font-semibold">{t('payPerVisitHeading')}</h3>
                <p className="mt-0.5 text-xs" style={{ color: textMuted }}>
                  {t('payPerVisitSubtitle')}
                </p>
                <div className="mt-3 space-y-2">
                  {payPerVisitActivities.map((a) => {
                    const chipLabels = resolveActivityTerms({
                      type: a.activityType,
                      dropIn: a.dropIn,
                      durations: a.durations,
                      memberBenefit: a.memberBenefit,
                      accessRule: a.accessRule,
                    })
                      .filter((term) => term.kind !== 'gate' && term.kind !== 'trial')
                      .map((term) => payPerVisitTermLabel(term))
                      .filter((label): label is string => !!label)
                    const href =
                      a.activityType === 'appointment'
                        ? `/public/${slug}/appointments?activity=${a.id}`
                        : a.slug
                          ? `/public/${slug}/booking/${a.slug}`
                          : `/public/${slug}/booking`
                    return (
                      <div
                        key={a.id}
                        className="rounded-xl border p-3 flex items-center justify-between gap-3"
                        style={{ borderColor: cardBorder }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          {chipLabels.length > 0 && (
                            <p className="mt-0.5 text-xs truncate" style={{ color: textMuted }}>
                              {chipLabels.join(' · ')}
                            </p>
                          )}
                        </div>
                        <Link
                          href={href as Route}
                          className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                          style={{ background: accent, color: '#ffffff' }}
                        >
                          {t('payPerVisitCta')}
                        </Link>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
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
            {courses.map((course) => {
              const access = courseAccess(course)
              const badge =
                course.accessType === 'purchase'
                  ? formatCurrency(course.priceAmount ?? 0, currency)
                  : course.accessType === 'free'
                    ? t('accessFree')
                    : course.accessType === 'subscription'
                      ? t('accessSubscription')
                      : t('accessRegistered')
              const btn = 'mt-auto w-full rounded-full px-4 py-2 text-sm font-semibold inline-flex items-center justify-center gap-1.5'
              return (
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
                    <p className="mt-1 mb-2 text-xs font-medium" style={{ color: textMuted }}>{badge}</p>
                    {access === 'open' ? (
                      <Link
                        href={`/public/${slug}/space/courses/${course.slug}?from=shop` as Route}
                        className={btn}
                        style={{ background: accent, color: '#ffffff' }}
                      >
                        <Play className="h-3.5 w-3.5" />
                        {t('openCourse')}
                      </Link>
                    ) : access === 'buy' ? (
                      <button type="button" onClick={() => openCourse(course)} className={btn} style={{ background: accent, color: '#ffffff' }}>
                        {t('buy')}
                      </button>
                    ) : access === 'signin' ? (
                      <button type="button" onClick={() => openSignIn()} className={btn} style={{ background: accent, color: '#ffffff' }}>
                        <LogIn className="h-3.5 w-3.5" />
                        {t('signInToAccess')}
                      </button>
                    ) : hasSubscriptions ? (
                      <button
                        type="button"
                        onClick={() => { setTab('subscriptions'); setTabTouched(true) }}
                        className={btn}
                        style={{ background: accent, color: '#ffffff' }}
                      >
                        <Lock className="h-3.5 w-3.5" />
                        {t('getMembership')}
                      </button>
                    ) : (
                      <p className="mt-auto inline-flex items-center justify-center gap-1.5 text-xs" style={{ color: textMuted }}>
                        <Lock className="h-3.5 w-3.5" />
                        {t('subscriptionRequired')}
                      </p>
                    )}
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

            {checkout.kind === 'course' && (
              <p className="mt-3 text-xs" style={{ color: textMuted }}>
                {t('courseAccessNote')}
              </p>
            )}

            {/* Login-first: the purchase attaches to the signed-in contact via the
                session. "Switch account" restarts sign-in keeping the checkout pending
                (e.g. a parent switching to the right child before buying). */}
            <div
              className="mt-4 space-y-1 rounded-lg px-3 py-2 text-sm"
              style={{ background: onDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)', color: textMain }}
            >
              <p className="break-words">
                {contact ? t('buyingAs', { name: `${contact.firstname} ${contact.lastname}` }) : ''}
              </p>
              {/* Own line so a long name never gets truncated by the link */}
              <button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  const c = checkout
                  setCheckout(null)
                  setPendingCheckout(c)
                  await logout()
                  openSignIn({ allowRegistration: true })
                }}
                className="block text-xs underline-offset-2 hover:underline"
                style={{ color: textMuted }}
              >
                {t('switchAccount')}
              </button>
            </div>
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
