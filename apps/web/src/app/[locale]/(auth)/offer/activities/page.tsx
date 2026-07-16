'use client'

import { useState, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, addDoc, updateDoc, doc, serverTimestamp, writeBatch,
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
import { ACTIVITIES_COLLECTION, TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION, resolveActivityAccessRule, resolveAutoConfirm } from '@linyup/shared'
import type { Activity, ActivityLevel, ActivityType } from '@linyup/shared'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { useActivities } from '@/hooks/useActivities'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/layout/PageHeader'
import { SortableList, SortableItem, type SortableRenderProps } from '@/components/ui/sortable'
import { formatDuration } from '@/components/sessions/SessionFormDialog'
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
const ACTIVITY_TYPES: ActivityType[] = ['class', 'appointment']
// APPOINTMENT-ONLY: the bookable session lengths an appointment activity offers.
const APPOINTMENT_DURATION_PRESETS = [15, 30, 45, 60, 90, 120]

// ─── schema ───────────────────────────────────────────────────────────────────

const activitySchema = z.object({
  name: z.string().min(1, 'Required').max(80),
  description: z.string().max(500).optional(),
  prerequisites: z.string().max(300).optional(),
  confirmationInstructions: z.string().max(2000).optional(),
  type: z.enum(['class', 'appointment'] as const).default('class'),
  level: z.enum(LEVELS),
  color: z.string().optional(),
  // Paid-access gate (supersedes the legacy isFreeTrial toggle; 'open' === free trial).
  accessTier: z.enum(['open', 'members', 'subscription'] as const),
  subscriptionTypeIds: z.array(z.string()),
  // Drop-in / pay-per-class: an uncovered contact may pay this to book a single session.
  dropInEnabled: z.boolean(),
  dropInPrice: z.string(),
  // Does a booking for this activity confirm itself, or wait on studio review?
  // Not implied by `type` — shown for classes and appointments alike.
  autoConfirm: z.boolean(),
  // APPOINTMENT-ONLY: the session lengths clients choose from, and the booking cap
  // for a materialised appointment session (1 = true 1:1; >1 = small-group).
  durationsMinutes: z.array(z.number()),
  max_participants: z.number().int().min(1).max(50),
}).superRefine((d, ctx) => {
  if (d.dropInEnabled && !(d.dropInPrice.trim() !== '' && Number(d.dropInPrice) >= 0.5)) {
    ctx.addIssue({ code: 'custom', path: ['dropInPrice'], message: 'Enter a drop-in price of at least 0.50' })
  }
  if (d.type === 'appointment' && d.durationsMinutes.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['durationsMinutes'], message: 'Pick at least one session length' })
  }
})

type ActivityFormData = z.infer<typeof activitySchema>

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
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ActivityFormData>({
    resolver: zodResolver(activitySchema),
    defaultValues: editing
      ? {
          name: editing.name,
          description: editing.description ?? '',
          prerequisites: editing.prerequisites ?? '',
          confirmationInstructions: editing.confirmationInstructions ?? '',
          type: (editing.type ?? 'class') as ActivityType,
          level: editing.level ?? 'all',
          color: editing.color ?? '',
          accessTier: initialRule.type,
          subscriptionTypeIds: initialRule.subscriptionTypeIds ?? [],
          dropInEnabled: editing.dropIn?.enabled ?? false,
          dropInPrice: editing.dropIn?.priceAmount != null ? String(editing.dropIn.priceAmount) : '',
          durationsMinutes: editing.durationsMinutes ?? [],
          max_participants: editing.max_participants ?? 1,
          autoConfirm: resolveAutoConfirm(editing),
        }
      : {
          name: '', description: '', prerequisites: '', confirmationInstructions: '',
          type: 'class' as ActivityType, level: 'all',
          color: '#6366f1', accessTier: 'open', subscriptionTypeIds: [],
          dropInEnabled: false, dropInPrice: '',
          durationsMinutes: [], max_participants: 1,
          autoConfirm: resolveAutoConfirm({ type: 'class' }),
        },
  })
  const type = watch('type')
  const accessTier = watch('accessTier')
  const dropInEnabled = watch('dropInEnabled')
  const durationsMinutes = watch('durationsMinutes') || []

  function toggleDuration(d: number) {
    setValue('durationsMinutes', durationsMinutes.includes(d)
      ? durationsMinutes.filter((x) => x !== d)
      : [...durationsMinutes, d].sort((a, b) => a - b))
  }

  // Re-default autoConfirm when the studio flips the type — but only while the
  // toggle hasn't been touched by hand, so an explicit override survives a type
  // change. `prevTypeRef` guards the mount-time run (editing already carries the
  // resolved value in defaultValues; don't clobber an explicit override on open).
  const [autoConfirmTouched, setAutoConfirmTouched] = useState(false)
  const prevTypeRef = useRef(type)
  useEffect(() => {
    if (prevTypeRef.current === type) return
    prevTypeRef.current = type
    if (!autoConfirmTouched) setValue('autoConfirm', resolveAutoConfirm({ type }))
  }, [type, autoConfirmTouched, setValue])

  // Inline quick-create: "create or link a subscription to this activity" without
  // leaving the form. Writes a minimal type (pricing is configured later in the
  // subscriptions manager) and auto-checks it in the allow-list above.
  const [newSubName, setNewSubName] = useState('')
  const [creatingSub, setCreatingSub] = useState(false)

  async function quickCreateSubscription() {
    const name = newSubName.trim()
    if (!name || creatingSub) return
    setCreatingSub(true)
    try {
      const ref = await addDoc(
        collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION),
        {
          name,
          description: null,
          source: 'internal',
          active: true,
          public: false,
          checkout_contact_mode: 'minimal',
          prices: [],
          order: subscriptionTypes.length,
          created_at: serverTimestamp(),
        },
      )
      setValue('subscriptionTypeIds', [...getValues('subscriptionTypeIds'), ref.id])
      setNewSubName('')
      qc.invalidateQueries({ queryKey: ['subscription-types', teamId] })
    } finally {
      setCreatingSub(false)
    }
  }

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
        prerequisites: data.prerequisites ?? '',
        confirmationInstructions: data.confirmationInstructions ?? '',
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
        autoConfirm: data.autoConfirm,
        ...(data.type === 'appointment'
          ? {
              durationsMinutes: [...data.durationsMinutes].sort((a, b) => a - b),
              max_participants: data.max_participants,
            }
          : { durationsMinutes: null, max_participants: null }),
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
        prerequisites: data.prerequisites ?? '',
        confirmationInstructions: data.confirmationInstructions ?? '',
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
        autoConfirm: data.autoConfirm,
        ...(data.type === 'appointment'
          ? {
              durationsMinutes: [...data.durationsMinutes].sort((a, b) => a - b),
              max_participants: data.max_participants,
            }
          : {}),
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
    await qc.invalidateQueries({ queryKey: ['activities'] })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      {/* Field-rich form (name/description/prereqs/instructions/type/durations/
          access/drop-in/media) — give it room on bigger screens, and scroll
          rather than overflow the viewport on short ones. */}
      <DialogContent className="sm:max-w-lg lg:max-w-2xl max-h-[90vh] overflow-y-auto">
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

          <div className="space-y-1.5">
            <Label htmlFor="act-prereq">{t('fieldPrerequisites')}</Label>
            <textarea
              id="act-prereq"
              {...register('prerequisites')}
              rows={2}
              placeholder={t('prerequisitesPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
            />
            <p className="text-xs text-muted-foreground">{t('prerequisitesHelp')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="act-confirm-instructions">{t('fieldConfirmationInstructions')}</Label>
            <textarea
              id="act-confirm-instructions"
              {...register('confirmationInstructions')}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y"
            />
            <p className="text-xs text-muted-foreground">{t('confirmationInstructionsHelp')}</p>
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
            {editing && watch('type') !== (editing.type ?? 'class') && (
              <p className="text-xs text-muted-foreground">
                {t('typeChangeWarning')}
              </p>
            )}
          </div>

          {/* Auto-confirm — a field, not implied by type. Shown for classes and
              appointments alike so either kind can require a review step. */}
          <div className="space-y-1.5 rounded-lg border p-3">
            <Controller
              name="autoConfirm"
              control={control}
              render={({ field }) => (
                <label className="flex items-start gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-primary"
                    checked={field.value}
                    onChange={(e) => {
                      setAutoConfirmTouched(true)
                      field.onChange(e.target.checked)
                    }}
                  />
                  <span>
                    <span className="font-medium">{t('fieldAutoConfirm')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {field.value ? t('autoConfirmHintOn') : t('autoConfirmHintOff')}
                    </span>
                  </span>
                </label>
              )}
            />
          </div>

          {/* Appointment-only: bookable session lengths + booking cap */}
          {type === 'appointment' && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label>{t('fieldDurationsMinutes')}</Label>
                <p className="text-xs text-muted-foreground">{t('durationsMinutesHint')}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {APPOINTMENT_DURATION_PRESETS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDuration(d)}
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                        durationsMinutes.includes(d)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-foreground'
                      }`}
                    >
                      {formatDuration(d)}
                    </button>
                  ))}
                </div>
                {errors.durationsMinutes && (
                  <p className="text-destructive text-xs">{errors.durationsMinutes.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="act-max-participants">{t('fieldMaxParticipants')}</Label>
                <Input
                  id="act-max-participants"
                  type="number"
                  min={1}
                  max={50}
                  className="w-24"
                  {...register('max_participants', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">{t('maxParticipantsHint')}</p>
              </div>
            </div>
          )}

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
                    <div className="flex items-center gap-2 pt-1.5 border-t mt-1.5">
                      <Input
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void quickCreateSubscription()
                          }
                        }}
                        placeholder={t('quickCreateSubPlaceholder')}
                        className="h-8 text-sm flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!newSubName.trim() || creatingSub}
                        onClick={() => void quickCreateSubscription()}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        {t('quickCreateSubButton')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('quickCreateSubHint')}</p>
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
          {activity.type === 'appointment' && (
            <Badge variant="secondary" className="text-xs">{t('type_appointment')}</Badge>
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
    await qc.invalidateQueries({ queryKey: ['activities'] })
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
    await qc.invalidateQueries({ queryKey: ['activities'] })
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
