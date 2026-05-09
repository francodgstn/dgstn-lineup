'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TEAMS_COLLECTION } from '@lineup/shared'
import type { Team, TeamLink } from '@lineup/shared'
import { Plus, Trash2, Globe } from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const SPORT_TYPES = [
  'Martial arts', 'Football / Soccer', 'Basketball', 'Volleyball', 'Tennis',
  'Swimming', 'Gymnastics', 'CrossFit / Fitness', 'Yoga / Pilates', 'Dance',
  'Rugby', 'Cycling', 'Athletics', 'Other',
]

const SLUG_REGEX = /^[a-z0-9-]+$/

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

const linkItemSchema = z.object({
  label: z.string().min(1, 'Required'),
  description: z.string().optional(),
  url: z.string().optional(),
  showInPortal: z.boolean(),
  isBookingLink: z.boolean().optional(),
  isMembershipLink: z.boolean().optional(),
})

const portalLinksSchema = z.object({
  links: z.array(linkItemSchema),
})

type GeneralData = z.infer<typeof generalSchema>
type PortalLinksData = z.infer<typeof portalLinksSchema>

// ─── data hooks ───────────────────────────────────────────────────────────────

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

async function isSlugAvailable(slug: string, teamId: string): Promise<boolean> {
  const snap = await getDocs(query(collection(db, TEAMS_COLLECTION), where('slug', '==', slug)))
  return snap.docs.every((d) => d.id === teamId)
}

// ─── general tab ─────────────────────────────────────────────────────────────

function GeneralForm({ team, teamId }: { team: Team; teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const [slugError, setSlugError] = useState<string | null>(null)
  const [slugChecking, setSlugChecking] = useState(false)
  const [saved, setSaved] = useState(false)

  const {
    register,
    handleSubmit,
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
        <select
          id="sport_type"
          {...register('sport_type')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">{t('sportTypeNone')}</option>
          {SPORT_TYPES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
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

// ─── portal links tab ─────────────────────────────────────────────────────────

function ShowInPortalCheckbox({
  control,
  index,
}: {
  control: ReturnType<typeof useForm<PortalLinksData>>['control']
  index: number
}) {
  const t = useTranslations('TeamSettings')
  return (
    <Controller
      control={control}
      name={`links.${index}.showInPortal`}
      render={({ field }) => (
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={field.value}
            onChange={(e) => field.onChange(e.target.checked)}
            className="accent-primary"
          />
          {t('showInPortal')}
        </label>
      )}
    />
  )
}

function PortalLinksForm({ team, teamId }: { team: Team; teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const [saved, setSaved] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    formState: { isSubmitting, isDirty },
  } = useForm<PortalLinksData>({
    resolver: zodResolver(portalLinksSchema),
    defaultValues: { links: (team.links ?? []) as PortalLinksData['links'] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'links' })

  // Identify special-link indices from the original team data (order is preserved by useFieldArray)
  const bookingIdx = (team.links ?? []).findIndex((l) => l.isBookingLink)
  const membershipIdx = (team.links ?? []).findIndex((l) => l.isMembershipLink)

  async function onSubmit(data: PortalLinksData) {
    await updateDoc(doc(db, TEAMS_COLLECTION, teamId), { links: data.links })
    await qc.invalidateQueries({ queryKey: ['team', teamId] })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Booking & membership links */}
      {[
        { idx: bookingIdx, labelKey: 'bookingLink' as const },
        { idx: membershipIdx, labelKey: 'membershipLink' as const },
      ]
        .filter(({ idx }) => idx >= 0)
        .map(({ idx, labelKey }) => (
          <div key={fields[idx]?.id ?? idx} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">{t(labelKey)}</Badge>
              <ShowInPortalCheckbox control={control} index={idx} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('linkLabel')}</Label>
                <Input {...register(`links.${idx}.label`)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('linkDescription')}</Label>
                <Input {...register(`links.${idx}.description`)} />
              </div>
            </div>
          </div>
        ))}

      {/* Custom links */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t('customLinks')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({ label: '', description: '', url: '', showInPortal: true })
            }
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('addLink')}
          </Button>
        </div>

        {fields.every((_, i) => i === bookingIdx || i === membershipIdx) && (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
            {t('noCustomLinks')}
          </p>
        )}

        {fields.map((field, i) => {
          if (i === bookingIdx || i === membershipIdx) return null
          return (
            <div key={field.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-3">
                  <ShowInPortalCheckbox control={control} index={i} />
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    aria-label={t('removeLink')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('linkLabel')}</Label>
                  <Input {...register(`links.${i}.label`)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('linkDescription')}</Label>
                  <Input {...register(`links.${i}.description`)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('linkUrl')}</Label>
                <Input
                  {...register(`links.${i}.url`)}
                  type="url"
                  placeholder="https://"
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? t('saving') : t('save')}
        </Button>
        {saved && <span className="text-sm text-green-600">{t('saved')}</span>}
      </div>
    </form>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type Tab = 'general' | 'portal'

export default function TeamSettingsPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
  const [tab, setTab] = useState<Tab>('general')
  const t = useTranslations('TeamSettings')

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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: t('tabGeneral') },
    { key: 'portal', label: t('tabPortal') },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{team.name}</p>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {tab === 'general' && (
            <GeneralForm team={team} teamId={currentTeamId} />
          )}
          {tab === 'portal' && (
            <PortalLinksForm team={team} teamId={currentTeamId} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
