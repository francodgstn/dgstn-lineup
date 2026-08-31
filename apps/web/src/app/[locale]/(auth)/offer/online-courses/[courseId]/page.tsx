'use client'

import { useCallback, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { useAuth } from '@/contexts/AuthContext'
import { COURSES_COLLECTION } from '@linyup/shared'
import { ActivityPlanLinks } from '@/components/offer/ActivityPlanLinks'
import { useSaveShortcut } from '@/hooks/useSaveShortcut'
import { useTabParam } from '@/hooks/useTabParam'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
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
import { RichTextEditor } from '@/components/RichTextEditor'
import { toast } from 'sonner'
import {
  ChevronLeft, Plus, Pencil, Trash2, FileText, Video, Music, GraduationCap, Upload, X, Paperclip,
} from 'lucide-react'
import type { Course, Lesson, LessonType, MediaSource, CourseStatus, LessonAttachment } from '@linyup/shared'
import {
  useCourse, useModules, useLessons,
  updateCourse, deleteCourse,
  createModule, updateModule, deleteModule,
  createLesson, updateLesson, deleteLesson,
  type LessonInput,
} from '@/plugins/online-courses/hooks'
import { getOnlineCoursesLimits } from '@/plugins/online-courses/limits'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'

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

// ─── Lesson editor panel ────────────────────────────────────────────────────
// Rendered inline to the right of the course structure (not a modal). The parent
// remounts it via `key` when the selected lesson changes, so form state resets.

type FeaturedKind = 'none' | 'video' | 'audio'

function LessonPanel({
  initial, moduleId, newOrder, teamId, courseId, onSaved, onClose,
}: {
  initial: Lesson | null
  moduleId: string
  newOrder: number
  teamId: string
  courseId: string
  onSaved: (lessonId: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Courses')
  const limits = getOnlineCoursesLimits()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [featured, setFeatured] = useState<FeaturedKind>(
    initial?.type === 'video' ? 'video' : initial?.type === 'audio' ? 'audio' : 'none',
  )
  const [mediaSource, setMediaSource] = useState<MediaSource>(initial?.mediaSource ?? 'youtube')
  const [mediaUrl, setMediaUrl] = useState(initial?.mediaUrl ?? '')
  const [attachments, setAttachments] = useState<LessonAttachment[]>(initial?.attachments ?? [])
  const [saving, setSaving] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [uploadingAttach, setUploadingAttach] = useState(false)
  const mediaFileRef = useRef<HTMLInputElement>(null)
  const attachFileRef = useRef<HTMLInputElement>(null)

  // Image uploads for the rich-text body. Stable identity so the memoized
  // RichTextEditor doesn't re-render (and steal focus) on other state changes.
  const uploadBodyImage = useCallback(
    async (file: File) => {
      if (file.size > limits.maxImageSizeMB * 1024 * 1024) {
        toast.error(t('limitImageSize', { max: limits.maxImageSizeMB }))
        throw new Error('IMAGE_TOO_LARGE')
      }
      return uploadFile(file, `teams/${teamId}/courses/${courseId}/lessons/images/${Date.now()}`)
    },
    [teamId, courseId, limits.maxImageSizeMB, t],
  )

  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingMedia(true)
    try {
      const url = await uploadFile(file, `teams/${teamId}/courses/${courseId}/lessons/media/${Date.now()}`)
      setMediaUrl(url)
      setMediaSource('upload')
    } catch {
      toast.error(t('errorUpload'))
    } finally {
      setUploadingMedia(false)
      if (mediaFileRef.current) mediaFileRef.current.value = ''
    }
  }

  async function handleAttachUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (attachments.length >= limits.maxAttachmentsPerLesson) {
      toast.error(t('limitAttachments', { max: limits.maxAttachmentsPerLesson }))
      if (attachFileRef.current) attachFileRef.current.value = ''
      return
    }
    if (file.size > limits.maxAttachmentSizeMB * 1024 * 1024) {
      toast.error(t('limitAttachmentSize', { max: limits.maxAttachmentSizeMB }))
      if (attachFileRef.current) attachFileRef.current.value = ''
      return
    }
    setUploadingAttach(true)
    try {
      const url = await uploadFile(file, `teams/${teamId}/courses/${courseId}/lessons/attachments/${Date.now()}`)
      setAttachments((prev) => [...prev, { name: file.name, url, size: file.size, contentType: file.type }])
    } catch {
      toast.error(t('errorUpload'))
    } finally {
      setUploadingAttach(false)
      if (attachFileRef.current) attachFileRef.current.value = ''
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const type: LessonType = featured === 'none' ? 'text' : featured
      const data: LessonInput = { title: title.trim(), type, body, attachments }
      if (featured !== 'none') {
        data.mediaSource = mediaSource
        data.mediaUrl = mediaUrl.trim()
      }
      let lessonId = initial?.id
      if (initial) {
        await updateLesson(courseId, initial.id, data)
      } else {
        lessonId = await createLesson({ courseId, teamId, moduleId, order: newOrder, data })
      }
      onSaved(lessonId!)
    } catch {
      toast.error(t('errorSaveLesson'))
    } finally {
      setSaving(false)
    }
  }

  const acceptFor = featured === 'video' ? 'video/*' : 'audio/*'
  const mediaIncomplete = featured !== 'none' && !mediaUrl.trim()
  const canSave = !!title.trim() && !mediaIncomplete && !saving && !uploadingMedia && !uploadingAttach

  // Ctrl/Cmd+S saves the lesson currently being edited.
  useSaveShortcut(() => {
    if (canSave) handleSave()
  })

  return (
    <div className="rounded-lg border bg-card lg:sticky lg:top-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <span className="text-sm font-medium">{initial ? t('editLesson') : t('addLesson')}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} title={t('cancel')}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-5">
        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="lesson-title">{t('fieldTitle')}</Label>
          <Input id="lesson-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        {/* Content (always available) */}
        <div className="space-y-1.5">
          <Label>{t('fieldContent')}</Label>
          <RichTextEditor
            value={initial?.body ?? ''}
            onChange={setBody}
            minHeight={240}
            placeholder={t('contentPlaceholder')}
            onUploadImage={uploadBodyImage}
          />
          <p className="text-xs text-muted-foreground">{t('contentHint')}</p>
        </div>

        {/* Featured media (optional) */}
        <div className="space-y-2">
          <Label>{t('fieldFeaturedMedia')}</Label>
          <Select value={featured} onValueChange={(v) => setFeatured(v as FeaturedKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('featuredNone')}</SelectItem>
              <SelectItem value="video">{t('typeVideo')}</SelectItem>
              <SelectItem value="audio">{t('typeAudio')}</SelectItem>
            </SelectContent>
          </Select>

          {featured !== 'none' && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('fieldMediaSource')}</Label>
                <Select value={mediaSource} onValueChange={(v) => setMediaSource(v as MediaSource)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {featured === 'video' && <SelectItem value="youtube">YouTube</SelectItem>}
                    {featured === 'video' && <SelectItem value="vimeo">Vimeo</SelectItem>}
                    <SelectItem value="url">{t('sourceUrl')}</SelectItem>
                    <SelectItem value="upload">{t('sourceUpload')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mediaSource === 'upload' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('fieldFile')}</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => mediaFileRef.current?.click()} disabled={uploadingMedia}>
                      <Upload className="h-4 w-4 mr-1.5" />
                      {uploadingMedia ? t('uploading') : t('chooseFile')}
                    </Button>
                    {mediaUrl && !uploadingMedia && <span className="text-xs text-green-600">{t('fileReady')}</span>}
                  </div>
                  <input ref={mediaFileRef} type="file" accept={acceptFor} onChange={handleMediaUpload} className="hidden" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('fieldMediaUrl')}</Label>
                  <Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Attachments (optional) */}
        <div className="space-y-2">
          <Label>{t('fieldAttachments')}</Label>
          {attachments.length > 0 && (
            <ul className="space-y-1">
              {attachments.map((a, i) => (
                <li key={a.url} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 min-w-0 text-sm hover:underline">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.name}</span>
                  </a>
                  <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button" variant="outline" size="sm"
            disabled={uploadingAttach || attachments.length >= limits.maxAttachmentsPerLesson}
            onClick={() => attachFileRef.current?.click()}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            {uploadingAttach ? t('uploading') : t('addAttachment')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('attachmentsHint', { count: attachments.length, max: limits.maxAttachmentsPerLesson, size: limits.maxAttachmentSizeMB })}
          </p>
          <input
            ref={attachFileRef} type="file"
            accept="application/pdf,image/*"
            onChange={handleAttachUpload} className="hidden"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t bg-muted/30">
        <Button variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
        <Button size="sm" onClick={handleSave} disabled={!canSave}>{saving ? t('saving') : t('save')}</Button>
      </div>
    </div>
  )
}

// ─── Content tab ────────────────────────────────────────────────────────────

type Selection =
  | { kind: 'lesson'; moduleId: string; lessonId: string }
  | { kind: 'new'; moduleId: string }

function ContentTab({ courseId, teamId }: { courseId: string; teamId: string }) {
  const t = useTranslations('Courses')
  const queryClient = useQueryClient()
  const limits = getOnlineCoursesLimits()

  const { data: modules = [], isLoading: modulesLoading } = useModules(courseId)
  const { data: lessons = [], isLoading: lessonsLoading } = useLessons(courseId)

  const [moduleDialogOpen, setModuleDialogOpen] = useState(false)
  const [moduleTitle, setModuleTitle] = useState('')
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null)
  const [deleteModuleId, setDeleteModuleId] = useState<string | null>(null)
  const [deleteLessonId, setDeleteLessonId] = useState<string | null>(null)

  const [selection, setSelection] = useState<Selection | null>(null)

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

  const selectedLesson =
    selection?.kind === 'lesson' ? lessons.find((l) => l.id === selection.lessonId) ?? null : null
  const selectionKey =
    selection?.kind === 'lesson' ? `l-${selection.lessonId}` :
    selection?.kind === 'new' ? `new-${selection.moduleId}` : 'none'

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
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr] items-start">
          {/* ── Left: course structure ── */}
          <div className="space-y-3">
            {modules.map((mod) => {
              const modLessons = lessons.filter((l) => l.moduleId === mod.id)
              return (
                <div key={mod.id} className="rounded-lg border bg-card">
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b">
                    <span className="font-medium text-sm truncate">{mod.title}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
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
                  <div className="p-1.5 space-y-0.5">
                    {modLessons.map((lesson) => {
                      const Icon = LESSON_ICON[lesson.type]
                      const active = selection?.kind === 'lesson' && selection.lessonId === lesson.id
                      return (
                        <div
                          key={lesson.id}
                          className={`group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                            active ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                          }`}
                          onClick={() => setSelection({ kind: 'lesson', moduleId: mod.id, lessonId: lesson.id })}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                            <span className="text-sm truncate">{lesson.title}</span>
                            {!!lesson.attachments?.length && (
                              <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                            )}
                          </div>
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeleteLessonId(lesson.id) }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )
                    })}
                    <button
                      type="button"
                      disabled={atLessonCap}
                      onClick={() => setSelection({ kind: 'new', moduleId: mod.id })}
                      className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />{t('addLesson')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Right: lesson editor panel ── */}
          <div>
            {selection ? (
              <LessonPanel
                key={selectionKey}
                initial={selectedLesson}
                moduleId={selection.moduleId}
                newOrder={lessons.filter((l) => l.moduleId === selection.moduleId).length}
                teamId={teamId}
                courseId={courseId}
                onClose={() => setSelection(null)}
                onSaved={(lessonId) => {
                  invalidate()
                  setSelection({ kind: 'lesson', moduleId: selection.moduleId, lessonId })
                }}
              />
            ) : (
              <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground h-full flex items-center justify-center">
                {t('selectLessonHint')}
              </div>
            )}
          </div>
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
                if (deleteModuleId) {
                  if (selection?.moduleId === deleteModuleId) setSelection(null)
                  await deleteModule(courseId, deleteModuleId); invalidate()
                }
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
                if (deleteLessonId) {
                  if (selection?.kind === 'lesson' && selection.lessonId === deleteLessonId) setSelection(null)
                  await deleteLesson(courseId, deleteLessonId); invalidate()
                }
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
  course, courseId, teamId, title, summary, coverImageUrl, accessType, subscriptionTypeIds: initialSubIds, priceAmount, benefit, status, hideFromShop,
}: {
  /** The whole document — the matcher reads the edge off it, and reading the
   *  scalars below from the same object keeps the two in step. */
  course: Course
  courseId: string
  teamId: string
  title: string
  summary: string
  coverImageUrl: string | null
  accessType: 'free' | 'registered' | 'subscription' | 'purchase'
  subscriptionTypeIds?: string[]
  priceAmount?: number
  benefit?: Course['benefit']
  status: CourseStatus
  hideFromShop?: boolean
}) {
  const t = useTranslations('Courses')
  // The matcher's own copy lives in the catalogue namespace that owns it.
  const tCat = useTranslations('OfferCatalogue')
  const { team } = useAuth()
  const currency = team?.default_currency ?? 'CHF'
  const queryClient = useQueryClient()
  const router = useRouter()
  const [localTitle, setLocalTitle] = useState(title)
  const [localSummary, setLocalSummary] = useState(summary)
  const [localAccess, setLocalAccess] = useState(accessType)
  const initialPriceText = typeof priceAmount === 'number' ? String(priceAmount) : ''
  const [localPriceText, setLocalPriceText] = useState(initialPriceText)
  // WHICH PLANS open or discount this course is NOT edited here any more — see
  // the matcher below. This form owns the TIER and the PRICE; the plan edge has
  // exactly one writer in the product and it is `ActivityPlanLinks`, which saves
  // itself (no `onDirtyChange` here: unlike the activity DIALOG, nothing on this
  // page closes over an unsaved edge).
  // Modelled as "show in shop" for the UI (on = visible); stored as hideFromShop.
  const [localShowInShop, setLocalShowInShop] = useState(hideFromShop !== true)
  const [uploading, setUploading] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Unpublishing takes the course out of the shop and out of every buyer's
  // Space in one click. It is REVERSIBLE and LOSSLESS — modules, lessons, media
  // and purchases are untouched, and re-publishing restores access — so it asks
  // once and the copy says exactly that rather than implying deletion (UX-100).
  // Publishing is not confirmed: it puts something up, and the way back is this
  // very button.
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const coverRef = useRef<HTMLInputElement>(null)

  const { data: subscriptionTypes = [] } = useSubscriptionTypes(teamId)

  const localPriceNum = parseFloat(localPriceText.replace(',', '.'))
  // Stripe's minimum charge is ~0.50 in the team's currency.
  const purchasePriceInvalid =
    localAccess === 'purchase' && !(Number.isFinite(localPriceNum) && localPriceNum >= 0.5)
  // The matcher only has an edge to draw once the TIER gives it one: a free or
  // sign-in-only course has neither a gate nor a price, so there is nothing for
  // a plan to open or reduce (`coursePlanFacets` says the same thing).
  const tierHasPlanEdge = localAccess === 'subscription' || localAccess === 'purchase'

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['course', courseId] })
  const dirty =
    localTitle !== title ||
    localSummary !== summary ||
    localAccess !== accessType ||
    localPriceText !== initialPriceText ||
    localShowInShop !== (hideFromShop !== true)

  const saveMutation = useMutation({
    mutationFn: () => {
      // THE GATE LIST IS CARRIED, NEVER REWRITTEN, by this form. On the
      // 'subscription' tier `accessRule.subscriptionTypeIds` IS the gate, and
      // the matcher below is its writer — so saving the title must not put a
      // stale copy back over what the matcher just wrote.
      const gateIds = accessType === 'subscription' ? (initialSubIds ?? []) : []

      let accessRule: Course['accessRule']
      if (localAccess === 'subscription') {
        accessRule = { type: 'subscription', subscriptionTypeIds: gateIds }
      } else if (localAccess === 'purchase') {
        // NO "included free for these subs" LIST ANY MORE. It was a second way
        // to say what the matcher's "Included" column says, on the same course,
        // and the two could disagree — which is the overlap this change removes
        // (Franco, 2026-08-31). Migrated rather than dropped: the ids move to a
        // `benefit` with effect 'included', which BOTH firestore.rules and
        // storage.rules already honour on exactly the same terms, so nobody
        // loses access in the move.
        //
        // Only when there is no benefit yet. With one already set, its own list
        // is the studio's more recent answer and a merge would silently widen
        // it; the legacy ids stay on the doc, keep granting what they granted,
        // and the matcher is the way to change them from here on.
        accessRule = { type: 'purchase', priceAmount: localPriceNum }
        const legacyIncluded = accessType === 'purchase' ? (initialSubIds ?? []) : []
        if (legacyIncluded.length > 0 && !benefit) {
          return updateCourse(courseId, {
            title: localTitle.trim(),
            summary: localSummary.trim(),
            accessRule,
            benefit: { effect: 'included', subscriptionTypeIds: legacyIncluded },
            hideFromShop: !localShowInShop,
          })
        }
        if (legacyIncluded.length > 0) {
          accessRule = { ...accessRule, subscriptionTypeIds: legacyIncluded }
        }
      } else {
        accessRule = { type: localAccess }
      }
      return updateCourse(courseId, {
        title: localTitle.trim(),
        summary: localSummary.trim(),
        accessRule,
        // The benefit is the RATE half of the edge and the matcher owns it —
        // carried through untouched here, except outside the 'purchase' tier,
        // where there is no price to reduce and a leftover rule would be inert
        // data nothing can show.
        ...(localAccess === 'purchase' ? {} : { benefit: null }),
        hideFromShop: !localShowInShop,
      })
    },
    onSuccess: () => { invalidate(); toast.success(t('settingsSaved')) },
    onError: () => toast.error(t('errorSave')),
  })

  // Ctrl/Cmd+S saves the settings (when there are unsaved changes).
  useSaveShortcut(() => {
    if (dirty && !purchasePriceInvalid && !saveMutation.isPending) {
      saveMutation.mutate()
    }
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

      {/* ── WHO CAN OPEN THIS ─────────────────────────────────────────────
          The TIER, and (for a sold course) the price. Nothing else: which plans
          open it or make it cheaper is the matcher below, which is the same
          control the activity editor and the catalogue mount.

          THE TIERS OVERLAPPED BEFORE (Franco, 2026-08-31). "Specific
          subscriptions" and "Sold" both carried a subscription list, so a studio
          could express one intent two ways — pick Sold, then mark a plan
          "Included" — and end up with two lists on one course that could
          disagree. They are genuinely different questions and now look it: the
          tier says whether the course is GATED or SOLD, and the matcher says
          what each plan does about it. */}
      <div className="space-y-2">
        <Label>{t('fieldAccess')}</Label>
        {/* Tier CARDS with their consequence written under them — the same
            control the activity editor uses for "Who can book", because it is
            the same decision about a different thing. A bare radio label made
            the reader infer what "Sign-in required" costs them. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {(['free', 'registered', 'subscription', 'purchase'] as const).map((tier) => (
            <label
              key={tier}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
                localAccess === tier ? 'border-primary bg-primary/5' : 'hover:border-foreground/30'
              }`}
            >
              <input
                type="radio"
                className="mt-0.5 accent-primary"
                checked={localAccess === tier}
                onChange={() => setLocalAccess(tier)}
              />
              <span>
                <span className="font-medium">{t(`access_${tier}` as const)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`access_${tier}_desc` as const)}
                </span>
              </span>
            </label>
          ))}
        </div>

        {localAccess === 'purchase' && (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="course-price">{t('fieldPrice', { currency })}</Label>
            <Input
              id="course-price"
              inputMode="decimal"
              value={localPriceText}
              onChange={(e) => setLocalPriceText(e.target.value)}
              placeholder="0.00"
              className="max-w-[10rem]"
            />
            {purchasePriceInvalid && (
              <p className="text-xs text-destructive">{t('priceMin')}</p>
            )}
          </div>
        )}
      </div>

      {/* ── WHAT EACH PLAN DOES ABOUT IT ──────────────────────────────────
          The matcher, in its offering direction — the SAME component the
          activity editor and the catalogue mount, so there is one writer of the
          plan edge and the three surfaces cannot drift.

          It reads the tier: `coursePlanFacets` offers the gate columns for a
          subscription course and the rate columns for a sold one, so the
          columns that appear are the ones the tier can honour. A free or
          sign-in-only course has neither, which is why this is hidden rather
          than shown empty.

          IT SAVES ITSELF, separately from the fields above — same as in the
          activity editor. `hostedInForm` is what tells it it is a guest here. */}
      {tierHasPlanEdge && (
        <div className="space-y-2">
          <Label>{t('planLinksLabel')}</Label>
          <div className="rounded-md border p-3">
            <ActivityPlanLinks
              direction="from-offering"
              offering={{
                id: courseId,
                name: localTitle || title,
                collection: COURSES_COLLECTION,
                badge: tCat('courseBadge'),
                target: { kind: 'course', doc: course },
              }}
              offerings={[]}
              plans={subscriptionTypes}
              currency={currency}
              canEdit
              hostedInForm
            />
          </div>
        </div>
      )}

      {/* Shop visibility — the shop lists every published course; a studio can hide
          a specific one from the catalogue (it stays openable via direct link). */}
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="show-in-shop" className="font-normal">{t('showInShop')}</Label>
          <p className="text-xs text-muted-foreground">{t('showInShopHint')}</p>
        </div>
        <Switch id="show-in-shop" checked={localShowInShop} onCheckedChange={setLocalShowInShop} />
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || purchasePriceInvalid || saveMutation.isPending}
        >
          {saveMutation.isPending ? t('saving') : t('saveSettings')}
        </Button>
        <Button
          variant="outline"
          onClick={() => (status === 'published' ? setConfirmUnpublish(true) : togglePublish())}
        >
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

      {/* Not styled destructive: this deletes no work, and an overstated
          warning trains people to click through the next one. */}
      <AlertDialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unpublishConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('unpublishConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmUnpublish(false)
                await togglePublish()
              }}
            >
              {t('unpublishConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                router.push('/offer/online-courses' as Route)
              }}
            >{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const COURSE_TABS = ['content', 'settings'] as const

export default function CourseBuilderPage() {
  const [tab, setTab] = useTabParam(COURSE_TABS, 'content')
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
        <Link href={'/offer/online-courses' as Route} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" />{t('backToCourses')}
        </Link>
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-5">
      <Link href={'/offer/online-courses' as Route} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />{t('backToCourses')}
      </Link>

      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <span className="text-xs text-muted-foreground capitalize">· {t(`status_${course.status}` as Parameters<typeof t>[0])}</span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof COURSE_TABS)[number])}>
        <TabsList>
          <TabsTrigger value="content">{t('tabContent')}</TabsTrigger>
          <TabsTrigger value="settings">{t('tabSettings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="mt-4">
          <ContentTab courseId={courseId} teamId={currentTeamId} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab
            course={course}
            courseId={courseId}
            teamId={currentTeamId}
            title={course.title}
            summary={course.summary ?? ''}
            coverImageUrl={course.coverImageUrl ?? null}
            accessType={course.accessRule?.type ?? 'registered'}
            subscriptionTypeIds={course.accessRule?.subscriptionTypeIds}
            priceAmount={course.accessRule?.priceAmount}
            benefit={course.benefit}
            status={course.status}
            hideFromShop={course.hideFromShop}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
