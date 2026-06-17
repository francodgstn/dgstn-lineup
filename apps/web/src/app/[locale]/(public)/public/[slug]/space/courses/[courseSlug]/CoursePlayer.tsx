'use client'

import { useEffect, useState, useMemo } from 'react'
import { collection, collectionGroup, doc, getDoc, getDocs, query, where, orderBy, limit, FirestoreError } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import {
  ChevronLeft, FileText, Video, Music, Paperclip, ChevronRight, ChevronDown, Lock,
} from 'lucide-react'
import type { Course, CourseModule, Lesson, LessonType } from '@linyup/shared'
import {
  COURSES_COLLECTION,
  COURSE_MODULES_SUBCOLLECTION,
  COURSE_LESSONS_SUBCOLLECTION,
} from '@linyup/shared'
import { useSpaceAuth } from '../../SpaceAuthProvider'
import SignInDialog from '../../SignInDialog'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LESSON_ICON: Record<LessonType, typeof FileText> = {
  text: FileText,
  video: Video,
  audio: Music,
}

function getYouTubeId(url: string): string | null {
  const m =
    url.match(/[?&]v=([^&]+)/) ??
    url.match(/youtu\.be\/([^?]+)/) ??
    url.match(/embed\/([^?]+)/)
  return m?.[1] ?? null
}

function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/)
  return m?.[1] ?? null
}

// ─── Media player ─────────────────────────────────────────────────────────────

function MediaPlayer({ lesson }: { lesson: Lesson }) {
  if (!lesson.mediaUrl) return null
  const src = lesson.mediaUrl
  const source = lesson.mediaSource

  if (source === 'youtube') {
    const id = getYouTubeId(src)
    if (!id) return null
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg">
        <iframe
          src={`https://www.youtube.com/embed/${id}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
          title="YouTube video"
        />
      </div>
    )
  }

  if (source === 'vimeo') {
    const id = getVimeoId(src)
    if (!id) return null
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg">
        <iframe
          src={`https://player.vimeo.com/video/${id}`}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
          title="Vimeo video"
        />
      </div>
    )
  }

  if (lesson.type === 'video') {
    return (
      <video controls src={src} className="w-full rounded-lg" />
    )
  }

  if (lesson.type === 'audio') {
    return (
      <audio controls src={src} className="w-full" />
    )
  }

  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  courseSlug: string
}

type GateReason = 'registered' | 'subscription' | null

// Always-readable public summary (from courses/{id}/public_profile/{id}). Lets us
// render a branded gated screen even when the full course doc read is denied.
interface CourseSummary {
  title: string
  coverImageUrl?: string
  accessType: 'free' | 'registered' | 'subscription'
}

export default function CoursePlayer({ courseSlug }: Props) {
  const t = useTranslations('Space')
  const { slug, teamId, isAuthenticated, openSignIn } = useSpaceAuth()
  const [summary, setSummary] = useState<CourseSummary | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [modules, setModules] = useState<CourseModule[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [gateReason, setGateReason] = useState<GateReason>(null)
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setGateReason(null)
    setNotFound(false)

    async function load() {
      // Resolve courseId + public summary (client-side, always readable).
      let courseId: string | null = null
      let accessType: CourseSummary['accessType'] = 'registered'
      try {
        const ppSnap = await getDocs(
          query(
            collectionGroup(db, 'public_profile'),
            where('type', '==', 'course'),
            where('teamId', '==', teamId),
            where('slug', '==', courseSlug),
            limit(1)
          )
        )
        if (cancelled) return
        if (!ppSnap.empty) {
          const pp = ppSnap.docs[0].data() as CourseSummary
          courseId = ppSnap.docs[0].ref.parent.parent?.id ?? null
          accessType = pp.accessType ?? 'registered'
          setSummary({ title: pp.title, coverImageUrl: pp.coverImageUrl, accessType })
        }
      } catch {
        // fall through to not-found
      }
      if (cancelled) return
      if (!courseId) { setNotFound(true); setLoading(false); return }

      // Attempt the gated reads. A permission-denied means this tier is locked
      // for the current visitor — show the gate that matches the access tier.
      try {
        const courseSnap = await getDoc(doc(db, COURSES_COLLECTION, courseId))
        if (cancelled) return
        if (!courseSnap.exists()) { setNotFound(true); setLoading(false); return }
        setCourse({ id: courseSnap.id, ...courseSnap.data() } as Course)

        const [modSnap, lesSnap] = await Promise.all([
          getDocs(query(collection(db, COURSES_COLLECTION, courseId, COURSE_MODULES_SUBCOLLECTION), orderBy('order', 'asc'))),
          getDocs(query(collection(db, COURSES_COLLECTION, courseId, COURSE_LESSONS_SUBCOLLECTION), orderBy('order', 'asc'))),
        ])
        if (cancelled) return
        const mods = modSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as CourseModule)
        const lsns = lesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lesson)
        setModules(mods)
        setLessons(lsns)
        if (lsns.length > 0) setSelectedLessonId(lsns[0].id)
      } catch (err: unknown) {
        if (cancelled) return
        if (err instanceof FirestoreError && err.code === 'permission-denied') {
          setGateReason(accessType === 'subscription' ? 'subscription' : 'registered')
        } else {
          setNotFound(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [courseSlug, teamId, isAuthenticated])

  const selectedLesson = useMemo(
    () => lessons.find((l) => l.id === selectedLessonId) ?? null,
    [lessons, selectedLessonId]
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (notFound || (!course && !gateReason)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
        <Link href={`/public/${slug}/space` as Route} className="text-sm text-primary hover:underline">
          {t('backToCourses')}
        </Link>
      </div>
    )
  }

  // ─── Gated view ────────────────────────────────────────────────────────────

  if (gateReason === 'registered') {
    return (
      <div className="min-h-screen">
        <div className="max-w-[640px] mx-auto px-5 py-10 space-y-6">
          <Link
            href={`/public/${slug}/space` as Route}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('backToCourses')}
          </Link>
          {summary?.coverImageUrl && (
            <div className="aspect-video rounded-xl overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={summary.coverImageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="rounded-xl border bg-card p-6 text-center space-y-4">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-bold">{summary?.title}</h1>
            <p className="text-sm text-muted-foreground">{t('gatedRegisteredTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('gatedRegisteredDesc')}</p>
            <button
              onClick={() => { openSignIn(); setSignInOpen(true) }}
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
            >
              {t('signIn')}
            </button>
          </div>
        </div>
        <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} slug={slug} />
      </div>
    )
  }

  if (gateReason === 'subscription') {
    return (
      <div className="min-h-screen">
        <div className="max-w-[640px] mx-auto px-5 py-10 space-y-6">
          <Link
            href={`/public/${slug}/space` as Route}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('backToCourses')}
          </Link>
          <div className="rounded-xl border bg-card p-6 text-center space-y-4">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-bold">{summary?.title}</h1>
            <p className="text-sm text-muted-foreground">{t('gatedSubscriptionTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('gatedSubscriptionDesc')}</p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Player view ───────────────────────────────────────────────────────────

  if (!course) return null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Back link */}
        <Link
          href={`/public/${slug}/space` as Route}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('backToCourses')}
        </Link>

        <h1 className="text-2xl font-bold">{course.title}</h1>

        {/* Mobile nav toggle */}
        <button
          className="lg:hidden w-full flex items-center justify-between rounded-lg border bg-card px-4 py-2.5 text-sm font-medium"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span>{t('lessonNav')}</span>
          {navOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr] items-start">
          {/* ── Sidebar nav ── */}
          <div className={`${navOpen ? 'block' : 'hidden'} lg:block space-y-2 lg:sticky lg:top-6`}>
            {modules.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2">{t('noLessons')}</p>
            ) : (
              modules.map((mod) => {
                const modLessons = lessons.filter((l) => l.moduleId === mod.id)
                return (
                  <div key={mod.id} className="rounded-lg border bg-card overflow-hidden">
                    <div className="px-3 py-2.5 border-b">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {mod.title}
                      </p>
                    </div>
                    <div className="p-1">
                      {modLessons.map((lesson) => {
                        const Icon = LESSON_ICON[lesson.type]
                        const active = lesson.id === selectedLessonId
                        return (
                          <button
                            key={lesson.id}
                            onClick={() => { setSelectedLessonId(lesson.id); setNavOpen(false) }}
                            className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                              active
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-accent text-foreground'
                            }`}
                          >
                            <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                            <span className="truncate">{lesson.title}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* ── Lesson content ── */}
          <div className="space-y-6">
            {selectedLesson ? (
              <>
                <h2 className="text-xl font-semibold">{selectedLesson.title}</h2>

                {/* Media player */}
                {selectedLesson.mediaUrl && (
                  <MediaPlayer lesson={selectedLesson} />
                )}

                {/* Rich-text body — same .prose-notes styling as the editor (WYSIWYG) */}
                {selectedLesson.body && (
                  <div
                    className="prose-notes prose-relaxed max-w-none"
                    dangerouslySetInnerHTML={{ __html: selectedLesson.body }}
                  />
                )}

                {/* Attachments */}
                {selectedLesson.attachments && selectedLesson.attachments.length > 0 && (
                  <div className="rounded-lg border bg-card p-4 space-y-2">
                    <p className="text-sm font-semibold">{t('attachmentsTitle')}</p>
                    <ul className="space-y-1">
                      {selectedLesson.attachments.map((att) => (
                        <li key={att.url}>
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                          >
                            <Paperclip className="h-3.5 w-3.5 shrink-0" />
                            {att.name}
                            {att.size && (
                              <span className="text-xs text-muted-foreground">
                                ({Math.round(att.size / 1024)} KB)
                              </span>
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noLessons')}</p>
            )}
          </div>
        </div>
      </div>

      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} slug={slug} />
    </div>
  )
}
