'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TEAMS_COLLECTION } from '@lineup/shared'
import type { Team } from '@lineup/shared'

// ─── constants ────────────────────────────────────────────────────────────────

const SPORT_TYPES = [
  'Martial arts', 'Football / Soccer', 'Basketball', 'Volleyball', 'Tennis',
  'Swimming', 'Gymnastics', 'CrossFit / Fitness', 'Yoga / Pilates', 'Dance',
  'Rugby', 'Cycling', 'Athletics', 'Other',
]

const SLUG_REGEX = /^[a-z0-9-]+$/

// ─── schema ───────────────────────────────────────────────────────────────────

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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TeamSettingsPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{team.name}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <GeneralForm team={team} teamId={currentTeamId} />
        </CardContent>
      </Card>
    </div>
  )
}
