'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, where, orderBy, getDocs,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm } from 'react-hook-form'
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
import { ACTIVITIES_COLLECTION } from '@lineup/shared'
import type { Activity, ActivityLevel } from '@lineup/shared'
import { Plus, Pencil, Archive } from 'lucide-react'

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

// ─── schema ───────────────────────────────────────────────────────────────────

const activitySchema = z.object({
  name: z.string().min(1, 'Required').max(80),
  description: z.string().max(500).optional(),
  level: z.enum(LEVELS),
  color: z.string().optional(),
  isFreeTrial: z.boolean(),
})

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
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Activity)
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
}: {
  open: boolean
  onClose: () => void
  teamId: string
  userId: string
  editing: Activity | null
}) {
  const t = useTranslations('Activities')
  const qc = useQueryClient()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ActivityFormData>({
    resolver: zodResolver(activitySchema),
    defaultValues: editing
      ? {
          name: editing.name,
          description: editing.description ?? '',
          level: editing.level ?? 'all',
          color: editing.color ?? '',
          isFreeTrial: editing.isFreeTrial ?? true,
        }
      : { name: '', description: '', level: 'all', color: '#6366f1', isFreeTrial: true },
  })

  async function onSubmit(data: ActivityFormData) {
    if (editing) {
      await updateDoc(doc(db, ACTIVITIES_COLLECTION, editing.id), {
        name: data.name,
        description: data.description ?? '',
        level: data.level,
        color: data.color ?? '',
        isFreeTrial: data.isFreeTrial,
      })
    } else {
      await addDoc(collection(db, ACTIVITIES_COLLECTION), {
        name: data.name,
        description: data.description ?? '',
        level: data.level,
        color: data.color ?? '',
        isFreeTrial: data.isFreeTrial,
        slug: slugify(data.name),
        teamId,
        createdBy: userId,
        isActive: true,
        created_at: serverTimestamp(),
      })
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="act-level">{t('fieldLevel')}</Label>
              <select
                id="act-level"
                {...register('level')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{t(`level_${l}` as const)}</option>
                ))}
              </select>
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

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" {...register('isFreeTrial')} className="accent-primary" />
            <span className="text-sm">{t('fieldFreeTrial')}</span>
          </label>

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
}: {
  activity: Activity
  onEdit: () => void
  onArchive: () => void
}) {
  const t = useTranslations('Activities')

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow">
      <div
        className="mt-0.5 h-4 w-4 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10"
        style={{ backgroundColor: activity.color ?? '#e5e7eb' }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{activity.name}</p>
          {activity.level && activity.level !== 'all' && (
            <Badge variant="secondary" className="text-xs">
              {t(`level_${activity.level}` as const)}
            </Badge>
          )}
          {activity.isFreeTrial && (
            <Badge variant="outline" className="text-xs">{t('freeTrialBadge')}</Badge>
          )}
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

  function openNew() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(a: Activity) {
    setEditing(a)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
  }

  async function handleArchive(a: Activity) {
    if (!window.confirm(t('archiveConfirm', { name: a.name }))) return
    await updateDoc(doc(db, ACTIVITIES_COLLECTION, a.id), { isActive: false })
    await qc.invalidateQueries({ queryKey: ['activities', currentTeamId] })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { count: activities.length })}
            </p>
          )}
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1.5" />
          {t('newActivity')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border rounded-lg border-dashed gap-2">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
          <button onClick={openNew} className="text-sm text-primary hover:underline">
            {t('emptyAction')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map((a) => (
            <ActivityCard
              key={a.id}
              activity={a}
              onEdit={() => openEdit(a)}
              onArchive={() => handleArchive(a)}
            />
          ))}
        </div>
      )}

      {currentTeamId && user && (
        <ActivityDialog
          key={editing?.id ?? 'new'}
          open={dialogOpen}
          onClose={closeDialog}
          teamId={currentTeamId}
          userId={user.uid}
          editing={editing}
        />
      )}
    </div>
  )
}
