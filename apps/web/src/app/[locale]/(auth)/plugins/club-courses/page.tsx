'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { GraduationCap, Plus } from 'lucide-react'
import type { Course, CourseStatus } from '@linyup/shared'
import { useCourses, createCourse, countCourses } from '@/plugins/club-courses/hooks'
import { getClubCoursesLimits } from '@/plugins/club-courses/limits'

type StatusFilter = 'all' | CourseStatus

const STATUS_BADGE: Record<CourseStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function CourseCard({ course, onOpen }: { course: Course; onOpen: () => void }) {
  const t = useTranslations('Courses')
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
        <p className="text-xs text-muted-foreground mt-auto pt-1">
          {t('lessonCount', { count: course.lessonCount ?? 0 })}
        </p>
      </div>
    </button>
  )
}

export default function ClubCoursesPage() {
  const t = useTranslations('Courses')
  const { user, currentTeamId } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: courses = [], isLoading } = useCourses(currentTeamId)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const limits = getClubCoursesLimits()
  const atCourseCap = courses.length >= limits.maxCoursesPerTeam

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      if (!currentTeamId || !user) throw new Error('Not authenticated')
      // Re-check against the live count to avoid racing a stale cached list.
      const live = await countCourses(currentTeamId)
      if (live >= limits.maxCoursesPerTeam) {
        throw new Error('LIMIT')
      }
      return createCourse({ teamId: currentTeamId, userId: user.uid, title })
    },
    onSuccess: (courseId) => {
      queryClient.invalidateQueries({ queryKey: ['courses', currentTeamId] })
      setCreateOpen(false)
      setNewTitle('')
      router.push(`/plugins/club-courses/${courseId}` as Route)
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
            <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
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
              onOpen={() => router.push(`/plugins/club-courses/${course.id}` as Route)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) { setCreateOpen(false); setNewTitle('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('newCourse')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="course-title">{t('fieldTitle')}</Label>
            <Input
              id="course-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) createMutation.mutate(newTitle.trim()) }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setNewTitle('') }}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => createMutation.mutate(newTitle.trim())}
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
