'use client'

import { useEffect, useState } from 'react'
import { collectionGroup, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { GraduationCap, Lock, CreditCard, CalendarClock, User, ChevronRight } from 'lucide-react'
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

function hasAccess(
  card: PublicCourseCard,
  isAuthenticated: boolean,
  subscriptionTypeId?: string,
  purchasedCourseIds?: Set<string>
): boolean {
  if (card.accessType === 'free') return true
  if (!isAuthenticated) return false
  if (card.accessType === 'registered') return true
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

// ─── Dashboard band (authenticated members) ────────────────────────────────────

function DashboardBand() {
  const t = useTranslations('Space')
  const { slug, contact } = useSpaceAuth()
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const { data: fullContact } = useSpaceContact()

  if (!contact) return null
  const activeSub = fullContact?.active_subscriptions?.[0]
  const subName = activeSub?.subscription_type_name ?? fullContact?.subscription_type_name ?? null
  const hasAff = fullContact?.affiliation_summary?.has_active === true
  const membershipLabel = subName ?? (hasAff ? t('membershipActive') : t('membershipNone'))

  const quickLinks = [
    { href: `/public/${slug}/space/bookings`, label: t('navBookings'), icon: CalendarClock },
    { href: `/public/${slug}/space/account`, label: t('navAccount'), icon: User },
  ]

  return (
    <div className="mt-6 rounded-2xl p-4" style={{ background: cardBg, border: `1px solid ${cardBorder}` }}>
      <p className="text-xs" style={{ color: textMuted }}>{t('welcomeBack')}</p>
      <p className="text-lg font-semibold" style={{ color: textMain }}>
        {contact.firstname} {contact.lastname}
      </p>
      <div
        className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
        style={{ background: `${accent}22`, color: textMain }}
      >
        <CreditCard className="h-3.5 w-3.5" />
        {membershipLabel}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {quickLinks.map((q) => {
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
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpaceHome() {
  const t = useTranslations('Space')
  const { slug, teamId, isAuthenticated, contact, openSignIn } = useSpaceAuth()
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const { team } = usePublicTeam()
  const currency = team?.default_currency ?? 'CHF'
  const [courses, setCourses] = useState<PublicCourseCard[]>([])
  const [purchasedCourseIds, setPurchasedCourseIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load published courses for this team from public_profile
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('type', '==', 'course'),
      where('teamId', '==', teamId)
    )
    getDocs(q)
      .then((snap) => {
        const cards = snap.docs.map((d) => ({
          id: d.ref.parent.parent?.id ?? d.id,
          ...(d.data() as Omit<PublicCourseCard, 'id'>),
        }))
        cards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        setCourses(cards)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [teamId])

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

  return (
    <>
      {/* Authenticated members get a dashboard band; anonymous visitors a light intro. */}
      {isAuthenticated && contact ? (
        <DashboardBand />
      ) : (
        <p className="mt-6 text-sm" style={{ color: textMuted }}>
          {t('portalIntro')}
        </p>
      )}

      {/* Module: Courses — the portal's first module. Future portal modules
          (bookings, subscriptions, profile) live in their own routes. */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: textMuted }}>
          {t('coursesSection')}
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: accent, borderTopColor: 'transparent' }} />
          </div>
        ) : courses.length === 0 ? (
          <p className="text-sm text-center py-12" style={{ color: textMuted }}>
            {t('noPublishedCourses')}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {courses.map((course) => {
              const accessible = hasAccess(
                course,
                isAuthenticated,
                contact?.subscription_type_id,
                purchasedCourseIds
              )
              return (
                <CourseCard
                  key={course.id}
                  course={course}
                  slug={slug}
                  accessible={accessible}
                  accent={accent}
                  cardBg={cardBg}
                  cardBorder={cardBorder}
                  textMain={textMain}
                  textMuted={textMuted}
                  currency={currency}
                  t={t}
                  onSignIn={openSignIn}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Branding */}
      {team?.showBranding === true && (
        <p className="mt-12 text-center text-[11px]" style={{ color: textMuted }}>
          {t('poweredBy')}{' '}
          <Link href={'/' as Route} className="hover:underline font-medium" style={{ color: textMuted }}>
            Linyup
          </Link>
        </p>
      )}
    </>
  )
}

// ─── CourseCard ───────────────────────────────────────────────────────────────

interface CardProps {
  course: PublicCourseCard
  slug: string
  accessible: boolean
  accent: string
  cardBg: string
  cardBorder: string
  textMain: string
  textMuted: string
  currency: string
  t: ReturnType<typeof useTranslations<'Space'>>
  onSignIn: () => void
}

function CourseCard({
  course, slug, accessible, accent, cardBg, cardBorder, textMain, textMuted, currency, t, onSignIn,
}: CardProps) {
  const accessBadgeColor =
    course.accessType === 'free'
      ? '#16a34a'
      : course.accessType === 'registered'
      ? '#2563eb'
      : course.accessType === 'subscription'
      ? '#7c3aed'
      : '#d97706'
  const accessBadgeLabel =
    course.accessType === 'free'
      ? t('accessFree')
      : course.accessType === 'subscription'
      ? t('accessSubscription')
      : course.accessType === 'purchase'
      ? formatCurrency(course.priceAmount ?? 0, currency)
      : t('accessRegistered')

  const content = (
    <div
      className="rounded-2xl overflow-hidden transition-all hover:scale-[1.015] hover:shadow-lg"
      style={{ background: cardBg, border: `1px solid ${cardBorder}` }}
    >
      {/* Cover */}
      <div className="aspect-video bg-muted/30 flex items-center justify-center overflow-hidden relative">
        {course.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.coverImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GraduationCap className="h-8 w-8" style={{ color: textMuted }} />
        )}
        {!accessible && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Lock className="h-5 w-5 text-white" />
          </div>
        )}
      </div>

      <div className="p-4 space-y-2">
        {/* Title */}
        <p className="font-semibold text-sm leading-snug" style={{ color: textMain }}>
          {course.title}
        </p>

        {/* Summary */}
        {course.summary && (
          <p className="text-xs line-clamp-2" style={{ color: textMuted }}>
            {course.summary}
          </p>
        )}

        {/* Meta row */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs" style={{ color: textMuted }}>
            {t('lessonCount', { count: course.lessonCount ?? 0 })}
          </span>
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full text-white"
            style={{ background: accessBadgeColor }}
          >
            {accessBadgeLabel}
          </span>
        </div>

        {/* CTA if locked: purchase tier → buy in the shop; others → sign in */}
        {!accessible && (
          course.accessType === 'purchase' ? (
            <Link
              href={`/public/${slug}/shop?tab=courses&course=${course.id}` as Route}
              className="mt-1 inline-block text-xs font-medium hover:underline"
              style={{ color: accent }}
            >
              {t('buyToAccess', { price: formatCurrency(course.priceAmount ?? 0, currency) })} →
            </Link>
          ) : (
            <button
              onClick={(e) => { e.preventDefault(); onSignIn() }}
              className="mt-1 text-xs font-medium hover:underline"
              style={{ color: accent }}
            >
              {t('signInToAccess')} →
            </button>
          )
        )}
      </div>
    </div>
  )

  if (accessible) {
    return (
      <Link href={`/public/${slug}/space/courses/${course.slug}` as Route}>
        {content}
      </Link>
    )
  }

  return <div>{content}</div>
}
