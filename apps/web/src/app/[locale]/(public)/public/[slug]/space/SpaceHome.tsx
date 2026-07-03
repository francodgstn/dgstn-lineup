'use client'

// Space Home = the contact's PERSONAL portal, not a course catalogue. It surfaces
// the signed-in contact's own data — membership (subscriptions + affiliation),
// the courses they can actually open, and shortcuts to their bookings/profile.
//
// Course DISCOVERY + buying lives in the shop (/public/{slug}/shop): the catalogue
// with locked/priced cards belongs there. Here we only ever show "My courses" —
// entitlements the contact already has — linking straight to the player. Anonymous
// visitors get a sign-in wall (this is a "my account" area), so free-course
// discovery also flows through the shop.

import { useEffect, useState } from 'react'
import { collectionGroup, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { GraduationCap, CreditCard, BadgeCheck, CalendarClock, User, ChevronRight, LogIn, ShoppingBag } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { useSpaceAuth } from './SpaceAuthProvider'
import { useSpaceTheme } from './useSpaceTheme'
import { useSpaceContact } from './useSpaceContact'
import { usePublicTeam } from '../PublicTeamProvider'

// ─── Public course card data (from public_profile subcollection) ───────────────

export interface PublicCourseCard {
  id: string
  slug: string
  title: string
  summary?: string
  coverImageUrl?: string
  accessType: 'free' | 'registered' | 'subscription' | 'purchase'
  subscriptionTypeIds?: string[]
  priceAmount?: number // 'purchase' tier: one-off price (major units)
  moduleCount?: number
  lessonCount?: number
  order?: number
}

// ─── Access check helper ──────────────────────────────────────────────────────
// Same rule the shop + Firestore rules enforce; here it filters the catalogue down
// to the courses this contact may open (their "My courses" library).

function hasAccess(
  card: PublicCourseCard,
  subscriptionTypeId?: string,
  purchasedCourseIds?: Set<string>
): boolean {
  if (card.accessType === 'free') return true
  if (card.accessType === 'registered') return true // any signed-in contact
  if (card.accessType === 'subscription') {
    if (!subscriptionTypeId) return false
    return (card.subscriptionTypeIds ?? []).includes(subscriptionTypeId)
  }
  if (card.accessType === 'purchase') {
    // Bought it once (lifetime), or it's included free with the contact's subscription.
    if (purchasedCourseIds?.has(card.id)) return true
    return !!subscriptionTypeId && (card.subscriptionTypeIds ?? []).includes(subscriptionTypeId)
  }
  return false
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpaceHome() {
  const t = useTranslations('Space')
  const { slug, teamId, isAuthenticated, contact, openSignIn } = useSpaceAuth()
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const { team } = usePublicTeam()
  const currency = team?.default_currency ?? 'CHF'
  const { data: fullContact } = useSpaceContact()
  const [courses, setCourses] = useState<PublicCourseCard[]>([])
  const [purchasedCourseIds, setPurchasedCourseIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  // Load published courses (only needed once signed in — to compute "My courses").
  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    let cancelled = false
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('type', '==', 'course'),
      where('teamId', '==', teamId)
    )
    getDocs(q)
      .then((snap) => {
        if (cancelled) return
        const cards = snap.docs.map((d) => ({
          id: d.ref.parent.parent?.id ?? d.id,
          ...(d.data() as Omit<PublicCourseCard, 'id'>),
        }))
        cards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        setCourses(cards)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, teamId])

  // Which 'purchase'-tier courses this contact has bought (lifetime entitlements).
  useEffect(() => {
    if (!isAuthenticated || !contact?.id) {
      setPurchasedCourseIds(new Set())
      return
    }
    let cancelled = false
    const q = query(
      collectionGroup(db, 'purchases'),
      where('contactId', '==', contact.id),
      where('teamId', '==', teamId)
    )
    getDocs(q)
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

  const cardStyle = { background: cardBg, border: `1px solid ${cardBorder}` }

  // Anonymous → sign-in wall. Space is a personal area; discovery lives in the shop.
  if (!isAuthenticated || !contact) {
    return (
      <div className="mt-10 rounded-2xl p-8 text-center" style={cardStyle}>
        <LogIn className="mx-auto h-7 w-7" style={{ color: accent }} />
        <p className="mt-3 text-sm" style={{ color: textMuted }}>{t('accountSignInPrompt')}</p>
        <button
          onClick={() => openSignIn()}
          className="mt-4 text-sm font-medium px-4 py-2 rounded-full"
          style={{ background: accent, color: '#fff' }}
        >
          {t('signIn')}
        </button>
      </div>
    )
  }

  // ── Membership summary (subscriptions + affiliation) ──
  const subs = fullContact?.active_subscriptions ?? []
  const legacy =
    !subs.length && fullContact?.subscription_type_id
      ? [{
          subscription_type_id: fullContact.subscription_type_id,
          subscription_type_name: fullContact.subscription_type_name ?? null,
          recurrence: fullContact.subscription_recurrence ?? null,
          amount: undefined as number | undefined,
          status: 'active' as string,
        }]
      : []
  const shownSubs = subs.length ? subs : legacy
  const aff = fullContact?.affiliation_summary
  const hasMembership = shownSubs.length > 0 || aff?.has_active === true

  // ── My courses = accessible entitlements only (no locked/buy cards here) ──
  const subscriptionTypeId = fullContact?.subscription_type_id ?? contact.subscription_type_id
  const myCourses = courses.filter((c) => hasAccess(c, subscriptionTypeId, purchasedCourseIds))

  // ── Shop quick links — the studio's sellable channels, deep-linked to the right
  // shop tab. Gated by the SAME world-readable signals the shop reads (the private
  // installed_plugins are unreadable here), so a channel appears only when it's
  // actually on: subscription types / products denormalized onto public_profile,
  // and purchase-tier courses. ──
  const profile = team as typeof team & {
    aggregator_subscription_types?: unknown[]
    products?: unknown[]
  }
  const hasSubscriptions =
    Array.isArray(profile.aggregator_subscription_types) && profile.aggregator_subscription_types.length > 0
  const hasProducts = Array.isArray(profile.products) && profile.products.length > 0
  const hasPurchasableCourses = courses.some((c) => c.accessType === 'purchase' && (c.priceAmount ?? 0) > 0)
  const hasActiveSubscription = shownSubs.length > 0
  const shopLinks = [
    hasSubscriptions && {
      key: 'subscriptions',
      // A contact with a plan is more likely here to change it than to start one.
      label: hasActiveSubscription ? t('changeSubscription') : t('shopSubscriptions'),
      icon: CreditCard,
      href: `/public/${slug}/shop?tab=subscriptions`,
    },
    hasProducts && {
      key: 'products',
      label: t('shopProducts'),
      icon: ShoppingBag,
      href: `/public/${slug}/shop?tab=products`,
    },
    hasPurchasableCourses && {
      key: 'courses',
      label: t('shopCourses'),
      icon: GraduationCap,
      href: `/public/${slug}/shop?tab=courses`,
    },
  ].filter(Boolean) as { key: string; label: string; icon: typeof CreditCard; href: string }[]

  return (
    <div className="mt-6 space-y-4">
      {/* Welcome */}
      <div className="rounded-2xl p-4" style={cardStyle}>
        <p className="text-xs" style={{ color: textMuted }}>{t('welcomeBack')}</p>
        <p className="text-lg font-semibold" style={{ color: textMain }}>
          {contact.firstname} {contact.lastname}
        </p>
      </div>

      {/* Membership */}
      <section className="rounded-2xl p-4" style={cardStyle}>
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="h-4 w-4" style={{ color: accent }} />
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: textMuted }}>
            {t('membershipTitle')}
          </h2>
        </div>
        {!hasMembership ? (
          <p className="text-sm" style={{ color: textMuted }}>{t('membershipNone')}</p>
        ) : (
          <div className="space-y-2">
            {shownSubs.map((s, i) => (
              <div key={s.subscription_type_id ?? i} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium" style={{ color: textMain }}>
                  {s.subscription_type_name ?? t('membershipActive')}
                  {s.recurrence ? <span style={{ color: textMuted }}> · {s.recurrence}</span> : null}
                </span>
                {typeof s.amount === 'number' && (
                  <span className="text-sm" style={{ color: textMuted }}>{formatCurrency(s.amount, currency)}</span>
                )}
              </div>
            ))}
            {aff?.has_active && (
              <div className="flex items-center gap-1.5 text-sm" style={{ color: textMain }}>
                <BadgeCheck className="h-4 w-4" style={{ color: '#16a34a' }} />
                {t('affiliationActive')}
                {aff.types?.length ? <span style={{ color: textMuted }}> · {aff.types.join(', ')}</span> : null}
              </div>
            )}
          </div>
        )}
      </section>

      {/* My courses — accessible entitlements only; discovery/buying is in the shop.
          Hidden entirely when the studio publishes no courses. */}
      {(loading || courses.length > 0) && (
        <section className="rounded-2xl p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <GraduationCap className="h-4 w-4" style={{ color: accent }} />
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: textMuted }}>
              {t('myCourses')}
            </h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div
                className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: accent, borderTopColor: 'transparent' }}
              />
            </div>
          ) : myCourses.length === 0 ? (
            <p className="text-sm py-4" style={{ color: textMuted }}>{t('noAccessibleCourses')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {myCourses.map((course) => (
                <Link
                  key={course.id}
                  href={`/public/${slug}/space/courses/${course.slug}` as Route}
                  className="rounded-xl overflow-hidden transition-all hover:scale-[1.015] hover:shadow-lg"
                  style={cardStyle}
                >
                  <div className="aspect-video bg-muted/30 flex items-center justify-center overflow-hidden">
                    {course.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={course.coverImageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <GraduationCap className="h-8 w-8" style={{ color: textMuted }} />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-semibold text-sm leading-snug" style={{ color: textMain }}>
                      {course.title}
                    </p>
                    <p className="text-xs mt-1" style={{ color: textMuted }}>
                      {t('lessonCount', { count: course.lessonCount ?? 0 })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Shop — the studio's sellable channels, deep-linked to the right shop tab */}
      {shopLinks.length > 0 && (
        <section className="rounded-2xl p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <ShoppingBag className="h-4 w-4" style={{ color: accent }} />
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: textMuted }}>
              {t('shopTitle')}
            </h2>
          </div>
          <div className="grid gap-2">
            {shopLinks.map((l) => {
              const Icon = l.icon
              return (
                <Link
                  key={l.key}
                  href={l.href as Route}
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 transition-opacity hover:opacity-80"
                  style={{ background: `${accent}14`, color: textMain }}
                >
                  <Icon className="h-4 w-4" style={{ color: accent }} />
                  <span className="flex-1 text-sm font-medium">{l.label}</span>
                  <ChevronRight className="h-4 w-4" style={{ color: textMuted }} />
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Quick links to the other portal modules */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { href: `/public/${slug}/space/bookings`, label: t('navBookings'), icon: CalendarClock },
          { href: `/public/${slug}/space/account`, label: t('navAccount'), icon: User },
        ].map((q) => {
          const Icon = q.icon
          return (
            <Link
              key={q.href}
              href={q.href as Route}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 transition-opacity hover:opacity-80"
              style={{ background: `${accent}14`, color: textMain }}
            >
              <Icon className="h-4 w-4" style={{ color: accent }} />
              <span className="flex-1 text-sm font-medium">{q.label}</span>
              <ChevronRight className="h-4 w-4" style={{ color: textMuted }} />
            </Link>
          )
        })}
      </div>

      {/* Branding */}
      {team?.showBranding === true && (
        <p className="pt-6 text-center text-[11px]" style={{ color: textMuted }}>
          {t('poweredBy')}{' '}
          <Link href={'/' as Route} className="hover:underline font-medium" style={{ color: textMuted }}>
            Linyup
          </Link>
        </p>
      )}
    </div>
  )
}
