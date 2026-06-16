'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { GraduationCap, Plus, ImageIcon, X, ExternalLink } from 'lucide-react'
import type { Course, CourseStatus } from '@linyup/shared'
import { useCourses, createCourse, updateCourse, countCourses } from '@/plugins/online-courses/hooks'
import { getOnlineCoursesLimits } from '@/plugins/online-courses/limits'

async function uploadFile(file: File, path: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const sRef = storageRef(storage, `${path}.${ext}`)
  await uploadBytes(sRef, file)
  return getDownloadURL(sRef)
}

type StatusFilter = 'all' | CourseStatus

const STATUS_BADGE: Record<CourseStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

const ACCESS_BADGE: Record<string, string> = {
  free: 'bg-green-100 text-green-700',
  registered: 'bg-blue-100 text-blue-700',
  subscription: 'bg-purple-100 text-purple-700',
}

function CourseCard({ course, onOpen }: { course: Course; onOpen: () => void }) {
  const t = useTranslations('Courses')
  const accessType = course.accessRule?.type ?? 'registered'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border bg-card overflow-hidden hover:shadow-sm hover:border-primary/40 transition-all flex flex-col"
    >
      <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
        {course.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.coverImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GraduationCap className="h-8 w-8 text-muted-foreground/40" />
        )}
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-sm leading-tight line-clamp-2">{course.title}</span>
          <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[course.status]}`}>
            {t(`status_${course.status}` as Parameters<typeof t>[0])}
          </span>
        </div>
        {course.summary && (
          <p className="text-xs text-muted-foreground line-clamp-2">{course.summary}</p>
        )}
        <div className="flex items-center justify-between mt-auto pt-1">
          <p className="text-xs text-muted-foreground">
            {t('lessonCount', { count: course.lessonCount ?? 0 })}
          </p>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACCESS_BADGE[accessType] ?? ''}`}>
            {accessType === 'free' ? t('accessFree') : accessType === 'subscription' ? t('accessSubscription') : t('accessRegistered')}
          </span>
        </div>
      </div>
    </button>
  )
}

export default function OnlineCoursesPage() {
  const t = useTranslations('Courses')
  const { user, currentTeamId, team } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: courses = [], isLoading } = useCourses(currentTeamId)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const limits = getOnlineCoursesLimits()
  const atCourseCap = courses.length >= limits.maxCoursesPerTeam

  // Public Space shortcut (like the bio-link / website pages).
  const spaceUrl = team?.slug
    ? typeof window !== 'undefined'
      ? `${window.location.origin}/public/space/${team.slug}`
      : `/public/space/${team.slug}`
    : null

  function clearCover() {
    if (coverPreview) URL.revokeObjectURL(coverPreview)
    setCoverFile(null)
    setCoverPreview(null)
  }

  function pickCover(file: File) {
    if (file.size > limits.maxImageSizeMB * 1024 * 1024) {
      toast.error(t('limitImageSize', { max: limits.maxImageSizeMB }))
      return
    }
    if (coverPreview) URL.revokeObjectURL(coverPreview)
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  function closeCreate() {
    setCreateOpen(false)
    setNewTitle('')
    clearCover()
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!currentTeamId || !user) throw new Error('Not authenticated')
      // Re-check against the live count to avoid racing a stale cached list.
      const live = await countCourses(currentTeamId)
      if (live >= limits.maxCoursesPerTeam) {
        throw new Error('LIMIT')
      }
      const courseId = await createCourse({ teamId: currentTeamId, userId: user.uid, title: newTitle.trim() })
      if (coverFile) {
        // Non-fatal: the course exists either way; cover can still be set in Settings.
        try {
          const url = await uploadFile(coverFile, `teams/${currentTeamId}/courses/${courseId}/cover`)
          await updateCourse(courseId, { coverImageUrl: url })
        } catch {
          toast.error(t('errorUpload'))
        }
      }
      return courseId
    },
    onSuccess: (courseId) => {
      queryClient.invalidateQueries({ queryKey: ['courses', currentTeamId] })
      closeCreate()
      router.push(`/plugins/online-courses/${courseId}` as Route)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error && err.message === 'LIMIT' ? t('limitCoursesReached', { max: limits.maxCoursesPerTeam }) : t('errorCreate'))
    },
  })

  const filtered = statusFilter === 'all' ? courses : courses.filter((c) => c.status === statusFilter)

  const FILTERS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'draft', label: t('status_draft') },
    { key: 'published', label: t('status_published') },
    { key: 'archived', label: t('status_archived') },
  ]

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            {spaceUrl ? (
              <a
                href={spaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {spaceUrl.replace(/^https?:\/\//, '')}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => setCreateOpen(true)} disabled={atCourseCap} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            {t('newCourse')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('quotaCourses', { count: courses.length, max: limits.maxCoursesPerTeam })}
          </span>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(({ key, label }) => (
          <Button
            key={key}
            size="sm"
            variant={statusFilter === key ? 'secondary' : 'ghost'}
            onClick={() => setStatusFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <GraduationCap className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              onOpen={() => router.push(`/plugins/online-courses/${course.id}` as Route)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) closeCreate() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('newCourse')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="course-title">{t('fieldTitle')}</Label>
              <Input
                id="course-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) createMutation.mutate() }}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('fieldCover')} <span className="font-normal text-muted-foreground">({t('optional')})</span></Label>
              <div className="flex items-center gap-3">
                <div className="h-14 w-24 rounded-md bg-muted overflow-hidden flex items-center justify-center shrink-0">
                  {coverPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => coverInputRef.current?.click()}>
                  {t('uploadCover')}
                </Button>
                {coverPreview && (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={clearCover} title={t('cancel')}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <input
                  ref={coverInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) pickCover(f); e.target.value = '' }}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newTitle.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
