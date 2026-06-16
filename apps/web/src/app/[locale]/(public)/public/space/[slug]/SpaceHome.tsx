'use client'

import { useEffect, useState } from 'react'
import { collectionGroup, query, where, getDocs, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { GraduationCap, Lock, LogOut } from 'lucide-react'
import { resolveBackground, getTextColor } from '@/lib/bioLink'
import type { BioLinkBackground } from '@linyup/shared'
import { useSpaceAuth } from './SpaceAuthProvider'
import SignInDialog from './SignInDialog'

// ─── Public course card data (from public_profile subcollection) ───────────────

export interface PublicCourseCard {
  id: string
  slug: string
  title: string
  summary?: string
  coverImageUrl?: string
  accessType: 'free' | 'registered' | 'subscription'
  subscriptionTypeIds?: string[]
  moduleCount?: number
  lessonCount?: number
  order?: number
}

// ─── Team data ────────────────────────────────────────────────────────────────

interface TeamData {
  name: string
  profileImage?: string
  showBranding?: boolean
  bioLinkBackground?: BioLinkBackground
  bioLinkTheme?: string
  bioLinkAccentColor?: string
}

// ─── Access check helper ──────────────────────────────────────────────────────

function hasAccess(
  card: PublicCourseCard,
  isAuthenticated: boolean,
  subscriptionTypeId?: string
): boolean {
  if (card.accessType === 'free') return true
  if (!isAuthenticated) return false
  if (card.accessType === 'registered') return true
  if (card.accessType === 'subscription') {
    if (!subscriptionTypeId) return false
    return (card.subscriptionTypeIds ?? []).includes(subscriptionTypeId)
  }
  return false
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpaceHome() {
  const t = useTranslations('Space')
  const { slug, teamId, isAuthenticated, contact, logout, openSignIn } = useSpaceAuth()
  const [team, setTeam] = useState<TeamData | null>(null)
  const [courses, setCourses] = useState<PublicCourseCard[]>([])
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    // Load team public profile
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('slug', '==', slug),
      where('type', '==', 'team'),
      limit(1)
    )
    getDocs(q)
      .then((snap) => {
        if (!snap.empty) setTeam(snap.docs[0].data() as TeamData)
      })
      .catch(() => {})
  }, [slug])

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

  useEffect(() => {
    if (team?.bioLinkTheme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [team?.bioLinkTheme])

  const isDark =
    team?.bioLinkTheme === 'dark' || (team?.bioLinkTheme === 'auto' && systemDark)
  const bg = team?.bioLinkBackground
  const bgStyle = resolveBackground(bg, isDark)
  const textScheme = getTextColor(bg, isDark)
  const onDark = textScheme === 'light'
  const accent = team?.bioLinkAccentColor ?? '#6366f1'
  const textMain = onDark ? '#f9fafb' : '#111827'
  const textMuted = onDark ? 'rgba(249,250,251,0.65)' : '#6b7280'
  const cardBg = onDark ? 'rgba(255,255,255,0.08)' : '#ffffff'
  const cardBorder = onDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)'

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: bgStyle, color: textMain, fontFamily: 'inherit' }}
    >
      <div className="max-w-[640px] mx-auto px-5 pb-16">
        {/* Header */}
        <div className="pt-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {team?.profileImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={team.profileImage}
                alt={team?.name ?? ''}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div
                className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: accent }}
              >
                {team?.name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <h1 className="text-xl font-bold" style={{ color: textMain }}>
              {team?.name}
            </h1>
          </div>

          {/* Auth button */}
          {isAuthenticated && contact ? (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: textMuted }}>
                {t('signedInAs', { name: `${contact.firstname} ${contact.lastname}` })}
              </span>
              <button
                onClick={() => logout()}
                className="h-8 w-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ background: cardBg, border: `1px solid ${cardBorder}`, color: textMain }}
                title={t('signOut')}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { openSignIn(); setSignInOpen(true) }}
              className="text-sm font-medium px-4 py-1.5 rounded-full transition-opacity hover:opacity-80"
              style={{ background: accent, color: '#fff' }}
            >
              {t('signIn')}
            </button>
          )}
        </div>

        {/* Courses section */}
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
                const accessible = hasAccess(course, isAuthenticated, contact?.subscription_type_id)
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

                    t={t}
                    onSignIn={() => { openSignIn(); setSignInOpen(true) }}
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
      </div>

      <SignInDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        slug={slug}
      />
    </div>
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
  t: ReturnType<typeof useTranslations<'Space'>>
  onSignIn: () => void
}

function CourseCard({
  course, slug, accessible, accent, cardBg, cardBorder, textMain, textMuted, t, onSignIn,
}: CardProps) {
  const accessBadgeColor =
    course.accessType === 'free'
      ? '#16a34a'
      : course.accessType === 'registered'
      ? '#2563eb'
      : '#7c3aed'

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
            {course.accessType === 'free'
              ? t('accessFree')
              : course.accessType === 'subscription'
              ? t('accessSubscription')
              : t('accessRegistered')}
          </span>
        </div>

        {/* CTA if locked */}
        {!accessible && (
          <button
            onClick={(e) => { e.preventDefault(); onSignIn() }}
            className="mt-1 text-xs font-medium hover:underline"
            style={{ color: accent }}
          >
            {t('signInToAccess')} →
          </button>
        )}
      </div>
    </div>
  )

  if (accessible) {
    return (
      <Link href={`/public/space/${slug}/courses/${course.slug}` as Route}>
        {content}
      </Link>
    )
  }

  return <div>{content}</div>
}
