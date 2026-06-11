'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION } from '@linyup/shared'
import type { SubscriptionType } from '@linyup/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'

const subTypeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  source: z.enum(['internal', 'aggregator']).default('internal'),
  active: z.boolean().optional(),
})
type SubTypeData = z.infer<typeof subTypeSchema>

function SubTypeDialog({
  open,
  onOpenChange,
  teamId,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  editing: SubscriptionType | null
  onSaved: () => void
}) {
  const t = useTranslations('TeamSettings')

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { isSubmitting },
  } = useForm<SubTypeData>({
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
      await updateDoc(
        doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, editing.id),
        payload
      )
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
          <DialogTitle>
            {editing ? t('editSubscriptionType') : t('addSubscriptionType')}
          </DialogTitle>
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
                  <p className="font-medium">
                    {t(val === 'internal' ? 'subTypeSourceInternal' : 'subTypeSourceAggregator')}
                  </p>
                  <p className="text-xs font-normal mt-0.5 text-muted-foreground">
                    {val === 'internal'
                      ? t('subTypeSourceInternalDesc')
                      : t('subTypeSourceAggregatorDesc')}
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
            <Switch checked={active} onCheckedChange={(v) => setValue('active', v)} />
          </div>
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

export function SubscriptionTypesManager({ teamId }: { teamId: string }) {
  const t = useTranslations('TeamSettings')
  const qc = useQueryClient()
  const { data: types = [], isLoading } = useSubscriptionTypes(teamId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SubscriptionType | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['subscription-types', teamId] })

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (st: SubscriptionType) => {
    setEditing(st)
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, id))
    setDeleting(null)
    invalidate()
  }

  if (isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1.5" />
          {t('addSubscriptionType')}
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
                  <Badge
                    variant={st.source === 'aggregator' ? 'secondary' : 'outline'}
                    className="text-xs"
                  >
                    {t(
                      st.source === 'aggregator'
                        ? 'subTypeSourceAggregator'
                        : 'subTypeSourceInternal'
                    )}
                  </Badge>
                  {st.active === false && (
                    <Badge variant="outline" className="text-xs">
                      {t('subTypeInactive')}
                    </Badge>
                  )}
                </div>
                {st.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {st.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => openEdit(st)}
                className="p-1.5 rounded hover:bg-muted transition-colors"
              >
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
          <DialogHeader>
            <DialogTitle>{t('deleteSubType')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {t('deleteSubTypeConfirm', { name: types.find((s) => s.id === deleting)?.name ?? '' })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleting && handleDelete(deleting)}>
              {t('deleteSubType')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
