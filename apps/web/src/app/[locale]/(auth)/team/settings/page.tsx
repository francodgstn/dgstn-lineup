'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs,
  addDoc, deleteDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import {
  TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION, ALERT_PRESETS_SUBCOLLECTION,
} from '@lineup/shared'
import type { Team, SubscriptionType, AlertScheduleType, RankingSystem, RankLevel, TeamIntegration, PaymentGatewayType } from '@lineup/shared'
import { CalendarDays, Timer, Plus, Pencil, Trash2, Star } from 'lucide-react'
import { RANK_PRESETS } from '@/lib/rank-presets'

// ─── constants ────────────────────────────────────────────────────────────────

const SPORT_TYPES = [
  'Martial arts', 'Football / Soccer', 'Basketball', 'Volleyball', 'Tennis',
  'Swimming', 'Gymnastics', 'CrossFit / Fitness', 'Yoga / Pilates', 'Dance',
  'Rugby', 'Cycling', 'Athletics', 'Other',
]

const SLUG_REGEX = /^[a-z0-9-]+$/

// ─── types ────────────────────────────────────────────────────────────────────

interface AlertPreset {
  id: string
  name: string
  description?: string
  schedule_type: AlertScheduleType
  schedule_value?: number
  message: string
  show_in_app?: boolean
}

// ─── schemas ──────────────────────────────────────────────────────────────────

const generalSchema = z.object({
  name: z.string().min(2, 'At least 2 characters').max(60, 'Max 60 characters'),
  description: z.string().max(500, 'Max 500 characters').optional(),
  sport_type: z.string().optional(),
  slug: z
    .string()
    .min(3, 'At least 3 characters')
    .max(50, 'Max 50 characters')
    .regex(SLUG_REGEX, 'Only lowercase letters, numbers and hyphens'),
})
type GeneralData = z.infer<typeof generalSchema>

const subTypeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  source: z.enum(['internal', 'aggregator']).default('internal'),
  active: z.boolean().optional(),
})
type SubTypeData = z.infer<typeof subTypeSchema>

const presetSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  schedule_type: z.enum(['sessions_countdown', 'datetime']),
  schedule_value: z.coerce.number().min(1).optional(),
  message: z.string().min(1).max(500),
  show_in_app: z.boolean().optional(),
})
type PresetData = z.infer<typeof presetSchema>

const gatewaySchema = z.object({
  gatewayType: z.enum(['stripe', 'payrexx']),
  identifier: z.string().min(1, 'Required'),
  currency: z.string().min(3).max(3).toUpperCase(),
})
type GatewayFormData = z.infer<typeof gatewaySchema>

// ─── data helpers ─────────────────────────────────────────────────────────────

async function isSlugAvailable(slug: string, teamId: string): Promise<boolean> {
  const snap = await getDocs(query(collection(db, TEAMS_COLLECTION), where('slug', '==', slug)))
  return snap.docs.every((d) => d.id === teamId)
}

function useTeam(teamId: string | null) {
  return useQuery<Team | null>({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Team) : null
    },
  })
}

function useSubscriptionTypes(teamId: string | null) {
  return useQuery<SubscriptionType[]>({
    queryKey: ['subscription-types', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionType)
    },
  })
}

function useAlertPresets(teamId: string | null) {
  return useQuery<AlertPreset[]>({
    queryKey: ['alert-presets', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AlertPreset)
    },
  })
}

function useGatewayIntegrations(teamId: string | null) {
  return useQuery<TeamIntegration[]>({
    queryKey: ['gateway-integrations', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        query(collection(db, TEAMS_COLLECTION, teamId, 'integrations'), where('type', '==', 'payment_gateway'))
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamIntegration)
    },
  })
}

// ─── general form ─────────────────────────────────────────────────────────────

function GeneralForm({ team, teamId }: { team: Team; teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const [slugError, setSlugError] = useState<string | null>(null)
  const [slugChecking, setSlugChecking] = useState(false)
  const [saved, setSaved] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<GeneralData>({
    resolver: zodResolver(generalSchema),
    defaultValues: {
      name: team.name,
      description: team.description ?? '',
      sport_type: team.sport_type ?? '',
      slug: team.slug,
    },
  })

  async function onSlugBlur(slug: string) {
    if (!SLUG_REGEX.test(slug) || slug.length < 3) return
    setSlugChecking(true)
    setSlugError(null)
    const available = await isSlugAvailable(slug, teamId)
    setSlugChecking(false)
    if (!available) setSlugError(t('slugTaken'))
  }

  async function onSubmit(data: GeneralData) {
    if (slugError) return
    await updateDoc(doc(db, TEAMS_COLLECTION, teamId), {
      name: data.name,
      description: data.description ?? '',
      sport_type: data.sport_type ?? '',
      slug: data.slug,
    })
    await qc.invalidateQueries({ queryKey: ['team', teamId] })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">{t('teamName')}</Label>
        <Input id="name" {...register('name')} />
        {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">{t('description')}</Label>
        <textarea
          id="description"
          {...register('description')}
          rows={3}
          placeholder={t('descriptionPlaceholder')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
        />
        {errors.description && <p className="text-destructive text-xs">{errors.description.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sport_type">{t('sportType')}</Label>
        <Controller
          name="sport_type"
          control={control}
          render={({ field }) => (
            <Select value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('sportTypeNone')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('sportTypeNone')}</SelectItem>
                {SPORT_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">{t('slug')}</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground shrink-0 select-none">/portal/</span>
          <Input
            id="slug"
            {...register('slug')}
            onBlur={(e) => onSlugBlur(e.target.value)}
            placeholder="my-club"
            className="font-mono"
          />
        </div>
        {slugChecking && <p className="text-muted-foreground text-xs">{t('slugChecking')}</p>}
        {slugError && <p className="text-destructive text-xs">{slugError}</p>}
        {errors.slug && !slugError && <p className="text-destructive text-xs">{errors.slug.message}</p>}
        <p className="text-xs text-muted-foreground">{t('slugHelp')}</p>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting || !isDirty || !!slugError || slugChecking}>
          {isSubmitting ? t('saving') : t('save')}
        </Button>
        {saved && <span className="text-sm text-green-600">{t('saved')}</span>}
      </div>
    </form>
  )
}

// ─── subscription types tab ───────────────────────────────────────────────────

function SubTypeDialog({
  open, onOpenChange, teamId, editing, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  teamId: string; editing: SubscriptionType | null; onSaved: () => void
}) {
  const t = useTranslations('TeamSettings')

  const { register, handleSubmit, reset, watch, setValue, formState: { isSubmitting } } = useForm<SubTypeData>({
    resolver: zodResolver(subTypeSchema),
    defaultValues: {
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      source: editing?.source ?? 'internal',
      active: editing?.active ?? true,
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        name: editing?.name ?? '',
        description: editing?.description ?? '',
        source: editing?.source ?? 'internal',
        active: editing?.active ?? true,
      })
    }
  }, [open, editing, reset])

  const source = watch('source')
  const active = watch('active') ?? true

  async function onSubmit(data: SubTypeData) {
    const payload = {
      name: data.name,
      description: data.description || null,
      source: data.source,
      active: data.active ?? true,
    }
    if (editing) {
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, editing.id), payload)
    } else {
      await addDoc(collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION), {
        ...payload,
        created_at: serverTimestamp(),
      })
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? t('editSubscriptionType') : t('addSubscriptionType')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 py-1">
          <div className="space-y-1">
            <Label>{t('fieldSubTypeName')}</Label>
            <Input {...register('name')} placeholder="e.g. Monthly pass, Fitpass" />
          </div>
          <div className="space-y-1">
            <Label>{t('fieldSubTypeDesc')}</Label>
            <Textarea
              {...register('description')}
              rows={2}
              placeholder="Optional context — e.g. Unlimited access, valid for the whole month"
              className="resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('fieldSubTypeSource')}</Label>
            <div className="flex gap-2">
              {(['internal', 'aggregator'] as const).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setValue('source', val)}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors text-left ${
                    source === val
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:border-foreground/30'
                  }`}
                >
                  <p className="font-medium">{t(val === 'internal' ? 'subTypeSourceInternal' : 'subTypeSourceAggregator')}</p>
                  <p className="text-xs font-normal mt-0.5 text-muted-foreground">
                    {val === 'internal' ? t('subTypeSourceInternalDesc') : t('subTypeSourceAggregatorDesc')}
                  </p>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <Label>{t('subTypeActive')}</Label>
              <p className="text-xs text-muted-foreground">{t('subTypeActiveDesc')}</p>
            </div>
            <Switch
              checked={active}
              onCheckedChange={(v) => setValue('active', v)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SubscriptionTypesTab({ teamId }: { teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const { data: types = [], isLoading } = useSubscriptionTypes(teamId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SubscriptionType | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['subscription-types', teamId] })

  const openAdd = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (st: SubscriptionType) => { setEditing(st); setDialogOpen(true) }

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, id))
    setDeleting(null)
    invalidate()
  }

  if (isLoading) return (
    <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1.5" />{t('addSubscriptionType')}
        </Button>
      </div>

      {types.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {t('noSubscriptionTypes')}
        </div>
      ) : (
        <div className="space-y-2">
          {types.map((st) => (
            <div key={st.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{st.name}</p>
                  <Badge variant={st.source === 'aggregator' ? 'secondary' : 'outline'} className="text-xs">
                    {t(st.source === 'aggregator' ? 'subTypeSourceAggregator' : 'subTypeSourceInternal')}
                  </Badge>
                  {st.active === false && (
                    <Badge variant="outline" className="text-xs">{t('subTypeInactive')}</Badge>
                  )}
                </div>
                {st.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{st.description}</p>}
              </div>
              <button onClick={() => openEdit(st)} className="p-1.5 rounded hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => setDeleting(st.id)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <SubTypeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        teamId={teamId}
        editing={editing}
        onSaved={invalidate}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('deleteSubType')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {t('deleteSubTypeConfirm', { name: types.find((s) => s.id === deleting)?.name ?? '' })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && handleDelete(deleting)}>
              {t('deleteSubType')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── alert presets tab ────────────────────────────────────────────────────────

function PresetDialog({
  open, onOpenChange, teamId, editing, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  teamId: string; editing: AlertPreset | null; onSaved: () => void
}) {
  const t = useTranslations('TeamSettings')

  const { register, handleSubmit, watch, reset, formState: { isSubmitting } } = useForm<PresetData>({
    resolver: zodResolver(presetSchema),
    defaultValues: {
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      schedule_type: editing?.schedule_type ?? 'sessions_countdown',
      schedule_value: editing?.schedule_value ?? 10,
      message: editing?.message ?? '',
      show_in_app: editing?.show_in_app ?? false,
    },
  })

  const scheduleType = watch('schedule_type')

  async function onSubmit(data: PresetData) {
    const payload = {
      name: data.name,
      description: data.description || null,
      schedule_type: data.schedule_type,
      schedule_value: data.schedule_type === 'sessions_countdown' ? Number(data.schedule_value) : null,
      message: data.message,
      show_in_app: data.show_in_app ?? false,
    }
    if (editing) {
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION, editing.id), payload)
    } else {
      await addDoc(collection(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION), {
        ...payload,
        created_at: serverTimestamp(),
      })
    }
    onSaved()
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? t('editAlertPreset') : t('addAlertPreset')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 py-1">
          <div className="space-y-1">
            <Label>{t('alertPresetName')}</Label>
            <Input {...register('name')} placeholder="e.g. 10th session gift" />
          </div>
          <div className="space-y-1">
            <Label>{t('alertPresetDesc')}</Label>
            <Input {...register('description')} />
          </div>

          {/* Schedule type */}
          <div className="space-y-1.5">
            <Label>{t('alertPresetScheduleType')}</Label>
            <div className="flex gap-2">
              {(['sessions_countdown', 'datetime'] as AlertScheduleType[]).map((type) => (
                <label key={type} className="flex-1 cursor-pointer">
                  <input type="radio" value={type} {...register('schedule_type')} className="sr-only" />
                  <div className={`flex items-center gap-1.5 justify-center py-1.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    scheduleType === type
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}>
                    {type === 'sessions_countdown' ? <Timer className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
                    {type === 'sessions_countdown' ? t('alertTypeSessionsCountdown') : t('alertTypeDatetime')}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {scheduleType === 'sessions_countdown' ? (
            <div className="space-y-1">
              <Label>{t('alertPresetSessionCount')}</Label>
              <Input type="number" min="1" {...register('schedule_value')} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground rounded-lg bg-muted px-3 py-2">
              {t('alertPresetDateInfo')}
            </p>
          )}

          <div className="space-y-1">
            <Label>{t('alertPresetMessage')}</Label>
            <textarea
              {...register('message')}
              rows={3}
              placeholder="e.g. Time for the welcome gift!"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" {...register('show_in_app')} className="rounded border-input" />
            {t('alertPresetShowInApp')}
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AlertPresetsTab({ teamId }: { teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const { data: presets = [], isLoading } = useAlertPresets(teamId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AlertPreset | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['alert-presets', teamId] })

  const openAdd = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (p: AlertPreset) => { setEditing(p); setDialogOpen(true) }

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION, id))
    setDeleting(null)
    invalidate()
  }

  if (isLoading) return (
    <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('presetsInfo')}</p>

      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1.5" />{t('addAlertPreset')}
        </Button>
      </div>

      {presets.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {t('noAlertPresets')}
        </div>
      ) : (
        <div className="space-y-2">
          {presets.map((p) => (
            <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border">
              <div className="mt-0.5 shrink-0 text-muted-foreground">
                {p.schedule_type === 'sessions_countdown'
                  ? <Timer className="h-4 w-4" />
                  : <CalendarDays className="h-4 w-4" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{p.name}</p>
                  <Badge variant="outline" className="text-xs">
                    {p.schedule_type === 'sessions_countdown'
                      ? `${p.schedule_value} sessions`
                      : 'date-based'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.message}</p>
              </div>
              <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => setDeleting(p.id)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <PresetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        teamId={teamId}
        editing={editing}
        onSaved={invalidate}
      />

      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('deletePreset')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {t('deletePresetConfirm', { name: presets.find((p) => p.id === deleting)?.name ?? '' })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && handleDelete(deleting)}>
              {t('deletePreset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── ranking tab ──────────────────────────────────────────────────────────────

const SLUG_REGEX_RANK = /^[a-z0-9-]+$/

function generateId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
}

interface RankSystemFormState {
  id: string
  name: string
  levels: RankLevel[]
  is_primary: boolean
}

function emptySystem(): RankSystemFormState {
  return { id: '', name: '', levels: [], is_primary: false }
}

function RankSystemDialog({
  open, onOpenChange, initial, existingIds, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  initial: RankSystemFormState | null
  existingIds: string[]
  onSave: (s: RankSystemFormState) => void
}) {
  const t = useTranslations('TeamSettings')
  const [form, setForm] = useState<RankSystemFormState>(initial ?? emptySystem())
  const [presetOpen, setPresetOpen] = useState(false)
  const [idTouched, setIdTouched] = useState(false)
  const [idError, setIdError] = useState('')

  const isEdit = !!initial

  useEffect(() => {
    if (open) {
      setForm(initial ?? emptySystem())
      setIdTouched(false)
      setIdError('')
      setPresetOpen(false)
    }
  }, [open, initial])

  const setName = (name: string) => {
    setForm((f) => ({
      ...f,
      name,
      id: idTouched ? f.id : generateId(name),
    }))
  }

  const setId = (id: string) => {
    setIdTouched(true)
    setForm((f) => ({ ...f, id }))
    if (!SLUG_REGEX_RANK.test(id)) {
      setIdError(t('rankingSystemIdHelp'))
    } else if (!isEdit && existingIds.includes(id)) {
      setIdError('ID already in use.')
    } else {
      setIdError('')
    }
  }

  const addLevel = () => {
    const nextVal = form.levels.length > 0
      ? Math.max(...form.levels.map((l) => l.value)) + 1
      : 0
    setForm((f) => ({ ...f, levels: [...f.levels, { value: nextVal, label: '', color: '#9CA3AF' }] }))
  }

  const updateLevel = (idx: number, patch: Partial<RankLevel>) => {
    setForm((f) => {
      const levels = f.levels.map((l, i) => i === idx ? { ...l, ...patch } : l)
      return { ...f, levels }
    })
  }

  const removeLevel = (idx: number) => {
    setForm((f) => ({ ...f, levels: f.levels.filter((_, i) => i !== idx) }))
  }

  const applyPreset = (preset: typeof RANK_PRESETS[number]) => {
    setForm((f) => ({
      ...f,
      name: f.name || preset.name,
      id: f.id || (!idTouched ? generateId(preset.name) : f.id),
      levels: preset.levels.map((l) => ({ ...l })),
    }))
    setPresetOpen(false)
  }

  const canSave = form.name.trim().length > 0
    && form.id.length > 0
    && SLUG_REGEX_RANK.test(form.id)
    && !idError
    && form.levels.length > 0
    && form.levels.every((l) => l.label.trim().length > 0)

  return (
    <>
      <Dialog open={open && !presetOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? t('editRankingSystem') : t('addRankingSystem')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Preset picker button */}
            {!isEdit && (
              <button
                type="button"
                onClick={() => setPresetOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-dashed text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                <Star className="h-3.5 w-3.5" />
                {t('rankingPresetsTitle')}
              </button>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('rankingSystemName')}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('rankingSystemNamePlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('rankingSystemId')}</Label>
                <Input
                  value={form.id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="bjj-belts"
                  disabled={isEdit}
                  className="font-mono text-sm"
                />
                {idError && <p className="text-xs text-destructive">{idError}</p>}
                {!idError && <p className="text-xs text-muted-foreground">{t('rankingSystemIdHelp')}</p>}
              </div>
            </div>

            {/* Levels */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('rankingSystemLevels', { count: form.levels.length })}</Label>
                <button
                  type="button"
                  onClick={addLevel}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" />{t('addLevel')}
                </button>
              </div>
              {form.levels.length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">{t('rankingNoSystems')}</p>
              )}
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {form.levels.map((level, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{level.value}</span>
                    <input
                      type="color"
                      value={level.color ?? '#9CA3AF'}
                      onChange={(e) => updateLevel(idx, { color: e.target.value })}
                      className="h-7 w-7 rounded border border-input cursor-pointer shrink-0 p-0.5"
                    />
                    <Input
                      value={level.label}
                      onChange={(e) => updateLevel(idx, { label: e.target.value })}
                      placeholder={t('rankingLevelLabel')}
                      className="h-7 text-sm flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeLevel(idx)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!canSave} onClick={() => { onSave(form); onOpenChange(false) }}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preset picker */}
      <Dialog open={presetOpen} onOpenChange={setPresetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('rankingPresetsTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            {RANK_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className="w-full flex items-start gap-3 p-3 rounded-lg border text-left hover:bg-muted transition-colors"
              >
                <div className="flex gap-0.5 shrink-0 mt-0.5">
                  {preset.levels.slice(0, 5).map((l, i) => (
                    <div
                      key={i}
                      className="h-3 w-3 rounded-full border border-border"
                      style={{ background: l.color }}
                    />
                  ))}
                  {preset.levels.length > 5 && (
                    <span className="text-xs text-muted-foreground ml-0.5">+{preset.levels.length - 5}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{preset.name}</p>
                  <p className="text-xs text-muted-foreground">{preset.levels.length} levels</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RankingTab({ teamId, team }: { teamId: string; team: Team }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RankSystemFormState | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const systems: RankingSystem[] = team.ranking_systems ?? []

  const saveToFirestore = async (next: RankingSystem[]) => {
    setSaving(true)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId), { ranking_systems: next })
      qc.invalidateQueries({ queryKey: ['team', teamId] })
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async (form: RankSystemFormState) => {
    const system: RankingSystem = {
      id: form.id,
      name: form.name,
      levels: form.levels,
      is_primary: form.is_primary,
    }
    const next = editing
      ? systems.map((s) => s.id === editing.id ? system : s)
      : [...systems, system]
    await saveToFirestore(next)
    setEditing(null)
  }

  const handleSetPrimary = async (id: string) => {
    const next = systems.map((s) => ({ ...s, is_primary: s.id === id }))
    await saveToFirestore(next)
  }

  const handleClearPrimary = async () => {
    const next = systems.map((s) => ({ ...s, is_primary: false }))
    await saveToFirestore(next)
  }

  const handleDelete = async (id: string) => {
    const next = systems.filter((s) => s.id !== id)
    await saveToFirestore(next)
    setDeleting(null)
  }

  const openAdd = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (s: RankingSystem) => {
    setEditing({ id: s.id, name: s.name, levels: s.levels.map((l) => ({ ...l })), is_primary: s.is_primary ?? false })
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('rankingSystems')}</p>
        <Button size="sm" onClick={openAdd} disabled={saving}>
          <Plus className="h-4 w-4 mr-1.5" />{t('addRankingSystem')}
        </Button>
      </div>

      {systems.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {t('rankingNoSystems')}
        </div>
      ) : (
        <div className="space-y-2">
          {systems.map((s) => (
            <div key={s.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{s.name}</p>
                    {s.is_primary && (
                      <Badge variant="default" className="text-xs">{t('rankingSystemPrimary')}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">{s.id}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('rankingSystemLevels', { count: s.levels.length })}
                  </p>
                </div>
                {s.is_primary ? (
                  <button
                    onClick={handleClearPrimary}
                    disabled={saving}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
                  >
                    {t('primaryModeAuto')}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSetPrimary(s.id)}
                    disabled={saving}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
                  >
                    {t('rankingSystemSetPrimary')}
                  </button>
                )}
                <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-muted transition-colors">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={() => setDeleting(s.id)}
                  className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Level color strip */}
              <div className="flex gap-1 flex-wrap">
                {s.levels.map((l) => (
                  <div key={l.value} className="flex items-center gap-1">
                    <div
                      className="h-3 w-3 rounded-full border border-border shrink-0"
                      style={{ background: l.color }}
                    />
                    <span className="text-xs text-muted-foreground">{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!systems.some((s) => s.is_primary) && systems.length > 1 && (
            <p className="text-xs text-muted-foreground px-1">
              {t('primaryModeAuto')}
            </p>
          )}
        </div>
      )}

      <RankSystemDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null) }}
        initial={editing}
        existingIds={systems.filter((s) => !editing || s.id !== editing.id).map((s) => s.id)}
        onSave={handleSave}
      />

      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('deleteRankingSystem')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {t('deleteRankingSystemConfirm', { name: systems.find((s) => s.id === deleting)?.name ?? '' })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={saving} onClick={() => deleting && handleDelete(deleting)}>
              {t('deleteRankingSystem')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── payments tab ─────────────────────────────────────────────────────────────

function PaymentsTab({ teamId }: { teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: integrations = [], isLoading } = useGatewayIntegrations(teamId)

  const [showDialog, setShowDialog] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<GatewayFormData>({
    resolver: zodResolver(gatewaySchema),
    defaultValues: { gatewayType: 'stripe', identifier: '', currency: 'CHF' },
  })

  const selectedType = watch('gatewayType') as PaymentGatewayType

  function openAdd() {
    reset({ gatewayType: 'stripe', identifier: '', currency: 'CHF' })
    setEditingId(null)
    setShowDialog(true)
  }

  function openEdit(item: TeamIntegration) {
    const cfg = item.config
    reset({
      gatewayType: cfg.type,
      identifier: cfg.type === 'stripe' ? cfg.publishable_key : cfg.instance_name,
      currency: cfg.currency,
    })
    setEditingId(item.id)
    setShowDialog(true)
  }

  async function onSubmit(values: GatewayFormData) {
    setSaving(true)
    try {
      const config =
        values.gatewayType === 'stripe'
          ? { type: 'stripe' as const, publishable_key: values.identifier, currency: values.currency }
          : { type: 'payrexx' as const, instance_name: values.identifier, currency: values.currency }

      if (editingId) {
        await updateDoc(doc(db, TEAMS_COLLECTION, teamId, 'integrations', editingId), {
          config,
          updated_at: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, TEAMS_COLLECTION, teamId, 'integrations'), {
          teamId,
          type: 'payment_gateway',
          enabled: true,
          config,
          created: serverTimestamp(),
          createdBy: user?.uid ?? '',
        })
      }
      await qc.invalidateQueries({ queryKey: ['gateway-integrations', teamId] })
      setShowDialog(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleEnabled(item: TeamIntegration) {
    await updateDoc(doc(db, TEAMS_COLLECTION, teamId, 'integrations', item.id), {
      enabled: !item.enabled,
      updated_at: serverTimestamp(),
    })
    await qc.invalidateQueries({ queryKey: ['gateway-integrations', teamId] })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, 'integrations', deleteTarget))
    await qc.invalidateQueries({ queryKey: ['gateway-integrations', teamId] })
    setDeleteTarget(null)
  }

  if (isLoading) return <div className="space-y-2"><Skeleton className="h-16 rounded" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t('paymentsGateway')}</p>
        <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" />{t('paymentsAddGateway')}</Button>
      </div>

      {integrations.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">{t('paymentsNoGateway')}</p>
      ) : (
        <div className="divide-y border rounded-lg">
          {integrations.map((item) => {
            const cfg = item.config
            const label = cfg.type === 'stripe' ? 'Stripe' : 'Payrexx'
            const identifier = cfg.type === 'stripe' ? cfg.publishable_key : cfg.instance_name
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground truncate">{identifier} · {cfg.currency}</p>
                </div>
                <Badge variant={item.enabled ? 'default' : 'outline'} className="text-xs">
                  {item.enabled ? t('paymentsEnabled') : t('paymentsDisabled')}
                </Badge>
                <Switch checked={item.enabled} onCheckedChange={() => handleToggleEnabled(item)} />
                <button onClick={() => openEdit(item)} className="text-muted-foreground hover:text-foreground p-1">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setDeleteTarget(item.id)} className="text-muted-foreground hover:text-destructive p-1">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('paymentsSecretNote')}</p>

      {/* Add/edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? t('paymentsEditGateway') : t('paymentsAddGateway')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>{t('paymentsGatewayType')}</Label>
              <Controller
                name="gatewayType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <span className="flex flex-1 text-left text-sm truncate">
                        {field.value === 'stripe' ? 'Stripe' : field.value === 'payrexx' ? 'Payrexx' : <span className="text-muted-foreground">—</span>}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="payrexx">Payrexx</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{selectedType === 'stripe' ? t('paymentsPublishableKey') : 'Instance name'}</Label>
              <Input {...register('identifier')} placeholder={selectedType === 'stripe' ? 'pk_live_…' : 'my-instance'} />
              {errors.identifier && <p className="text-xs text-destructive">{errors.identifier.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('paymentsCurrency')}</Label>
              <Input {...register('currency')} placeholder="CHF" maxLength={3} className="uppercase w-24" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('paymentsDeleteGateway')}</AlertDialogTitle>
            <AlertDialogDescription>{t('paymentsDeleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              {t('paymentsDeleteGateway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'subscriptions' | 'alerts' | 'ranking' | 'payments'

export default function TeamSettingsPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
  const t = useTranslations('TeamSettings')
  const [tab, setTab] = useState<SettingsTab>('general')

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (!team || !currentTeamId) {
    return <p className="text-muted-foreground">{t('noTeam')}</p>
  }

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: t('tabGeneral') },
    { id: 'subscriptions', label: t('tabSubscriptionTypes') },
    { id: 'alerts', label: t('tabAlerts') },
    { id: 'ranking', label: t('tabRanking') },
    { id: 'payments', label: t('tabPayments') },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{team.name}</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 border-b">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {tab === 'general' && <GeneralForm team={team} teamId={currentTeamId} />}
          {tab === 'subscriptions' && <SubscriptionTypesTab teamId={currentTeamId} />}
          {tab === 'alerts' && <AlertPresetsTab teamId={currentTeamId} />}
          {tab === 'ranking' && <RankingTab teamId={currentTeamId} team={team} />}
          {tab === 'payments' && <PaymentsTab teamId={currentTeamId} />}
        </CardContent>
      </Card>
    </div>
  )
}
