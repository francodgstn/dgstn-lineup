'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { CustomFieldsTab } from '@/plugins/custom-fields/CustomFieldsTab'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  TEAMS_COLLECTION,
  ALERT_PRESETS_SUBCOLLECTION,
  COURSES_COLLECTION,
  SITE_DRAFTS_COLLECTION,
  AFFILIATION_TYPES_SUBCOLLECTION,
  isReservedSlug,
  planSupportsAffiliations,
} from '@linyup/shared'
import type {
  Team,
  AlertScheduleType,
  RankingSystem,
  RankLevel,
  TeamIntegration,
  PaymentGatewayType,
  PublicSurface,
  RoleLabelPreset,
  ContactRoleLabel,
  AffiliationType,
  AffiliationIssuer,
} from '@linyup/shared'
import {
  CalendarDays,
  Timer,
  Plus,
  Pencil,
  Trash2,
  Star,
  Building2,
  Mail,
  Copy,
  CheckCircle2,
  Clock,
  XCircle,
  Lock,
} from 'lucide-react'
import { ConnectPaymentsCard } from '@/components/connect/ConnectPaymentsCard'
import { RANK_PRESETS } from '@/lib/rank-presets'
import { useRankingSystems } from '@/hooks/useRankingSystems'
import { useEmailSenderSettings } from '@/hooks/useEmailSenderSettings'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { Separator } from '@/components/ui/separator'

// ─── constants ────────────────────────────────────────────────────────────────

const SPORT_TYPES = [
  'Martial arts',
  'Football / Soccer',
  'Basketball',
  'Volleyball',
  'Tennis',
  'Swimming',
  'Gymnastics',
  'CrossFit / Fitness',
  'Yoga / Pilates',
  'Dance',
  'Rugby',
  'Cycling',
  'Athletics',
  'Other',
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
  default_public_surface: z
    .enum(['bio-link', 'site', 'space', 'booking'])
    .default('bio-link'),
})
type GeneralData = z.infer<typeof generalSchema>

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
  // Payrexx-specific (optional — only submitted when gatewayType === 'payrexx')
  webhookSigningSecret: z.string().optional(),
  defaultSubscriptionTypeId: z.string().optional(),
})
type GatewayFormData = z.infer<typeof gatewaySchema>

// ─── data helpers ─────────────────────────────────────────────────────────────

async function isSlugAvailable(slug: string, teamId: string): Promise<boolean> {
  if (isReservedSlug(slug)) return false
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

function useAlertPresets(teamId: string | null) {
  return useQuery<AlertPreset[]>({
    queryKey: ['alert-presets', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION)
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AlertPreset)
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
        query(
          collection(db, TEAMS_COLLECTION, teamId, 'integrations'),
          where('type', '==', 'payment_gateway')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as TeamIntegration)
    },
  })
}

// ─── data helpers for GeneralForm surface picker ─────────────────────────────

function useHasPublishedCourse(teamId: string | null) {
  return useQuery<boolean>({
    queryKey: ['has-published-course', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, COURSES_COLLECTION),
          where('teamId', '==', teamId),
          where('status', '==', 'published'),
        ),
      )
      return !snap.empty
    },
  })
}

function useIsSiteEnabled(teamId: string | null) {
  return useQuery<boolean>({
    queryKey: ['site-draft-enabled', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDoc(doc(db, SITE_DRAFTS_COLLECTION, teamId!))
      return snap.exists() && snap.data()?.enabled === true
    },
  })
}

// ─── contact role label form ──────────────────────────────────────────────────

const ROLE_LABEL_PRESETS: RoleLabelPreset[] = [
  'student', 'athlete', 'client', 'player', 'participant', 'custom',
]

/** Preset → default singular/plural in English; the UI shows i18n label for
 *  the dropdown but the stored singular/plural should be the user's chosen text. */
const PRESET_DEFAULTS: Record<Exclude<RoleLabelPreset, 'custom'>, { singular: string; plural: string }> = {
  student: { singular: 'Student', plural: 'Students' },
  athlete: { singular: 'Athlete', plural: 'Athletes' },
  client: { singular: 'Client', plural: 'Clients' },
  player: { singular: 'Player', plural: 'Players' },
  participant: { singular: 'Participant', plural: 'Participants' },
}

function ContactRoleLabelForm({ team, teamId }: { team: Team; teamId: string }) {
  const t = useTranslations('TeamSettings')
  const tRole = useTranslations('RoleLabel')
  const qc = useQueryClient()

  const current = team.contact_role_label
  const [preset, setPreset] = useState<RoleLabelPreset | ''>(current?.preset ?? '')
  const [singular, setSingular] = useState(current?.singular ?? '')
  const [plural, setPlural] = useState(current?.plural ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isCustom = preset === 'custom'
  const isDirty =
    (preset || '') !== (current?.preset ?? '') ||
    singular !== (current?.singular ?? '') ||
    plural !== (current?.plural ?? '')

  function onPresetChange(p: RoleLabelPreset | '') {
    setPreset(p)
    if (p && p !== 'custom') {
      const defs = PRESET_DEFAULTS[p as Exclude<RoleLabelPreset, 'custom'>]
      setSingular(defs.singular)
      setPlural(defs.plural)
    }
  }

  async function onSave() {
    if (!singular.trim() || !plural.trim()) return
    setSaving(true)
    try {
      const label: ContactRoleLabel = {
        ...(preset ? { preset: preset as RoleLabelPreset } : {}),
        singular: singular.trim(),
        plural: plural.trim(),
      }
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId), { contact_role_label: label })
      await qc.invalidateQueries({ queryKey: ['team', teamId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 pt-4 border-t">
      <div>
        <p className="text-sm font-medium">{t('roleLabelTitle')}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('roleLabelHelp')}</p>
      </div>
      <div className="space-y-1.5">
        <Label>{t('roleLabelPreset')}</Label>
        <Select value={preset} onValueChange={(v) => onPresetChange(v as RoleLabelPreset | '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('roleLabelPresetNone')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('roleLabelPresetNone')}</SelectItem>
            {ROLE_LABEL_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>{tRole(`preset_${p}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Singular + plural — always visible so user can always tweak */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t('roleLabelSingular')}</Label>
          <Input
            value={singular}
            onChange={(e) => { setSingular(e.target.value); if (preset !== 'custom') setPreset('custom') }}
            placeholder={isCustom ? t('roleLabelSingular') : ''}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t('roleLabelPlural')}</Label>
          <Input
            value={plural}
            onChange={(e) => { setPlural(e.target.value); if (preset !== 'custom') setPreset('custom') }}
            placeholder={isCustom ? t('roleLabelPlural') : ''}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={onSave} disabled={saving || !isDirty || !singular.trim() || !plural.trim()}>
          {saving ? t('saving') : t('save')}
        </Button>
        {saved && <span className="text-sm text-green-600">{t('saved')}</span>}
      </div>
    </div>
  )
}

// ─── general form ─────────────────────────────────────────────────────────────

function GeneralForm({ team, teamId }: { team: Team; teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const [slugError, setSlugError] = useState<string | null>(null)
  const [slugChecking, setSlugChecking] = useState(false)
  const [saved, setSaved] = useState(false)

  const { isInstalled } = useInstalledPlugins()
  const { data: hasPublishedCourse = false } = useHasPublishedCourse(teamId)
  const { data: isSiteEnabled = false } = useIsSiteEnabled(teamId)

  // Surfaces available depend on installed plugins + live state.
  // bio-link is always available.
  // booking is always available (booking is a core feature, not a plugin).
  // site: only if website plugin installed AND draft is enabled (= published).
  // space: only if online-courses plugin installed AND ≥1 published non-archived course.
  const availableSurfaces: { value: PublicSurface; label: string }[] = [
    { value: 'bio-link', label: t('defaultSurfaceBioLink') },
    { value: 'booking', label: t('defaultSurfaceBooking') },
    ...(isInstalled('website') && isSiteEnabled
      ? [{ value: 'site' as PublicSurface, label: t('defaultSurfaceSite') }]
      : []),
    ...(isInstalled('online-courses') && hasPublishedCourse
      ? [{ value: 'space' as PublicSurface, label: t('defaultSurfaceSpace') }]
      : []),
  ]

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
      default_public_surface: (team.default_public_surface as PublicSurface | undefined) ?? 'bio-link',
    },
  })

  async function onSlugBlur(slug: string) {
    if (!SLUG_REGEX.test(slug) || slug.length < 3) return
    setSlugChecking(true)
    setSlugError(null)
    const available = await isSlugAvailable(slug, teamId)
    setSlugChecking(false)
    if (!available) setSlugError(isReservedSlug(slug) ? t('slugReserved') : t('slugTaken'))
  }

  async function onSubmit(data: GeneralData) {
    if (slugError) return
    await updateDoc(doc(db, TEAMS_COLLECTION, teamId), {
      name: data.name,
      description: data.description ?? '',
      sport_type: data.sport_type ?? '',
      slug: data.slug,
      default_public_surface: data.default_public_surface,
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
        {errors.description && (
          <p className="text-destructive text-xs">{errors.description.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sport_type">{t('sportType')}</Label>
        <Controller
          name="sport_type"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value || '__none__'}
              onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('sportTypeNone')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('sportTypeNone')}</SelectItem>
                {SPORT_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">{t('slug')}</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground shrink-0 select-none">
            /public/
          </span>
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
        {errors.slug && !slugError && (
          <p className="text-destructive text-xs">{errors.slug.message}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('slugHelp')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="default_public_surface">{t('defaultPublicSurface')}</Label>
        <Controller
          name="default_public_surface"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(v) => field.onChange(v as PublicSurface)}
            >
              <SelectTrigger className="w-full" id="default_public_surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableSurfaces.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-muted-foreground">{t('defaultPublicSurfaceHelp')}</p>
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

// ─── alert presets tab ────────────────────────────────────────────────────────

function PresetDialog({
  open,
  onOpenChange,
  teamId,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  editing: AlertPreset | null
  onSaved: () => void
}) {
  const t = useTranslations('TeamSettings')

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<PresetData>({
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
      schedule_value:
        data.schedule_type === 'sessions_countdown' ? Number(data.schedule_value) : null,
      message: data.message,
      show_in_app: data.show_in_app ?? false,
    }
    if (editing) {
      await updateDoc(
        doc(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION, editing.id),
        payload
      )
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
                  <input
                    type="radio"
                    value={type}
                    {...register('schedule_type')}
                    className="sr-only"
                  />
                  <div
                    className={`flex items-center gap-1.5 justify-center py-1.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      scheduleType === type
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {type === 'sessions_countdown' ? (
                      <Timer className="h-3.5 w-3.5" />
                    ) : (
                      <CalendarDays className="h-3.5 w-3.5" />
                    )}
                    {type === 'sessions_countdown'
                      ? t('alertTypeSessionsCountdown')
                      : t('alertTypeDatetime')}
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
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

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (p: AlertPreset) => {
    setEditing(p)
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION, id))
    setDeleting(null)
    invalidate()
  }

  if (isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    )

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('presetsInfo')}</p>

      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1.5" />
          {t('addAlertPreset')}
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
                {p.schedule_type === 'sessions_countdown' ? (
                  <Timer className="h-4 w-4" />
                ) : (
                  <CalendarDays className="h-4 w-4" />
                )}
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
              <button
                onClick={() => openEdit(p)}
                className="p-1.5 rounded hover:bg-muted transition-colors"
              >
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
          <DialogHeader>
            <DialogTitle>{t('deletePreset')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {t('deletePresetConfirm', { name: presets.find((p) => p.id === deleting)?.name ?? '' })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
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
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
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
  open,
  onOpenChange,
  initial,
  existingIds,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
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
    const nextVal = form.levels.length > 0 ? Math.max(...form.levels.map((l) => l.value)) + 1 : 0
    setForm((f) => ({
      ...f,
      levels: [...f.levels, { value: nextVal, label: '', color: '#9CA3AF' }],
    }))
  }

  const updateLevel = (idx: number, patch: Partial<RankLevel>) => {
    setForm((f) => {
      const levels = f.levels.map((l, i) => (i === idx ? { ...l, ...patch } : l))
      return { ...f, levels }
    })
  }

  const removeLevel = (idx: number) => {
    setForm((f) => ({ ...f, levels: f.levels.filter((_, i) => i !== idx) }))
  }

  const applyPreset = (preset: (typeof RANK_PRESETS)[number]) => {
    setForm((f) => ({
      ...f,
      name: f.name || preset.name,
      id: f.id || (!idTouched ? generateId(preset.name) : f.id),
      levels: preset.levels.map((l) => ({ ...l })),
    }))
    setPresetOpen(false)
  }

  const canSave =
    form.name.trim().length > 0 &&
    form.id.length > 0 &&
    SLUG_REGEX_RANK.test(form.id) &&
    !idError &&
    form.levels.length > 0 &&
    form.levels.every((l) => l.label.trim().length > 0)

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
                {!idError && (
                  <p className="text-xs text-muted-foreground">{t('rankingSystemIdHelp')}</p>
                )}
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
                  <Plus className="h-3 w-3" />
                  {t('addLevel')}
                </button>
              </div>
              {form.levels.length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  {t('rankingNoSystems')}
                </p>
              )}
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {form.levels.map((level, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                      {level.value}
                    </span>
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
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canSave}
              onClick={() => {
                onSave(form)
                onOpenChange(false)
              }}
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preset picker */}
      <Dialog open={presetOpen} onOpenChange={setPresetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('rankingPresetsTitle')}</DialogTitle>
          </DialogHeader>
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
                    <span className="text-xs text-muted-foreground ml-0.5">
                      +{preset.levels.length - 5}
                    </span>
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

  const {
    rankingSystems: effectiveSystems,
    managedByOrg,
    orgId,
    loading: rankLoading,
  } = useRankingSystems()
  const systems: RankingSystem[] = managedByOrg ? effectiveSystems : (team.ranking_systems ?? [])

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
      ? systems.map((s) => (s.id === editing.id ? system : s))
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

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (s: RankingSystem) => {
    setEditing({
      id: s.id,
      name: s.name,
      levels: s.levels.map((l) => ({ ...l })),
      is_primary: s.is_primary ?? false,
    })
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      {managedByOrg && orgId && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border text-sm">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            Ranking systems are managed by your organization.{' '}
            <Link href={`/org/${orgId}/settings` as Route} className="text-primary hover:underline">
              Edit in organization settings
            </Link>
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('rankingSystems')}</p>
        {!managedByOrg && (
          <Button size="sm" onClick={openAdd} disabled={saving || rankLoading}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t('addRankingSystem')}
          </Button>
        )}
      </div>

      {rankLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : systems.length === 0 ? (
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
                      <Badge variant="default" className="text-xs">
                        {t('rankingSystemPrimary')}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">{s.id}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('rankingSystemLevels', { count: s.levels.length })}
                  </p>
                </div>
                {!managedByOrg &&
                  (s.is_primary ? (
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
                  ))}
                {!managedByOrg && (
                  <button
                    onClick={() => openEdit(s)}
                    className="p-1.5 rounded hover:bg-muted transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
                {!managedByOrg && (
                  <button
                    onClick={() => setDeleting(s.id)}
                    className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
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
            <p className="text-xs text-muted-foreground px-1">{t('primaryModeAuto')}</p>
          )}
        </div>
      )}

      <RankSystemDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v)
          if (!v) setEditing(null)
        }}
        initial={editing}
        existingIds={systems.filter((s) => !editing || s.id !== editing.id).map((s) => s.id)}
        onSave={handleSave}
      />

      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteRankingSystem')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {t('deleteRankingSystemConfirm', {
              name: systems.find((s) => s.id === deleting)?.name ?? '',
            })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => deleting && handleDelete(deleting)}
            >
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
  const { data: subscriptionTypes = [] } = useSubscriptionTypes(teamId)

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
      // Both Stripe (BYO) and Payrexx now carry a webhook signing secret + default.
      webhookSigningSecret: cfg.webhook_signing_secret ?? '',
      defaultSubscriptionTypeId: cfg.default_subscription_type_id ?? '',
    })
    setEditingId(item.id)
    setShowDialog(true)
  }

  async function onSubmit(values: GatewayFormData) {
    setSaving(true)
    try {
      const config =
        values.gatewayType === 'stripe'
          ? {
              type: 'stripe' as const,
              publishable_key: values.identifier,
              currency: values.currency,
              ...(values.webhookSigningSecret?.trim()
                ? { webhook_signing_secret: values.webhookSigningSecret.trim() }
                : {}),
              ...(values.defaultSubscriptionTypeId?.trim()
                ? { default_subscription_type_id: values.defaultSubscriptionTypeId.trim() }
                : {}),
            }
          : {
              type: 'payrexx' as const,
              instance_name: values.identifier,
              currency: values.currency,
              ...(values.webhookSigningSecret?.trim()
                ? { webhook_signing_secret: values.webhookSigningSecret.trim() }
                : {}),
              ...(values.defaultSubscriptionTypeId?.trim()
                ? { default_subscription_type_id: values.defaultSubscriptionTypeId.trim() }
                : {}),
            }

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

  if (isLoading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 rounded" />
      </div>
    )

  return (
    <div className="space-y-6">
      {/* Accept payments with Linyup (Stripe Connect) — own card; renders only when enabled. */}
      <ConnectPaymentsCard teamId={teamId} />

      <Card>
        <CardContent className="pt-6 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t('paymentsGateway')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('paymentsGatewayDescription')}</p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" />
          {t('paymentsAddGateway')}
        </Button>
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
                  <p className="text-xs text-muted-foreground truncate">
                    {identifier} · {cfg.currency}
                  </p>
                </div>
                <Badge variant={item.enabled ? 'default' : 'outline'} className="text-xs">
                  {item.enabled ? t('paymentsEnabled') : t('paymentsDisabled')}
                </Badge>
                <Switch checked={item.enabled} onCheckedChange={() => handleToggleEnabled(item)} />
                <button
                  onClick={() => openEdit(item)}
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setDeleteTarget(item.id)}
                  className="text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('paymentsSecretNote')}</p>
        </CardContent>
      </Card>

      {/* Add/edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('paymentsEditGateway') : t('paymentsAddGateway')}
            </DialogTitle>
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
                        {field.value === 'stripe' ? (
                          'Stripe'
                        ) : field.value === 'payrexx' ? (
                          'Payrexx'
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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
              <Label>
                {selectedType === 'stripe' ? t('paymentsPublishableKey') : 'Instance name'}
              </Label>
              <Input
                {...register('identifier')}
                placeholder={selectedType === 'stripe' ? 'pk_live_…' : 'my-instance'}
              />
              {errors.identifier && (
                <p className="text-xs text-destructive">{errors.identifier.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t('paymentsCurrency')}</Label>
              <Input
                {...register('currency')}
                placeholder="CHF"
                maxLength={3}
                className="uppercase w-24"
              />
            </div>

            {/* BYO record-only wiring (Stripe + Payrexx): verify the webhook
                signature + a default subscription type for unlabelled payments. */}
            <div className="space-y-1.5">
              <Label>Webhook signing secret</Label>
              <Input
                {...register('webhookSigningSecret')}
                type="password"
                placeholder={
                  selectedType === 'stripe' ? 'whsec_…' : 'Paste from Payrexx dashboard → Webhooks'
                }
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground">
                {selectedType === 'stripe' ? (
                  <>
                    Point a Stripe webhook at{' '}
                    <code className="bg-muted px-1 rounded">
                      /handleTeamStripeWebhook?teamId={teamId}
                    </code>{' '}
                    and paste its signing secret here to record payments against contacts.
                    Leave blank to disable (no payments recorded).
                  </>
                ) : (
                  <>
                    Used to verify{' '}
                    <code className="bg-muted px-1 rounded">X-Webhook-Signature</code> on incoming
                    payment webhooks. Leave blank to disable signature verification (not
                    recommended).
                  </>
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Default subscription type</Label>
              <Controller
                name="defaultSubscriptionTypeId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <span className="flex flex-1 text-left text-sm truncate">
                        {subscriptionTypes.find((s) => s.id === field.value)?.name ?? (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {subscriptionTypes.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-[11px] text-muted-foreground">
                {selectedType === 'stripe' ? (
                  <>
                    Applied when a payment carries no{' '}
                    <code className="bg-muted px-1 rounded">subscriptionTypeId</code> metadata.
                  </>
                ) : (
                  <>
                    Applied when the Payrexx payment link has no{' '}
                    <code className="bg-muted px-1 rounded">referenceId</code>. Set{' '}
                    <code className="bg-muted px-1 rounded">referenceId</code> to the subscription
                    type ID on each Payrexx link for per-plan control.
                  </>
                )}
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('paymentsDeleteGateway')}</AlertDialogTitle>
            <AlertDialogDescription>{t('paymentsDeleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {t('paymentsDeleteGateway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── affiliation types tab ────────────────────────────────────────────────────

function AffiliationTypesTab({ teamId, team }: { teamId: string; team: Team }) {
  const t = useTranslations('TeamAffiliationTypes')
  const tSettings = useTranslations('TeamSettings')
  const qc = useQueryClient()

  const { data: types = [], isLoading } = useQuery<AffiliationType[]>({
    queryKey: ['team-affiliation-types', teamId],
    queryFn: async () => {
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, AFFILIATION_TYPES_SUBCOLLECTION),
      )
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as AffiliationType))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    },
    staleTime: 5 * 60_000,
  })

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AffiliationType | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AffiliationType | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }
  function invalidate() { qc.invalidateQueries({ queryKey: ['team-affiliation-types', teamId] }) }

  function AffTypeDialog() {
    const [key, setKey] = useState(editing?.key ?? '')
    const [label, setLabel] = useState(editing?.label ?? '')
    const [defaultIssuer, setDefaultIssuer] = useState<AffiliationIssuer>(editing?.default_issuer ?? 'team')
    const [validityMonths, setValidityMonths] = useState(editing?.default_validity_months?.toString() ?? '')
    const [active, setActive] = useState(editing?.active ?? true)
    const [saving, setSaving] = useState(false)

    async function handleSave() {
      if (!key.trim() || !label.trim()) return
      setSaving(true)
      try {
        const id = editing?.id ?? `${key.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}_${Date.now()}`
        const payload: Omit<AffiliationType, 'id'> = {
          key: key.trim(),
          label: label.trim(),
          default_issuer: defaultIssuer,
          ...(validityMonths ? { default_validity_months: Number(validityMonths) } : {}),
          active,
          order: editing?.order ?? types.length,
        }
        const { setDoc: fsSetDoc } = await import('firebase/firestore')
        await fsSetDoc(
          doc(db, TEAMS_COLLECTION, teamId, AFFILIATION_TYPES_SUBCOLLECTION, id),
          payload,
          { merge: true },
        )
        invalidate()
        showToast(t('saved'))
        setFormOpen(false)
        setEditing(null)
      } finally {
        setSaving(false)
      }
    }

    return (
      <Dialog open={formOpen} onOpenChange={(v) => { if (!v) { setFormOpen(false); setEditing(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('addTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('keyLabel')}</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('keyPlaceholder')}
                disabled={!!editing}
              />
              <p className="text-xs text-muted-foreground">{t('keyHelp')}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelLabel')}</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelPlaceholder')} autoFocus={!editing} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('issuerLabel')}</Label>
              <Select value={defaultIssuer} onValueChange={(v) => setDefaultIssuer(v as AffiliationIssuer)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">{t('issuer_team')}</SelectItem>
                  <SelectItem value="org">{t('issuer_org')}</SelectItem>
                  <SelectItem value="external">{t('issuer_external')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('defaultValidityLabel')}</Label>
              <Input type="number" min={0} value={validityMonths} onChange={(e) => setValidityMonths(e.target.value)} placeholder={t('defaultValidityPlaceholder')} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-input accent-primary" />
              {t('activeLabel')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormOpen(false); setEditing(null) }} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !key.trim() || !label.trim()}>{saving ? '…' : t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Affiliations enabled toggle
  const affiliationsEnabled = team.affiliations_enabled ?? false
  const [enablingAff, setEnablingAff] = useState(false)

  async function toggleAffiliations(next: boolean) {
    setEnablingAff(true)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId), { affiliations_enabled: next })
      qc.invalidateQueries({ queryKey: ['team', teamId] })
    } finally {
      setEnablingAff(false)
    }
  }

  if (!planSupportsAffiliations(team.plan ?? null)) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm space-y-2">
        <p>{tSettings('affiliationsUpsell')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Enable toggle */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b">
        <div>
          <p className="text-sm font-medium">{tSettings('affiliationsEnabledLabel')}</p>
          <p className="text-xs text-muted-foreground">{tSettings('affiliationsEnabledHelp')}</p>
        </div>
        <Switch checked={affiliationsEnabled} onCheckedChange={toggleAffiliations} disabled={enablingAff} />
      </div>

      {affiliationsEnabled && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t('description')}</p>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
              <Plus className="h-4 w-4 mr-1.5" />
              {t('addButton')}
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : types.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">{t('noTypes')}</div>
          ) : (
            <div className="divide-y rounded-md border">
              {types.map((at) => (
                <div key={at.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{at.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">{at.key}</p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">{t(`issuer_${at.default_issuer}` as 'issuer_team')}</Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(at); setFormOpen(true) }}>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTarget(at)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {formOpen && <AffTypeDialog />}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmDeleteMessage')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return
                const { deleteDoc: fsDeleteDoc } = await import('firebase/firestore')
                await fsDeleteDoc(doc(db, TEAMS_COLLECTION, teamId, AFFILIATION_TYPES_SUBCOLLECTION, deleteTarget.id))
                invalidate()
                showToast(t('deleted'))
                setDeleteTarget(null)
              }}
            >
              {t('deleteButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white bg-green-600 z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── outreach tab ─────────────────────────────────────────────────────────────

const KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function EmailSenderForm({
  teamId,
  plan,
}: {
  teamId: string
  plan: string | undefined
}) {
  const t = useTranslations('EmailSettings')
  const { user } = useAuth()
  const { data: config, isLoading, registerDomain, checkDomain, revertToManaged, isRegistering, isChecking, isReverting, sendTest, isSendingTest } =
    useEmailSenderSettings('team', teamId)

  const [domain, setDomain] = useState('')
  const [fromLocalPart, setFromLocalPart] = useState('info')
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [testRecipient, setTestRecipient] = useState(user?.email ?? '')
  const [testResult, setTestResult] = useState<{ email: string; skipped: boolean; testMode: boolean } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Populate recipient with signed-in user's email once auth resolves
  useEffect(() => {
    if (user?.email && !testRecipient) setTestRecipient(user.email)
  }, [user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  const isPaidPlan = plan === 'coach' || plan === 'studio' || plan === 'organization'
  const isByo = config?.model === 'byo_domain'

  async function handleRegister() {
    setRegisterError(null)
    if (!domain.trim()) return
    try {
      await registerDomain(domain.trim(), fromLocalPart.trim() || 'info')
    } catch (err) {
      setRegisterError((err as Error).message ?? t('registerError'))
    }
  }

  async function handleCheck() {
    try {
      await checkDomain()
    } catch {
      // status stays as-is; user can retry
    }
  }

  async function handleRevert() {
    try {
      await revertToManaged()
    } catch {
      // silent — cached state will update on next load
    }
  }

  async function handleSendTest() {
    setTestResult(null)
    setTestError(null)
    try {
      const result = await sendTest(testRecipient.trim() || undefined)
      setTestResult({ email: result.sentTo, skipped: result.skipped, testMode: result.testMode })
    } catch (err) {
      setTestError((err as Error).message ?? t('sendTestError'))
    }
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    })
  }

  function VerificationBadge({ status }: { status: string | undefined }) {
    if (status === 'verified') {
      return (
        <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-600">
          <CheckCircle2 className="h-3 w-3" />
          {t('statusVerified')}
        </Badge>
      )
    }
    if (status === 'failed') {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          {t('statusFailed')}
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
        <Clock className="h-3 w-3" />
        {t('statusPending')}
      </Badge>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4" />
          {t('title')}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {/* Managed sender card — always shown */}
      <div className={`rounded-lg border p-4 space-y-1 ${!isByo ? 'border-primary/40 bg-primary/5' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('managedTitle')}</p>
          {!isByo && (
            <Badge variant="secondary" className="text-xs">{t('active')}</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('managedDescription')}</p>
      </div>

      {/* BYO domain section */}
      {!isByo && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('byoSectionTitle')}
          </p>

          {!isPaidPlan ? (
            <div className="rounded-lg border border-dashed px-4 py-4 flex items-start gap-3">
              <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">{t('byoUpsellTitle')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t('byoUpsellDescription')}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label htmlFor="byo-domain">{t('domainLabel')}</Label>
                  <Input
                    id="byo-domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="theirdojo.ch"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="byo-from-local">{t('fromLocalPartLabel')}</Label>
                  <Input
                    id="byo-from-local"
                    value={fromLocalPart}
                    onChange={(e) => setFromLocalPart(e.target.value)}
                    placeholder="info"
                  />
                </div>
              </div>
              {fromLocalPart && domain && (
                <p className="text-xs text-muted-foreground">
                  {t('fromAddressPreview', { address: `${fromLocalPart || 'info'}@${domain}` })}
                </p>
              )}
              {registerError && (
                <p className="text-xs text-destructive">{registerError}</p>
              )}
              <Button
                size="sm"
                onClick={handleRegister}
                disabled={isRegistering || !domain.trim()}
              >
                {isRegistering ? t('registering') : t('registerButton')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* BYO domain active state */}
      {isByo && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium">{t('byoActiveTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {t('byoActiveFrom', {
                  address: `${config.from_local_part ?? 'info'}@${config.domain}`,
                })}
              </p>
            </div>
            <VerificationBadge status={config.verification_status} />
          </div>

          {config.verification_status !== 'verified' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
              {t('pendingFallbackNote')}
            </div>
          )}

          {/* DNS records table */}
          {config.dns_records && config.dns_records.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium">{t('dnsRecordsTitle')}</p>
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">{t('dnsColType')}</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('dnsColHost')}</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('dnsColValue')}</th>
                      <th className="px-2 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {config.dns_records.map((record, idx) => (
                      <tr key={idx} className={record.verified ? 'bg-green-50/50' : ''}>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{record.type}</td>
                        <td className="px-3 py-2 font-mono break-all max-w-[160px]">{record.host}</td>
                        <td className="px-3 py-2 font-mono break-all max-w-[200px]">{record.value}</td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(record.value, `${idx}-value`)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title={t('copyValue')}
                          >
                            {copiedKey === `${idx}-value`
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                              : <Copy className="h-3.5 w-3.5" />
                            }
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{t('dmarcNote')}</p>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCheck}
              disabled={isChecking || isReverting}
            >
              {isChecking ? t('checking') : t('checkStatusButton')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRevert}
              disabled={isChecking || isReverting}
              className="text-muted-foreground hover:text-foreground"
            >
              {isReverting ? t('reverting') : t('revertToManagedButton')}
            </Button>
          </div>
        </div>
      )}

      {/* Send test email — always shown */}
      <div className="space-y-3 pt-2 border-t">
        <div>
          <p className="text-sm font-medium">{t('sendTestTitle')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('sendTestDescription')}</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="team-test-recipient">{t('recipientLabel')}</Label>
            <Input
              id="team-test-recipient"
              type="email"
              value={testRecipient}
              onChange={(e) => {
                setTestRecipient(e.target.value)
                setTestResult(null)
                setTestError(null)
              }}
              placeholder={user?.email ?? 'you@example.com'}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSendTest}
            disabled={isSendingTest}
            className="shrink-0"
          >
            {isSendingTest ? t('sendingTest') : t('sendTestButton')}
          </Button>
        </div>
        {testResult && !testResult.skipped && !testResult.testMode && (
          <p className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('sendTestSuccess', { email: testResult.email })}
          </p>
        )}
        {testResult?.skipped && (
          <p className="text-xs text-amber-600">{t('sendTestSkipped')}</p>
        )}
        {testResult?.testMode && !testResult.skipped && (
          <p className="text-xs text-muted-foreground">{t('sendTestTestMode')}</p>
        )}
        {testError && (
          <p className="text-xs text-destructive">{testError}</p>
        )}
      </div>
    </div>
  )
}

function OutreachTab({ teamId, team }: { teamId: string; team: Team }) {
  const qc = useQueryClient()

  type VarRow = { key: string; value: string }
  const [vars, setVars] = useState<VarRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (team?.outreach_placeholders) {
      setVars(
        Object.entries(team.outreach_placeholders).map(([key, value]) => ({
          key,
          value: value as string,
        }))
      )
    }
  }, [team?.outreach_placeholders])

  const addRow = () => setVars((prev) => [...prev, { key: '', value: '' }])

  const removeRow = (idx: number) => setVars((prev) => prev.filter((_, i) => i !== idx))

  const updateRow = (idx: number, field: 'key' | 'value', val: string) =>
    setVars((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: val } : row)))

  const onSave = async () => {
    setSaveError('')
    const invalid = vars.filter((v) => v.key && !KEY_REGEX.test(v.key))
    if (invalid.length > 0) {
      setSaveError(
        `Invalid key names: ${invalid.map((v) => v.key).join(', ')}. Use letters, numbers and underscores only.`
      )
      return
    }
    const payload = Object.fromEntries(
      vars.filter((v) => v.key.trim()).map((v) => [v.key.trim(), v.value])
    )
    setSaving(true)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId), { outreach_placeholders: payload })
      await qc.invalidateQueries({ queryKey: ['team', teamId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <EmailSenderForm teamId={teamId} plan={team.plan} />

      <Card>
        <CardContent className="pt-6 space-y-5">
        <div>
          <h3 className="font-semibold text-sm">Custom variables</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Define key→value pairs you can use in email templates as{' '}
            <code className="font-mono text-xs bg-muted px-1 rounded">{'{{key}}'}</code>. For
            example, <code className="font-mono text-xs bg-muted px-1 rounded">discountCode</code> →{' '}
            <code className="font-mono text-xs bg-muted px-1 rounded">WELCOME20</code>.
          </p>
        </div>

        <div className="space-y-2">
          {vars.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="flex items-center border rounded-md overflow-hidden flex-1">
                <span className="px-2 py-2 text-xs text-muted-foreground bg-muted border-r select-none font-mono">
                  {'{{'}
                </span>
                <input
                  value={row.key}
                  onChange={(e) => updateRow(idx, 'key', e.target.value)}
                  placeholder="variableName"
                  className="flex-1 px-2 py-2 text-sm font-mono outline-none bg-background"
                />
                <span className="px-2 py-2 text-xs text-muted-foreground bg-muted border-l select-none font-mono">
                  {'}}'}
                </span>
              </div>
              <input
                value={row.value}
                onChange={(e) => updateRow(idx, 'value', e.target.value)}
                placeholder="Substitution value"
                className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => removeRow(idx)}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add variable
        </Button>

        {saveError && <p className="text-xs text-destructive">{saveError}</p>}

        <div className="flex justify-end">
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </Button>
        </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'alerts' | 'ranking' | 'payments' | 'outreach' | 'custom-fields' | 'affiliations'

export default function TeamSettingsPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
  const { isInstalled } = useInstalledPlugins()
  const t = useTranslations('TeamSettings')
  const [tab, setTab] = useState<SettingsTab>('general')

  // Deep-link support: open the tab named in ?tab= (e.g. the contact card's
  // "set up custom fields" link → ?tab=custom-fields).
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested) setTab(requested as SettingsTab)
  }, [])

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
    { id: 'alerts', label: t('tabAlerts') },
    { id: 'ranking', label: t('tabRanking') },
    { id: 'payments', label: t('tabPayments') },
    { id: 'outreach', label: 'Outreach' },
    // Affiliations tab — visible when plan supports it
    ...(planSupportsAffiliations(team.plan ?? null)
      ? [{ id: 'affiliations' as SettingsTab, label: t('tabAffiliations') }]
      : []),
    // Custom Fields plugin — tab appears only when the plugin is installed
    ...(isInstalled('custom-fields')
      ? [{ id: 'custom-fields' as SettingsTab, label: t('tabCustomFields') }]
      : []),
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{team.name}</p>
      </div>

      {/* Tab bar — scrolls horizontally on narrow screens instead of overflowing the page */}
      <div className="flex gap-0.5 border-b overflow-x-auto">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Payments + Outreach manage their own stacked cards; the rest share one wrapper. */}
      {tab === 'payments' ? (
        <PaymentsTab teamId={currentTeamId} />
      ) : tab === 'outreach' ? (
        <OutreachTab teamId={currentTeamId} team={team} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            {tab === 'general' && (
              <>
                <GeneralForm team={team} teamId={currentTeamId} />
                <ContactRoleLabelForm team={team} teamId={currentTeamId} />
              </>
            )}
            {tab === 'alerts' && <AlertPresetsTab teamId={currentTeamId} />}
            {tab === 'ranking' && <RankingTab teamId={currentTeamId} team={team} />}
            {tab === 'affiliations' && <AffiliationTypesTab teamId={currentTeamId} team={team} />}
            {tab === 'custom-fields' && isInstalled('custom-fields') && (
              <CustomFieldsTab teamId={currentTeamId} team={team} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
