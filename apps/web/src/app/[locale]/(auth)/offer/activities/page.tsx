'use client'

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, where, orderBy, getDocs,
  addDoc, updateDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ACTIVITIES_COLLECTION, resolveActivityAccessRule, compareActivities } from '@linyup/shared'
import type { Activity, ActivityLevel, ActivityType } from '@linyup/shared'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/layout/PageHeader'
import { SortableList, SortableItem, type SortableRenderProps } from '@/components/ui/sortable'
import { Plus, Pencil, Archive, ImageIcon, X, GripVertical } from 'lucide-react'

// ─── archive confirm dialog ───────────────────────────────────────────────────

function ArchiveConfirmDialog({
  activity,
  onConfirm,
  onCancel,
}: {
  activity: Activity | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('Activities')
  return (
    <Dialog open={!!activity} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('archive')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          {activity ? t('archiveConfirm', { name: activity.name }) : ''}
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('archive')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

// ─── constants ────────────────────────────────────────────────────────────────

const LEVELS = ['all', 'beginners', 'intermediate', 'advanced'] as const
const ACTIVITY_TYPES: ActivityType[] = ['group_class', 'coaching']

// ─── schema ───────────────────────────────────────────────────────────────────

const activitySchema = z.object({
  name: z.string().min(1, 'Required').max(80),
  description: z.string().max(500).optional(),
  type: z.enum(['group_class', 'coaching'] as const).default('group_class'),
  level: z.enum(LEVELS),
  color: z.string().optional(),
  // Paid-access gate (supersedes the legacy isFreeTrial toggle; 'open' === free trial).
  accessTier: z.enum(['open', 'members', 'subscription'] as const),
  subscriptionTypeIds: z.array(z.string()),
  // Drop-in / pay-per-class: an uncovered contact may pay this to book a single session.
  dropInEnabled: z.boolean(),
  dropInPrice: z.string(),
}).refine(
  (d) => !d.dropInEnabled || (d.dropInPrice.trim() !== '' && Number(d.dropInPrice) >= 0.5),
  { message: 'Enter a drop-in price of at least 0.50', path: ['dropInPrice'] }
)

type ActivityFormData = z.infer<typeof activitySchema>

// ─── data hook ────────────────────────────────────────────────────────────────

function useActivities(teamId: string | null) {
  return useQuery<Activity[]>({
    queryKey: ['activities', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, ACTIVITIES_COLLECTION),
        where('teamId', '==', teamId),
        where('isActive', '==', true),
        orderBy('name', 'asc'),
      )
      const snap = await getDocs(q)
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id }) as Activity)
        .sort(compareActivities)
    },
  })
}

// ─── dialog ───────────────────────────────────────────────────────────────────

function ActivityDialog({
  open,
  onClose,
  teamId,
  userId,
  editing,
  nextOrder,
}: {
  open: boolean
  onClose: () => void
  teamId: string
  userId: string
  editing: Activity | null
  /** Order assigned to a newly created activity so it appends to the end. */
  nextOrder: number
}) {
  const t = useTranslations('Activities')
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(editing?.image_url ?? null)

  const { data: subscriptionTypes = [] } = useSubscriptionTypes(teamId)
  const initialRule = editing
    ? resolveActivityAccessRule(editing)
    : { type: 'open' as const, subscriptionTypeIds: [] as string[] }

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ActivityFormData>({
    resolver: zodResolver(activitySchema),
    defaultValues: editing
      ? {
          name: editing.name,
          description: editing.description ?? '',
          type: (editing.type ?? 'group_class') as ActivityType,
          level: editing.level ?? 'all',
          color: editing.color ?? '',
          accessTier: initialRule.type,
          subscriptionTypeIds: initialRule.subscriptionTypeIds ?? [],
          dropInEnabled: editing.dropIn?.enabled ?? false,
          dropInPrice: editing.dropIn?.priceAmount != null ? String(editing.dropIn.priceAmount) : '',
        }
      : {
          name: '', description: '', type: 'group_class' as ActivityType, level: 'all',
          color: '#6366f1', accessTier: 'open', subscriptionTypeIds: [],
          dropInEnabled: false, dropInPrice: '',
        },
  })
  const accessTier = watch('accessTier')
  const dropInEnabled = watch('dropInEnabled')

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function uploadImage(activityId: string): Promise<string | null> {
    if (!imageFile) return null
    const ext = imageFile.name.split('.').pop() ?? 'jpg'
    const storageRef = ref(storage, `teams/${teamId}/activities/${activityId}/cover.${ext}`)
    await uploadBytes(storageRef, imageFile)
    return getDownloadURL(storageRef)
  }

  async function onSubmit(data: ActivityFormData) {
    if (editing) {
      const updates: Record<string, unknown> = {
        name: data.name,
        description: data.description ?? '',
        type: data.type,
        level: data.level,
        color: data.color ?? '',
        isFreeTrial: data.accessTier === 'open',
        accessRule: {
          type: data.accessTier,
          ...(data.accessTier === 'subscription'
            ? { subscriptionTypeIds: data.subscriptionTypeIds }
            : {}),
        },
        dropIn: {
          enabled: data.dropInEnabled,
          ...(data.dropInPrice ? { priceAmount: Number(data.dropInPrice) } : {}),
        },
      }
      if (imageFile) {
        const url = await uploadImage(editing.id)
        if (url) updates.image_url = url
      } else if (imagePreview === null && editing.image_url) {
        updates.image_url = null
      }
      await updateDoc(doc(db, ACTIVITIES_COLLECTION, editing.id), updates)
    } else {
      const newRef = await addDoc(collection(db, ACTIVITIES_COLLECTION), {
        name: data.name,
        description: data.description ?? '',
        type: data.type,
        level: data.level,
        color: data.color ?? '',
        isFreeTrial: data.accessTier === 'open',
        accessRule: {
          type: data.accessTier,
          ...(data.accessTier === 'subscription'
            ? { subscriptionTypeIds: data.subscriptionTypeIds }
            : {}),
        },
        dropIn: {
          enabled: data.dropInEnabled,
          ...(data.dropInPrice ? { priceAmount: Number(data.dropInPrice) } : {}),
        },
        slug: slugify(data.name),
        teamId,
        createdBy: userId,
        isActive: true,
        order: nextOrder,
        created_at: serverTimestamp(),
      })
      if (imageFile) {
        const url = await uploadImage(newRef.id)
        if (url) await updateDoc(newRef, { image_url: url })
      }
    }
    await qc.invalidateQueries({ queryKey: ['activities', teamId] })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('editActivity') : t('newActivity')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="act-name">{t('fieldName')}</Label>
            <Input id="act-name" {...register('name')} autoFocus />
            {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="act-desc">{t('fieldDescription')}</Label>
            <textarea
              id="act-desc"
              {...register('description')}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>{t('fieldType')}</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value
                        ? t(`type_${field.value}` as const)
                        : <span className="text-muted-foreground">—</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>{t(`type_${tp}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {editing && watch('type') !== (editing.type ?? 'group_class') && (
              <p className="text-xs text-muted-foreground">
                {t('typeChangeWarning')}
              </p>
            )}
          </div>

          {/* Cover image */}
          <div className="space-y-1.5">
            <Label>{t('fieldImage')}</Label>
            {imagePreview ? (
              <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-1.5 right-1.5 rounded-full bg-background/80 p-1 hover:bg-background transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-20 rounded-lg border-2 border-dashed border-input hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ImageIcon className="h-5 w-5" />
                <span className="text-xs">Click to upload</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="act-level">{t('fieldLevel')}</Label>
              <Controller
                name="level"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <span className="flex flex-1 text-left text-sm truncate">
                        {field.value
                          ? t(`level_${field.value}` as const)
                          : <span className="text-muted-foreground">—</span>}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => (
                        <SelectItem key={l} value={l}>{t(`level_${l}` as const)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="act-color">{t('fieldColor')}</Label>
              <input
                id="act-color"
                type="color"
                {...register('color')}
                className="h-9 w-full rounded-md border border-input cursor-pointer bg-background p-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('accessLabel')}</Label>
            <Controller
              control={control}
              name="accessTier"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  {(['open', 'members', 'subscription'] as const).map((tier) => (
                    <label key={tier} className="flex items-start gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        className="mt-0.5 accent-primary"
                        checked={field.value === tier}
                        onChange={() => field.onChange(tier)}
                      />
                      <span>
                        <span className="font-medium">{t(`access_${tier}`)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t(`access_${tier}_desc`)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            />
            {accessTier === 'subscription' && (
              <Controller
                control={control}
                name="subscriptionTypeIds"
                render={({ field }) => (
                  <div className="ml-6 space-y-1.5 rounded-md border p-3">
                    {subscriptionTypes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('accessNoSubs')}</p>
                    ) : (
                      subscriptionTypes.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={field.value.includes(s.id)}
                            onChange={(e) =>
                              field.onChange(
                                e.target.checked
                                  ? [...field.value, s.id]
                                  : field.value.filter((id: string) => id !== s.id),
                              )
                            }
                          />
                          {s.name}
                        </label>
                      ))
                    )}
                  </div>
                )}
              />
            )}
            {accessTier !== 'open' && (
              <div className="ml-6 space-y-2 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" {...register('dropInEnabled')} className="accent-primary" />
                  {t('dropInLabel')}
                </label>
                {dropInEnabled && (
                  <div className="space-y-1">
                    <Label>{t('dropInPriceLabel')}</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      {...register('dropInPrice')}
                      placeholder={t('dropInPricePlaceholder')}
                      className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">{t('dropInHelp')}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : editing ? t('saveChanges') : t('createActivity')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── activity card ────────────────────────────────────────────────────────────

function ActivityCard({
  activity,
  onEdit,
  onArchive,
  sortable,
}: {
  activity: Activity
  onEdit: () => void
  onArchive: () => void
  sortable: SortableRenderProps
}) {
  const t = useTranslations('Activities')
  const { setNodeRef, style, attributes, listeners, isDragging } = sortable

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
        isDragging ? 'shadow-lg' : 'hover:shadow-sm'
      } transition-shadow`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-1 -ml-1 rounded text-muted-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing touch-none"
        aria-label={t('reorder')}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {activity.image_url ? (
        <div className="h-10 w-10 rounded-md overflow-hidden flex-shrink-0 ring-1 ring-inset ring-black/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activity.image_url} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div
          className="h-4 w-4 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: activity.color ?? '#e5e7eb' }}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{activity.name}</p>
          {activity.type === 'coaching' && (
            <Badge variant="secondary" className="text-xs">{t('type_coaching')}</Badge>
          )}
          {(() => {
            const raw = activity.level
            if (!raw) return null
            const key = raw.toLowerCase().replace(/\s+/g, '_')
            if (key === 'all' || key === 'all_levels') return null
            const known = ['beginners', 'intermediate', 'advanced'] as const
            const match = known.find((k) => k === key)
            return match ? (
              <Badge variant="secondary" className="text-xs">
                {t(`level_${match}` as const)}
              </Badge>
            ) : null
          })()}
          {(() => {
            const rule = resolveActivityAccessRule(activity)
            if (rule.type === 'subscription')
              return <Badge variant="outline" className="text-xs">{t('accessBadgeSubscription')}</Badge>
            if (rule.type === 'members')
              return <Badge variant="outline" className="text-xs">{t('access_members')}</Badge>
            return activity.isFreeTrial ? (
              <Badge variant="outline" className="text-xs">{t('freeTrialBadge')}</Badge>
            ) : null
          })()}
        </div>
        {activity.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{activity.description}</p>
        )}
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={onEdit}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          title={t('editActivity')}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onArchive}
          className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
          title={t('archive')}
        >
          <Archive className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ActivitiesPage() {
  const { currentTeamId, user } = useAuth()
  const { data: activities = [], isLoading } = useActivities(currentTeamId)
  const qc = useQueryClient()
  const t = useTranslations('Activities')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Activity | null>(null)
  const [archiving, setArchiving] = useState<Activity | null>(null)

  function openNew() { setEditing(null); setDialogOpen(true) }
  function openEdit(a: Activity) { setEditing(a); setDialogOpen(true) }
  function closeDialog() { setDialogOpen(false); setEditing(null) }

  async function handleArchiveConfirm() {
    if (!archiving) return
    await updateDoc(doc(db, ACTIVITIES_COLLECTION, archiving.id), { isActive: false })
    await qc.invalidateQueries({ queryKey: ['activities', currentTeamId] })
    setArchiving(null)
  }

  // Drag-and-drop reorder. Persists `order = position` for the whole list in one
  // batch (normalising any docs that never had an explicit order). Mirrors the
  // subscription-types manager; the list is already sorted by compareActivities.
  async function reorder(from: number, to: number) {
    if (from === to || !currentTeamId) return
    const next = [...activities]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const batch = writeBatch(db)
    next.forEach((a, i) => {
      if (a.order !== i) batch.update(doc(db, ACTIVITIES_COLLECTION, a.id), { order: i })
    })
    await batch.commit()
    await qc.invalidateQueries({ queryKey: ['activities', currentTeamId] })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={isLoading ? undefined : t('subtitle', { count: activities.length })}
        action={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t('newActivity')}
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border rounded-xl border-dashed gap-2 bg-card">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
          <button onClick={openNew} className="text-sm text-primary hover:underline">
            {t('emptyAction')}
          </button>
        </div>
      ) : (
        <SortableList ids={activities.map((a) => a.id)} onReorder={reorder}>
          <div className="space-y-2">
            {activities.map((a) => (
              <SortableItem key={a.id} id={a.id}>
                {(sortable) => (
                  <ActivityCard
                    activity={a}
                    onEdit={() => openEdit(a)}
                    onArchive={() => setArchiving(a)}
                    sortable={sortable}
                  />
                )}
              </SortableItem>
            ))}
          </div>
        </SortableList>
      )}

      {currentTeamId && user && (
        <ActivityDialog
          key={editing?.id ?? 'new'}
          open={dialogOpen}
          onClose={closeDialog}
          teamId={currentTeamId}
          userId={user.uid}
          editing={editing}
          nextOrder={activities.length}
        />
      )}

      <ArchiveConfirmDialog
        activity={archiving}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiving(null)}
      />
    </div>
  )
}
