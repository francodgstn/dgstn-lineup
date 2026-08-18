'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Building2, LayoutTemplate, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ProgramTemplate } from '@linyup/shared'
import {
  useDeleteProgramTemplate,
  useProgramTemplates,
  useRenameProgramTemplate,
} from './useProgramTemplates'

// Templates are AUTHORED on an event (build → "Save as template") and only
// listed / renamed / deleted here. Deliberately no content editor: the event
// page already is one, and duplicating it would double the surface for nothing.

export interface ProgramTemplatesManagerProps {
  /** Which collection this page manages. */
  scope: 'team' | 'org'
  ownerId: string | null
  /** For the team page: also list inherited org templates, read-only. */
  inheritedOrgId?: string | null
  canEdit?: boolean
}

export function ProgramTemplatesManager({
  scope, ownerId, inheritedOrgId, canEdit = true,
}: ProgramTemplatesManagerProps) {
  const t = useTranslations('EventProgram')

  const listQ = useProgramTemplates(
    scope === 'team' ? ownerId : null,
    scope === 'org' ? ownerId : (inheritedOrgId ?? null),
  )
  const rename = useRenameProgramTemplate(scope, ownerId)
  const remove = useDeleteProgramTemplate(scope, ownerId)

  const [editing, setEditing] = useState<ProgramTemplate | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<ProgramTemplate | null>(null)

  const templates = listQ.data ?? []
  /** Inherited org templates are read-only on the team page. */
  const isOwned = (tpl: ProgramTemplate) => tpl.scope === scope

  function openRename(tpl: ProgramTemplate) {
    setEditing(tpl)
    setName(tpl.name)
    setDescription(tpl.description ?? '')
  }

  if (listQ.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-6 py-14 text-center">
        <LayoutTemplate className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">{t('templatesEmpty')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('templatesEmptyHint')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2">
        {templates.map((tpl) => (
          <div key={tpl.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{tpl.name}</span>
                {!isOwned(tpl) && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Building2 className="h-3 w-3" />
                    {t('templateFromOrg')}
                  </Badge>
                )}
              </div>
              {tpl.description && (
                <p className="text-xs text-muted-foreground">{tpl.description}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('templateSummary', {
                  days: tpl.days?.length ?? 0,
                  items: tpl.itemCount ?? tpl.items?.length ?? 0,
                })}
                {!isOwned(tpl) && ` · ${t('templateInherited')}`}
              </p>
            </div>

            {canEdit && isOwned(tpl) && (
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon" variant="ghost"
                  aria-label={t('templateRename')}
                  onClick={() => openRename(tpl)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  aria-label={t('templateDelete')}
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(tpl)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('templateRename')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-rename">{t('templateName')}</Label>
              <Input id="tpl-rename" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-redesc">{t('templateDescription')}</Label>
              <Input id="tpl-redesc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t('cancel')}</Button>
            <Button
              disabled={!name.trim() || rename.isPending}
              onClick={async () => {
                if (!editing) return
                await rename.mutateAsync({
                  templateId: editing.id,
                  name: name.trim(),
                  description: description.trim(),
                })
                setEditing(null)
              }}
            >
              {rename.isPending ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templateDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('templateDeleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return
                await remove.mutateAsync(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >
              {t('templateDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
