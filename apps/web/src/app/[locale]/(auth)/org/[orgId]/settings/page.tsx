'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import {
  doc, updateDoc, getDocs, collection, setDoc, deleteDoc,
  serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useOrg } from '@/contexts/OrgContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Settings, IdCard, Pencil, Trash2, Plus, ChevronUp, ChevronDown, RotateCcw, Languages, Lock } from 'lucide-react'
import { deleteField } from 'firebase/firestore'
import {
  ORGANIZATIONS_COLLECTION, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION,
  DEFAULT_ORG_MEMBERSHIP_STATUSES,
} from '@lineup/shared'
import type { OrgMembershipStatusDef, MembershipStatusColor, Organization } from '@lineup/shared'

// ─── colour config ────────────────────────────────────────────────────────────

const COLORS: { id: MembershipStatusColor; bg: string; label: string }[] = [
  { id: 'gray',   bg: 'bg-gray-400',   label: 'Gray' },
  { id: 'yellow', bg: 'bg-yellow-400', label: 'Yellow' },
  { id: 'blue',   bg: 'bg-blue-500',   label: 'Blue' },
  { id: 'purple', bg: 'bg-purple-500', label: 'Purple' },
  { id: 'green',  bg: 'bg-green-500',  label: 'Green' },
  { id: 'red',    bg: 'bg-red-500',    label: 'Red' },
  { id: 'orange', bg: 'bg-orange-400', label: 'Orange' },
]

const COLOR_DOT: Record<string, string> = {
  gray:   'bg-gray-400',
  yellow: 'bg-yellow-400',
  blue:   'bg-blue-500',
  purple: 'bg-purple-500',
  green:  'bg-green-500',
  red:    'bg-red-500',
  orange: 'bg-orange-400',
}

// ─── hook: auto-init defaults on first load ───────────────────────────────────

function useStatusDefs(orgId: string) {
  return useQuery<OrgMembershipStatusDef[]>({
    queryKey: ['org-membership-statuses', orgId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const snap = await getDocs(
        collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION),
      )
      if (snap.empty) {
        // Auto-initialize with defaults on first visit to this settings page
        const batch = writeBatch(db)
        DEFAULT_ORG_MEMBERSHIP_STATUSES.forEach((s) => {
          batch.set(
            doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION, s.id),
            { ...s, updated_at: serverTimestamp() },
          )
        })
        await batch.commit()
        return DEFAULT_ORG_MEMBERSHIP_STATUSES
      }
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as OrgMembershipStatusDef))
        .sort((a, b) => a.order - b.order)
    },
  })
}

// ─── status form dialog ───────────────────────────────────────────────────────

function StatusFormDialog({
  open,
  editing,
  nextOrder,
  orgId,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: OrgMembershipStatusDef | null
  nextOrder: number
  orgId: string
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('OrgMembershipStatuses')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<MembershipStatusColor>('gray')
  const [countsAsActive, setCountsAsActive] = useState(false)
  const [isFinal, setIsFinal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editing) {
      setLabel(editing.label)
      setDescription(editing.description)
      setColor(editing.color)
      setCountsAsActive(editing.countsAsActive)
      setIsFinal(editing.isFinal)
    } else {
      setLabel(''); setDescription(''); setColor('gray')
      setCountsAsActive(false); setIsFinal(false)
    }
  }, [editing, open])

  async function handleSave() {
    if (!label.trim()) return
    setSaving(true)
    try {
      const id = editing?.id
        ?? label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now()
      const payload: Omit<OrgMembershipStatusDef, 'id'> = {
        label: label.trim(),
        description: description.trim(),
        color,
        order: editing?.order ?? nextOrder,
        isBuiltIn: editing?.isBuiltIn ?? false,
        countsAsActive,
        isFinal,
      }
      await setDoc(
        doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION, id),
        { ...payload, updated_at: serverTimestamp() },
        { merge: true },
      )
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle') : t('addTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t('labelLabel')}</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('labelPlaceholder')}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('descriptionLabel')}</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('colorLabel')}</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  title={c.label}
                  className={`h-7 w-7 rounded-full ${c.bg} transition-all ${
                    color === c.id ? 'ring-2 ring-offset-2 ring-foreground scale-110' : 'opacity-70 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2 pt-1 border-t">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={countsAsActive}
                onChange={(e) => setCountsAsActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <div>
                <p className="text-sm font-medium">{t('countsAsActiveLabel')}</p>
                <p className="text-xs text-muted-foreground">{t('countsAsActiveDesc')}</p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isFinal}
                onChange={(e) => setIsFinal(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <div>
                <p className="text-sm font-medium">{t('isFinalLabel')}</p>
                <p className="text-xs text-muted-foreground">{t('isFinalDesc')}</p>
              </div>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={handleSave} disabled={saving || !label.trim()}>
            {saving ? '…' : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── membership statuses card ─────────────────────────────────────────────────

function MembershipStatusesCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const t = useTranslations('OrgMembershipStatuses')
  const qc = useQueryClient()
  const { data: defs = [], isLoading } = useStatusDefs(orgId)
  const [toast, setToast] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrgMembershipStatusDef | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OrgMembershipStatusDef | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [working, setWorking] = useState(false)

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 3000)
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['org-membership-statuses', orgId] })
    qc.invalidateQueries({ queryKey: ['org-membership-statuses'] })
  }

  async function reorder(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= defs.length) return
    const reordered = [...defs]
    ;[reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]]
    setWorking(true)
    try {
      const batch = writeBatch(db)
      reordered.forEach((s, i) => {
        batch.update(
          doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION, s.id),
          { order: i },
        )
      })
      await batch.commit()
      invalidate()
    } finally {
      setWorking(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setWorking(true)
    try {
      await deleteDoc(
        doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION, deleteTarget.id),
      )
      // Re-compact order values after deletion
      const remaining = defs.filter((s) => s.id !== deleteTarget.id)
      const batch = writeBatch(db)
      remaining.forEach((s, i) => {
        batch.update(
          doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION, s.id),
          { order: i },
        )
      })
      await batch.commit()
      invalidate()
      showToast(t('deleted'))
    } finally {
      setWorking(false)
      setDeleteTarget(null)
    }
  }

  async function handleReset() {
    setWorking(true)
    try {
      // Delete all current statuses
      const batch = writeBatch(db)
      defs.forEach((s) => {
        batch.delete(doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION, s.id))
      })
      // Write all defaults
      DEFAULT_ORG_MEMBERSHIP_STATUSES.forEach((s) => {
        batch.set(
          doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION, s.id),
          { ...s, updated_at: serverTimestamp() },
        )
      })
      await batch.commit()
      invalidate()
      showToast(t('saved'))
    } finally {
      setWorking(false)
      setResetOpen(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IdCard className="h-4 w-4" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <>
              <div className="divide-y rounded-md border">
                {defs.map((s, index) => (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-2.5">
                    {/* Reorder */}
                    {isAdmin && (
                      <div className="flex flex-col shrink-0">
                        <button
                          onClick={() => reorder(index, 'up')}
                          disabled={index === 0 || working}
                          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => reorder(index, 'down')}
                          disabled={index === defs.length - 1 || working}
                          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {/* Color dot */}
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${COLOR_DOT[s.color] ?? COLOR_DOT.gray}`} />
                    {/* Label + description */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{s.label}</p>
                      {s.description && (
                        <p className="text-xs text-muted-foreground truncate">{s.description}</p>
                      )}
                    </div>
                    {/* Actions */}
                    {isAdmin && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => { setEditing(s); setFormOpen(true) }}
                          disabled={working}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(s)}
                          disabled={working || defs.length <= 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => { setEditing(null); setFormOpen(true) }}
                    className="gap-1.5" disabled={working}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('addButton')}
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setResetOpen(true)}
                    className="gap-1.5 text-muted-foreground" disabled={working}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('resetButton')}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <StatusFormDialog
        open={formOpen}
        editing={editing}
        nextOrder={defs.length}
        orgId={orgId}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSaved={() => { invalidate(); showToast(t('saved')) }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmDeleteMessage')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('deleteButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmResetTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmResetMessage')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              {t('resetButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white bg-green-600 z-50">
          {toast}
        </div>
      )}
    </>
  )
}

// ─── terminology card ─────────────────────────────────────────────────────────

const LOCALES: { key: 'en' | 'de' | 'fr' | 'it'; flag: string; label: string }[] = [
  { key: 'en', flag: '🇬🇧', label: 'EN' },
  { key: 'de', flag: '🇩🇪', label: 'DE' },
  { key: 'fr', flag: '🇫🇷', label: 'FR' },
  { key: 'it', flag: '🇮🇹', label: 'IT' },
]

function TerminologyCard({
  orgId,
  org,
  isAdmin,
  onSaved,
}: {
  orgId: string
  org: Organization | null
  isAdmin: boolean
  onSaved: (msg: string) => void
}) {
  const t = useTranslations('OrgSettings')
  const qc = useQueryClient()

  const [terms, setTerms] = useState<Partial<Record<'en' | 'de' | 'fr' | 'it', string>>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTerms(org?.membership_term ?? {})
  }, [org])

  async function handleSave() {
    setSaving(true)
    try {
      const cleaned: Partial<Record<string, string>> = {}
      for (const { key } of LOCALES) {
        const v = terms[key]?.trim()
        if (v) cleaned[key] = v
      }
      await updateDoc(doc(db, ORGANIZATIONS_COLLECTION, orgId), {
        membership_term: Object.keys(cleaned).length > 0 ? cleaned : deleteField(),
      })
      qc.invalidateQueries({ queryKey: ['org', orgId] })
      qc.invalidateQueries({ queryKey: ['org-membership-term'] })
      onSaved(t('terminologySaveSuccess'))
    } catch {
      onSaved(t('terminologySaveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Languages className="h-4 w-4" />
          {t('terminologyTitle')}
        </CardTitle>
        <CardDescription>{t('terminologyDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LOCALES.map(({ key, flag, label }) => (
            <div key={key} className="space-y-1">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{flag}</span>
                <span>{label}</span>
              </Label>
              <Input
                value={terms[key] ?? ''}
                onChange={(e) => setTerms((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder="Membership"
                maxLength={30}
                disabled={!isAdmin}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('membershipTermHint')}</p>
        {isAdmin && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? '…' : t('saveButton')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ─── membership lock card ─────────────────────────────────────────────────────

function MembershipLockCard({
  orgId,
  org,
  isAdmin,
  onSaved,
}: {
  orgId: string
  org: Organization | null
  isAdmin: boolean
  onSaved: (msg: string, type?: 'success' | 'error') => void
}) {
  const t = useTranslations('OrgSettings')
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const locked = org?.lock_org_membership ?? false

  async function handleToggle(next: boolean) {
    setSaving(true)
    try {
      await updateDoc(doc(db, ORGANIZATIONS_COLLECTION, orgId), { lock_org_membership: next })
      qc.invalidateQueries({ queryKey: ['org', orgId] })
      onSaved(t('lockMembershipSaved'))
    } catch {
      onSaved(t('lockMembershipError'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" />
          {t('lockMembershipTitle')}
        </CardTitle>
        <CardDescription>{t('lockMembershipDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {locked ? t('lockMembershipEnabled') : t('lockMembershipDisabled')}
          </p>
          <Switch
            checked={locked}
            onCheckedChange={handleToggle}
            disabled={saving}
            aria-label={t('lockMembershipTitle')}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function OrgSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const t = useTranslations('OrgSettings')
  const { org, loading, isAdmin } = useOrg()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (org) { setName(org.name); setDescription(org.description ?? '') }
  }, [org])

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'organizations', orgId), {
        name: name.trim(), description: description.trim(),
      })
      qc.invalidateQueries({ queryKey: ['org', orgId] })
      showToast(t('saveSuccess'))
    } catch {
      showToast(t('saveError'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('title')}</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">{t('nameLabel')}</Label>
                <Input
                  id="org-name" value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  disabled={!isAdmin} required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-description">{t('descriptionLabel')}</Label>
                <Input
                  id="org-description" value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('descriptionPlaceholder')}
                  disabled={!isAdmin}
                />
              </div>
              {isAdmin && (
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving ? '…' : t('saveButton')}
                </Button>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      <TerminologyCard orgId={orgId} org={org} isAdmin={isAdmin} onSaved={(msg) => showToast(msg)} />

      <MembershipLockCard orgId={orgId} org={org} isAdmin={isAdmin} onSaved={(msg, type) => showToast(msg, type)} />

      <MembershipStatusesCard orgId={orgId} isAdmin={isAdmin} />

      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white z-50 ${
          toast.type === 'error' ? 'bg-destructive' : 'bg-green-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
