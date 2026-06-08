'use client'

import { useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import {
  ChevronLeft, Plus, Pencil, Trash2, FileText, Video, Music, GraduationCap, Upload,
} from 'lucide-react'
import type { Lesson, LessonType, MediaSource, CourseStatus } from '@linyup/shared'
import {
  useCourse, useModules, useLessons,
  updateCourse, deleteCourse,
  createModule, updateModule, deleteModule,
  createLesson, updateLesson, deleteLesson,
  type LessonInput,
} from '@/plugins/club-courses/hooks'
import { getClubCoursesLimits } from '@/plugins/club-courses/limits'

const LESSON_ICON: Record<LessonType, typeof FileText> = {
  text: FileText,
  video: Video,
  audio: Music,
}

async function uploadFile(file: File, path: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const sRef = storageRef(storage, `${path}.${ext}`)
  await uploadBytes(sRef, file)
  return getDownloadURL(sRef)
}

// ─── Lesson editor ────────────────────────────────────────────────────────────

function LessonEditorDialog({
  open, onClose, onSave, initial, teamId, courseId,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: LessonInput) => Promise<void>
  initial: Lesson | null
  teamId: string
  courseId: string
}) {
  const t = useTranslations('Courses')
  const [title, setTitle] = useState('')
  const [type, setType] = useState<LessonType>('text')
  const [body, setBody] = useState('')
  const [mediaSource, setMediaSource] = useState<MediaSource>('youtube')
  const [mediaUrl, setMediaUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Sync form when the dialog opens for a new/edited lesson
  const [syncedFor, setSyncedFor] = useState<string | null>(null)
  const key = initial?.id ?? 'new'
  if (open && syncedFor !== key) {
    setTitle(initial?.title ?? '')
    setType(initial?.type ?? 'text')
    setBody(initial?.body ?? '')
    setMediaSource(initial?.mediaSource ?? 'youtube')
    setMediaUrl(initial?.mediaUrl ?? '')
    setSyncedFor(key)
  }
  if (!open && syncedFor !== null) setSyncedFor(null)

  const isMedia = type === 'audio' || type === 'video'

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadFile(file, `teams/${teamId}/courses/${courseId}/lessons/${Date.now()}`)
      setMediaUrl(url)
      setMediaSource('upload')
    } catch {
      toast.error(t('errorUpload'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const data: LessonInput = { title: title.trim(), type }
      if (type === 'text') {
        data.body = body
      } else {
        data.mediaSource = mediaSource
        data.mediaUrl = mediaUrl.trim()
      }
      await onSave(data)
      onClose()
    } catch {
      toast.error(t('errorSaveLesson'))
    } finally {
      setSaving(false)
    }
  }

  const acceptFor = type === 'video' ? 'video/*' : 'audio/*'
  const canSave = !!title.trim() && (type === 'text' || !!mediaUrl.trim()) && !saving && !uploading

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? t('editLesson') : t('addLesson')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lesson-title">{t('fieldTitle')}</Label>
            <Input id="lesson-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label>{t('fieldType')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as LessonType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t('typeText')}</SelectItem>
                <SelectItem value="video">{t('typeVideo')}</SelectItem>
                <SelectItem value="audio">{t('typeAudio')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'text' ? (
            <div className="space-y-1.5">
              <Label htmlFor="lesson-body">{t('fieldBody')}</Label>
              <Textarea
                id="lesson-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder={t('bodyPlaceholder')}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('fieldMediaSource')}</Label>
                <Select value={mediaSource} onValueChange={(v) => setMediaSource(v as MediaSource)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="vimeo">Vimeo</SelectItem>
                    <SelectItem value="url">{t('sourceUrl')}</SelectItem>
                    <SelectItem value="upload">{t('sourceUpload')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mediaSource === 'upload' ? (
                <div className="space-y-1.5">
                  <Label>{t('fieldFile')}</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      <Upload className="h-4 w-4 mr-1.5" />
                      {uploading ? t('uploading') : t('chooseFile')}
                    </Button>
                    {mediaUrl && !uploading && <span className="text-xs text-green-600">{t('fileReady')}</span>}
                  </div>
                  <input ref={fileRef} type="file" accept={acceptFor} onChange={handleUpload} className="hidden" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="lesson-url">{t('fieldMediaUrl')}</Label>
                  <Input
                    id="lesson-url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={handleSave} disabled={!canSave}>{saving ? t('saving') : t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Content tab ────────────────────────────────────────────────────────────

function ContentTab({ courseId, teamId }: { courseId: string; teamId: string }) {
  const t = useTranslations('Courses')
  const queryClient = useQueryClient()
  const limits = getClubCoursesLimits()

  const { data: modules = [], isLoading: modulesLoading } = useModules(courseId)
  const { data: lessons = [], isLoading: lessonsLoading } = useLessons(courseId)

  const [moduleDialogOpen, setModuleDialogOpen] = useState(false)
  const [moduleTitle, setModuleTitle] = useState('')
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null)
  const [deleteModuleId, setDeleteModuleId] = useState<string | null>(null)

  const [lessonModuleId, setLessonModuleId] = useState<string | null>(null)
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null)
  const [deleteLessonId, setDeleteLessonId] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['course-modules', courseId] })
    queryClient.invalidateQueries({ queryKey: ['course-lessons', courseId] })
    queryClient.invalidateQueries({ queryKey: ['course', courseId] })
  }

  const atModuleCap = modules.length >= limits.maxModulesPerCourse
  const atLessonCap = lessons.length >= limits.maxLessonsPerCourse

  async function saveModule() {
    const title = moduleTitle.trim()
    if (!title) return
    try {
      if (editingModuleId) {
        await updateModule(courseId, editingModuleId, { title })
      } else {
        await createModule({ courseId, teamId, title, order: modules.length })
      }
      setModuleDialogOpen(false); setModuleTitle(''); setEditingModuleId(null)
      invalidate()
    } catch {
      toast.error(t('errorSaveModule'))
    }
  }

  async function saveLesson(data: LessonInput) {
    if (editingLesson) {
      await updateLesson(courseId, editingLesson.id, data)
    } else if (lessonModuleId) {
      const order = lessons.filter((l) => l.moduleId === lessonModuleId).length
      await createLesson({ courseId, teamId, moduleId: lessonModuleId, order, data })
    }
    invalidate()
  }

  if (modulesLoading || lessonsLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t('quotaModules', { count: modules.length, max: limits.maxModulesPerCourse })}
          {' · '}
          {t('quotaLessons', { count: lessons.length, max: limits.maxLessonsPerCourse })}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={atModuleCap}
          onClick={() => { setEditingModuleId(null); setModuleTitle(''); setModuleDialogOpen(true) }}
        >
          <Plus className="h-4 w-4 mr-1.5" />{t('addModule')}
        </Button>
      </div>

      {modules.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">{t('emptyModules')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {modules.map((mod) => {
            const modLessons = lessons.filter((l) => l.moduleId === mod.id)
            return (
              <div key={mod.id} className="rounded-lg border bg-card">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
                  <span className="font-medium text-sm">{mod.title}</span>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { setEditingModuleId(mod.id); setModuleTitle(mod.title); setModuleDialogOpen(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteModuleId(mod.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="divide-y">
                  {modLessons.map((lesson) => {
                    const Icon = LESSON_ICON[lesson.type]
                    return (
                      <div key={lesson.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="text-sm truncate">{lesson.title}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => { setEditingLesson(lesson); setLessonModuleId(mod.id) }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteLessonId(lesson.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                  <div className="px-4 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={atLessonCap}
                      onClick={() => { setEditingLesson(null); setLessonModuleId(mod.id) }}
                    >
                      <Plus className="h-4 w-4 mr-1.5" />{t('addLesson')}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Module dialog */}
      <Dialog open={moduleDialogOpen} onOpenChange={(v) => { if (!v) { setModuleDialogOpen(false); setEditingModuleId(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingModuleId ? t('editModule') : t('addModule')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="module-title">{t('fieldTitle')}</Label>
            <Input id="module-title" value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveModule() }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setModuleDialogOpen(false); setEditingModuleId(null) }}>{t('cancel')}</Button>
            <Button onClick={saveModule} disabled={!moduleTitle.trim()}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lesson editor */}
      <LessonEditorDialog
        open={lessonModuleId !== null}
        onClose={() => { setLessonModuleId(null); setEditingLesson(null) }}
        onSave={saveLesson}
        initial={editingLesson}
        teamId={teamId}
        courseId={courseId}
      />

      {/* Delete module confirm */}
      <AlertDialog open={deleteModuleId !== null} onOpenChange={(v) => { if (!v) setDeleteModuleId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteModuleTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteModuleDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleteModuleId) { await deleteModule(courseId, deleteModuleId); invalidate() }
                setDeleteModuleId(null)
              }}
            >{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete lesson confirm */}
      <AlertDialog open={deleteLessonId !== null} onOpenChange={(v) => { if (!v) setDeleteLessonId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteLessonTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteLessonDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleteLessonId) { await deleteLesson(courseId, deleteLessonId); invalidate() }
                setDeleteLessonId(null)
              }}
            >{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab({
  courseId, teamId, title, summary, coverImageUrl, accessType, status,
}: {
  courseId: string
  teamId: string
  title: string
  summary: string
  coverImageUrl: string | null
  accessType: 'free' | 'members' | 'subscription'
  status: CourseStatus
}) {
  const t = useTranslations('Courses')
  const queryClient = useQueryClient()
  const router = useRouter()
  const [localTitle, setLocalTitle] = useState(title)
  const [localSummary, setLocalSummary] = useState(summary)
  const [localAccess, setLocalAccess] = useState(accessType)
  const [uploading, setUploading] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const coverRef = useRef<HTMLInputElement>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['course', courseId] })
  const dirty = localTitle !== title || localSummary !== summary || localAccess !== accessType

  const saveMutation = useMutation({
    mutationFn: () => updateCourse(courseId, {
      title: localTitle.trim(),
      summary: localSummary.trim(),
      accessRule: { type: localAccess },
    }),
    onSuccess: () => { invalidate(); toast.success(t('settingsSaved')) },
    onError: () => toast.error(t('errorSave')),
  })

  async function handleCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadFile(file, `teams/${teamId}/courses/${courseId}/cover`)
      await updateCourse(courseId, { coverImageUrl: url })
      invalidate()
    } catch {
      toast.error(t('errorUpload'))
    } finally {
      setUploading(false)
      if (coverRef.current) coverRef.current.value = ''
    }
  }

  async function togglePublish() {
    const next: CourseStatus = status === 'published' ? 'draft' : 'published'
    await updateCourse(courseId, { status: next })
    invalidate()
    toast.success(next === 'published' ? t('published') : t('unpublished'))
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Cover */}
      <div className="space-y-1.5">
        <Label>{t('fieldCover')}</Label>
        <div className="flex items-center gap-3">
          <div className="h-16 w-28 rounded-md bg-muted overflow-hidden flex items-center justify-center">
            {coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverImageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <GraduationCap className="h-6 w-6 text-muted-foreground/40" />
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => coverRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4 mr-1.5" />{uploading ? t('uploading') : t('uploadCover')}
          </Button>
          <input ref={coverRef} type="file" accept="image/*" onChange={handleCover} className="hidden" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="settings-title">{t('fieldTitle')}</Label>
        <Input id="settings-title" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="settings-summary">{t('fieldSummary')}</Label>
        <Textarea id="settings-summary" rows={3} value={localSummary} onChange={(e) => setLocalSummary(e.target.value)} />
      </div>

      {/* Access rule */}
      <div className="space-y-2">
        <Label>{t('fieldAccess')}</Label>
        <RadioGroup value={localAccess} onValueChange={(v) => setLocalAccess(v as typeof localAccess)}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="members" id="access-members" />
            <Label htmlFor="access-members" className="font-normal">{t('accessMembers')}</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="free" id="access-free" />
            <Label htmlFor="access-free" className="font-normal">{t('accessFree')}</Label>
          </div>
          <div className="flex items-center gap-2 opacity-50">
            <RadioGroupItem value="subscription" id="access-sub" disabled />
            <Label htmlFor="access-sub" className="font-normal">{t('accessSubscription')} — {t('comingSoon')}</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
          {saveMutation.isPending ? t('saving') : t('saveSettings')}
        </Button>
        <Button variant="outline" onClick={togglePublish}>
          {status === 'published' ? t('unpublish') : t('publish')}
        </Button>
      </div>

      <div className="border-t pt-4 flex gap-2">
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmArchive(true)}>
          {t('archive')}
        </Button>
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
          {t('deleteCourse')}
        </Button>
      </div>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('archiveDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { await updateCourse(courseId, { status: 'archived' }); invalidate(); setConfirmArchive(false) }}>
              {t('archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteCourseTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteCourseDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await deleteCourse(courseId)
                router.push('/plugins/club-courses' as Route)
              }}
            >{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CourseBuilderPage() {
  const t = useTranslations('Courses')
  const params = useParams()
  const courseId = String(params.courseId)
  const { currentTeamId } = useAuth()
  const { data: course, isLoading } = useCourse(courseId)

  if (isLoading || !currentTeamId) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    )
  }

  if (!course) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={'/plugins/club-courses' as Route} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" />{t('backToCourses')}
        </Link>
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Link href={'/plugins/club-courses' as Route} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />{t('backToCourses')}
      </Link>

      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <span className="text-xs text-muted-foreground capitalize">· {t(`status_${course.status}` as Parameters<typeof t>[0])}</span>
      </div>

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">{t('tabContent')}</TabsTrigger>
          <TabsTrigger value="settings">{t('tabSettings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="mt-4">
          <ContentTab courseId={courseId} teamId={currentTeamId} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab
            courseId={courseId}
            teamId={currentTeamId}
            title={course.title}
            summary={course.summary ?? ''}
            coverImageUrl={course.coverImageUrl ?? null}
            accessType={course.accessRule?.type ?? 'members'}
            status={course.status}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
