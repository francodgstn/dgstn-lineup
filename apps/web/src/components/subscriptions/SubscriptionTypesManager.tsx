'use client'

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION } from '@linyup/shared'
import type { SubscriptionType, SubscriptionPrice } from '@linyup/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Globe } from 'lucide-react'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { formatCurrency } from '@/lib/format'

const RECURRENCES = ['per_class', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual'] as const

const priceSchema = z.object({
  id: z.string(),
  amount: z.coerce.number().positive(),
  recurrence: z.enum(RECURRENCES),
  label: z.string().max(40).optional(),
  active: z.boolean().optional(),
})

const subTypeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  source: z.enum(['internal', 'aggregator']).default('internal'),
  active: z.boolean().optional(),
  public: z.boolean().optional(),
  prices: z.array(priceSchema).optional(),
})
type SubTypeData = z.infer<typeof subTypeSchema>

function emptyDefaults(editing: SubscriptionType | null): SubTypeData {
  return {
    name: editing?.name ?? '',
    description: editing?.description ?? '',
    source: editing?.source ?? 'internal',
    active: editing?.active ?? true,
    public: editing?.public ?? false,
    prices: (editing?.prices ?? []).map((p) => ({
      id: p.id,
      amount: p.amount,
      recurrence: p.recurrence,
      label: p.label ?? '',
      active: p.active ?? true,
    })),
  }
}

function SubTypeDialog({
  open,
  onOpenChange,
  teamId,
  editing,
  currency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  editing: SubscriptionType | null
  currency: string
  onSaved: () => void
}) {
  const t = useTranslations('TeamSettings')
  const tc = useTranslations('Contacts')

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { isSubmitting },
  } = useForm<SubTypeData>({
    resolver: zodResolver(subTypeSchema),
    defaultValues: emptyDefaults(editing),
  })

  const { fields, append, remove, move } = useFieldArray({ control, name: 'prices' })

  useEffect(() => {
    if (open) reset(emptyDefaults(editing))
  }, [open, editing, reset])

  const source = watch('source')
  const active = watch('active') ?? true
  const isPublic = watch('public') ?? false

  async function onSubmit(data: SubTypeData) {
    const prices = (data.prices ?? []).map((p) => {
      const entry: SubscriptionPrice = {
        id: p.id,
        amount: p.amount,
        recurrence: p.recurrence,
        active: p.active ?? true,
      }
      if (p.label?.trim()) entry.label = p.label.trim()
      return entry
    })
    const payload = {
      name: data.name,
      description: data.description || null,
      source: data.source,
      active: data.active ?? true,
      public: data.public ?? false,
      prices,
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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('editSubscriptionType') : t('addSubscriptionType')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
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

          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {t('subTypePublic')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('subTypePublicDesc')}</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={(v) => setValue('public', v)} />
          </div>

          {/* Pricing (optional) — kept secondary so the simple flow stays one-field */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('subTypePricing')}</Label>
                <p className="text-xs text-muted-foreground">{t('subTypePricingDesc')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    id: crypto.randomUUID(),
                    amount: 0,
                    recurrence: 'monthly',
                    label: '',
                    active: true,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('subTypeAddPrice')}
              </Button>
            </div>

            {fields.length > 0 && (
              <div className="space-y-2 pt-1">
                {fields.map((field, i) => (
                  <div key={field.id} className="rounded-md border bg-card p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...register(`prices.${i}.amount`)}
                          className="pr-12"
                          placeholder="0.00"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                          {currency}
                        </span>
                      </div>
                      <Select
                        value={watch(`prices.${i}.recurrence`)}
                        onValueChange={(v) =>
                          setValue(
                            `prices.${i}.recurrence`,
                            v as (typeof RECURRENCES)[number]
                          )
                        }
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {tc(`recurrence_${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        {...register(`prices.${i}.label`)}
                        placeholder={t('subTypePriceLabelPlaceholder')}
                        className="flex-1 h-8 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => move(i, i - 1)}
                        disabled={i === 0}
                        className="p-1 rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                        aria-label={t('subTypePriceMoveUp')}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, i + 1)}
                        disabled={i === fields.length - 1}
                        className="p-1 rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                        aria-label={t('subTypePriceMoveDown')}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <Switch
                        checked={watch(`prices.${i}.active`) ?? true}
                        onCheckedChange={(v) => setValue(`prices.${i}.active`, v)}
                      />
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                        aria-label={t('subTypePriceRemove')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

export interface SubscriptionTypesManagerHandle {
  openAdd: () => void
}

export const SubscriptionTypesManager = forwardRef<
  SubscriptionTypesManagerHandle,
  { teamId: string; currency?: string }
>(function SubscriptionTypesManager({ teamId, currency = 'CHF' }, ref) {
  const t = useTranslations('TeamSettings')
  const tc = useTranslations('Contacts')
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

  // Let the page header own the primary "New type" action.
  useImperativeHandle(ref, () => ({ openAdd }))
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
                  {st.public && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Globe className="h-3 w-3" />
                      {t('subTypePublicBadge')}
                    </Badge>
                  )}
                </div>
                {st.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {st.description}
                  </p>
                )}
                {(st.prices?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {st.prices!.filter((p) => p.active !== false).map((p) => (
                      <span
                        key={p.id}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium"
                      >
                        {formatCurrency(p.amount, currency)} · {tc(`recurrence_${p.recurrence}`)}
                      </span>
                    ))}
                  </div>
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
        currency={currency}
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
})
