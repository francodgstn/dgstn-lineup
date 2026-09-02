'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useInvalidateSetupChecklist } from '@/hooks/useSetupChecklist'
import { useTranslations } from 'next-intl'
import { doc, deleteDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  TEAMS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  resolveIntroOffer
} from '@linyup/shared'
import type { SubscriptionType } from '@linyup/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { reorderWithinSection } from '@/lib/reorder'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Pencil, Copy, Trash2, Globe, GripVertical } from 'lucide-react'
import { SortableList, SortableItem } from '@/components/ui/sortable'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { formatCurrency } from '@/lib/format'
import { SubTypeDialog } from './SubscriptionTypeDialog'
import { Tip } from '@/components/ui/tip'

export interface SubscriptionTypesManagerHandle {
  openAdd: () => void
}

export const SubscriptionTypesManager = forwardRef<
  SubscriptionTypesManagerHandle,
  { teamId: string; currency?: string }
>(function SubscriptionTypesManager({ teamId, currency = 'CHF' }, ref) {
  const t = useTranslations('TeamSettings')
  const tc = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { data: types = [], isLoading } = useSubscriptionTypes(teamId)
  const editParam = useSearchParams().get('edit')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SubscriptionType | null>(null)
  const [duplicating, setDuplicating] = useState<SubscriptionType | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // The setup checklist's "set a price" step counts subscription types, so both
  // queries have to look again — the list's own, and the checklist's.
  const invalidateSetupChecklist = useInvalidateSetupChecklist()
  const invalidate = () => {
    void invalidateSetupChecklist()
    return qc.invalidateQueries({ queryKey: ['subscription-types', teamId] })
  }

  const openAdd = () => {
    setEditing(null)
    setDuplicating(null)
    setDialogOpen(true)
  }

  // Let the page header own the primary "New type" action.
  useImperativeHandle(ref, () => ({ openAdd }))

  // ── arriving from the catalogue's Edit button (?edit=<id>) ──
  // The types load async, so this cannot be a lazy initializer the way the
  // "new" param is: there is nothing to find on first render. It runs when the
  // data arrives, and the ref makes it run ONCE — without that, closing the
  // dialog while the param is still in the URL would immediately reopen it.
  const consumedEditParam = useRef(false)
  useEffect(() => {
    if (consumedEditParam.current || !editParam || types.length === 0) return
    const target = types.find((st) => st.id === editParam)
    consumedEditParam.current = true
    if (target) openEdit(target)
  }, [editParam, types])

  const openEdit = (st: SubscriptionType) => {
    setDuplicating(null)
    setEditing(st)
    setDialogOpen(true)
  }

  const openDuplicate = (st: SubscriptionType) => {
    setEditing(null)
    setDuplicating(st)
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, id))
    setDeleting(null)
    invalidate()
  }

  // Drag-and-drop reorder. Persists `order = position` for the whole list in one
  // batch (normalizes any docs that never had an explicit order). The list is
  // already sorted by `compareSubscriptionTypes` via the hook.
  //
  // The permutation is `reorderWithinSection` (lib/reorder.ts) with no section —
  // shared with the activities list and the catalogue's rail, which reorder the
  // same collections from other screens.
  const reorder = async (from: number, to: number) => {
    if (from === to) return
    const next = reorderWithinSection(types, types, from, to)
    const batch = writeBatch(db)
    next.forEach((st, i) => {
      if (st.order !== i) {
        batch.update(doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, st.id), {
          order: i,
        })
      }
    })
    await batch.commit()
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
        <SortableList ids={types.map((st) => st.id)} onReorder={reorder}>
          <div className="space-y-2">
            {types.map((st) => (
              <SortableItem key={st.id} id={st.id}>
                {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                  <div
                    ref={setNodeRef}
                    style={style}
                    className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
                      isDragging ? 'shadow-lg' : ''
                    }`}
                  >
                    <button
                      type="button"
                      {...attributes}
                      {...listeners}
                      className="p-1 -ml-1 rounded text-muted-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing touch-none"
                      aria-label={t('subTypeReorder')}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{st.name}</p>
                        {/* A CHIP MARKS THE EXCEPTION, NOT THE RULE. Almost every plan is the
                studio's own, so "Internal" was a label on nearly every row —
                carrying no information while costing a scan. Only a plan that
                comes from somewhere else (a partner fitness app) is worth
                naming (Franco, 2026-09-01). */}
                        {st.source === 'aggregator' && (
                          <Badge variant="secondary" className="text-xs">
                            {t('subTypeSourceAggregator')}
                          </Badge>
                        )}
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
                        {/* Only when the offer actually RESOLVES — the same
                            question the public card asks. A badge on an offer
                            the checkout would ignore is the exact false
                            reassurance this feature must not give. */}
                        {(st.prices ?? []).some((p) => resolveIntroOffer(st, p.id)) && (
                          <Badge variant="outline" className="text-xs">
                            {t('subTypeIntroBadge')}
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
                              {!!p.credits && (
                                <>
                                  {' '}
                                  ·{' '}
                                  <span className="text-primary">
                                    {t('subTypeCreditsBadge', { count: p.credits })}
                                  </span>
                                </>
                              )}
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
                    <Tip label={tCommon('duplicate')}>
                      <button
                        onClick={() => openDuplicate(st)}
                        aria-label={tCommon('duplicate')}
                        className="p-1.5 rounded hover:bg-muted transition-colors"
                      >
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </Tip>
                    <button
                      onClick={() => setDeleting(st.id)}
                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableList>
      )}

      <SubTypeDialog
        key={editing?.id ?? (duplicating ? `copy-${duplicating.id}` : 'new')}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        teamId={teamId}
        editing={editing}
        duplicating={duplicating}
        currency={currency}
        nextOrder={types.length}
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
