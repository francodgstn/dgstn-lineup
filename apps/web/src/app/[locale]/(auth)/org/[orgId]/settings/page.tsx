'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useParams } from 'next/navigation'
import {
  doc, updateDoc, getDocs, collection, setDoc, deleteDoc,
  serverTimestamp, writeBatch, query,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Settings, IdCard, Pencil, Trash2, Plus, ChevronUp, ChevronDown, RotateCcw, Languages, Lock, Mail, Copy, CheckCircle2, Clock, XCircle, Share2 } from 'lucide-react'
import { deleteField } from 'firebase/firestore'
import {
  ORGANIZATIONS_COLLECTION, ORG_AFFILIATION_STATUSES_SUBCOLLECTION,
  DEFAULT_ORG_AFFILIATION_STATUSES, AFFILIATION_TYPES_SUBCOLLECTION,
} from '@linyup/shared'
import type { OrgAffiliationStatusDef, AffiliationStatusColor, Organization, AffiliationType, AffiliationIssuer } from '@linyup/shared'
import { useEmailSenderSettings } from '@/hooks/useEmailSenderSettings'
import { SOCIAL_PLATFORMS, SOCIAL_LABELS } from '@/lib/bioLink'
import { Tip } from '@/components/ui/tip'

// The four languages the product speaks — same set as the i18n routing. Mirrors
// TEAM_LANGUAGES in settings/team/page.tsx (same semantics: Organization.language
// is the language the org authors content in, not the reader's dashboard
// language — see the field's doc comment in packages/shared/src/types/org.ts).
const ORG_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
] as const

// ─── colour config ────────────────────────────────────────────────────────────

const COLORS: { id: AffiliationStatusColor; bg: string; label: string }[] = [
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
  return useQuery<OrgAffiliationStatusDef[]>({
    queryKey: ['org-membership-statuses', orgId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const snap = await getDocs(
        collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION),
      )
      if (snap.empty) {
        // Auto-initialize with defaults on first visit to this settings page
        const batch = writeBatch(db)
        DEFAULT_ORG_AFFILIATION_STATUSES.forEach((s) => {
          batch.set(
            doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION, s.id),
            { ...s, updated_at: serverTimestamp() },
          )
        })
        await batch.commit()
        return DEFAULT_ORG_AFFILIATION_STATUSES
      }
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as OrgAffiliationStatusDef))
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
  editing: OrgAffiliationStatusDef | null
  nextOrder: number
  orgId: string
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('OrgAffiliationStatuses')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<AffiliationStatusColor>('gray')
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
      const payload: Omit<OrgAffiliationStatusDef, 'id'> = {
        label: label.trim(),
        description: description.trim(),
        color,
        order: editing?.order ?? nextOrder,
        isBuiltIn: editing?.isBuiltIn ?? false,
        countsAsActive,
        isFinal,
      }
      await setDoc(
        doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION, id),
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
  const t = useTranslations('OrgAffiliationStatuses')
  const qc = useQueryClient()
  const { data: defs = [], isLoading } = useStatusDefs(orgId)
  const [toast, setToast] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrgAffiliationStatusDef | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OrgAffiliationStatusDef | null>(null)
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
          doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION, s.id),
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
        doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION, deleteTarget.id),
      )
      // Re-compact order values after deletion
      const remaining = defs.filter((s) => s.id !== deleteTarget.id)
      const batch = writeBatch(db)
      remaining.forEach((s, i) => {
        batch.update(
          doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION, s.id),
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
        batch.delete(doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION, s.id))
      })
      // Write all defaults
      DEFAULT_ORG_AFFILIATION_STATUSES.forEach((s) => {
        batch.set(
          doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION, s.id),
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

// Common, fully translated affiliation terms offered as one-click presets. The
// dropdown shows each in the admin's own language; picking one stores all four.
type TermPresetKey = 'membership' | 'affiliation' | 'license' | 'subscription' | 'pass'
const AFFILIATION_TERM_PRESETS: Record<TermPresetKey, Record<'en' | 'de' | 'fr' | 'it', string>> = {
  membership: { en: 'Membership', de: 'Mitgliedschaft', fr: 'Adhésion', it: 'Iscrizione' },
  affiliation: { en: 'Affiliation', de: 'Zugehörigkeit', fr: 'Affiliation', it: 'Affiliazione' },
  license: { en: 'License', de: 'Lizenz', fr: 'Licence', it: 'Licenza' },
  subscription: { en: 'Subscription', de: 'Abonnement', fr: 'Abonnement', it: 'Abbonamento' },
  pass: { en: 'Pass', de: 'Pass', fr: 'Pass', it: 'Pass' },
}
const TERM_PRESET_KEYS: TermPresetKey[] = ['membership', 'affiliation', 'license', 'subscription', 'pass']

// Does a saved term map exactly equal one of the presets? (so editing re-selects it)
function detectTermPreset(m: Partial<Record<string, string>>): TermPresetKey | null {
  for (const k of TERM_PRESET_KEYS) {
    const dict = AFFILIATION_TERM_PRESETS[k]
    if (LOCALES.every(({ key }) => (m[key] ?? '') === dict[key])) return k
  }
  return null
}

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
  const locale = useLocale()
  const qc = useQueryClient()

  // '' = default (cleared), a preset key, or 'custom'.
  const [preset, setPreset] = useState<TermPresetKey | 'custom' | ''>('')
  const [def, setDef] = useState('') // custom default term (used for every language)
  const [translations, setTranslations] = useState<Partial<Record<'en' | 'de' | 'fr' | 'it', string>>>({})
  const [showTranslations, setShowTranslations] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const m = org?.affiliation_term ?? {}
    const detected = detectTermPreset(m)
    if (detected) {
      setPreset(detected)
      setDef('')
      setTranslations({})
      setShowTranslations(false)
    } else if (Object.keys(m).length > 0) {
      const d = m.en ?? Object.values(m).find((v) => v && v.trim()) ?? ''
      const overrides: Partial<Record<'en' | 'de' | 'fr' | 'it', string>> = {}
      for (const { key } of LOCALES) if (m[key] && m[key] !== d) overrides[key] = m[key]!
      setPreset('custom')
      setDef(d)
      setTranslations(overrides)
      setShowTranslations(Object.keys(overrides).length > 0)
    } else {
      setPreset('')
      setDef('')
      setTranslations({})
      setShowTranslations(false)
    }
  }, [org])

  const isCustom = preset === 'custom'
  const presetLabel = (k: TermPresetKey) =>
    AFFILIATION_TERM_PRESETS[k][locale as 'en'] ?? AFFILIATION_TERM_PRESETS[k].en

  function onPresetChange(p: TermPresetKey | 'custom' | '') {
    setPreset(p)
    if (p === 'custom') {
      // Seed the default with the current resolved term so the user can tweak it.
      if (!def.trim()) {
        const current = LOCALES.map(({ key }) => org?.affiliation_term?.[key]).find((v) => v && v.trim())
        setDef(current ?? '')
      }
    } else {
      setTranslations({})
      setShowTranslations(false)
    }
  }

  function updateTranslation(loc: 'en' | 'de' | 'fr' | 'it', value: string) {
    setTranslations((prev) => ({ ...prev, [loc]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      let value: Partial<Record<string, string>> | ReturnType<typeof deleteField>
      if (preset === '') {
        value = deleteField()
      } else if (preset !== 'custom') {
        value = { ...AFFILIATION_TERM_PRESETS[preset] }
      } else {
        const d = def.trim()
        if (!d) {
          setSaving(false)
          return
        }
        // Every language gets its override or the default — so one term is enough.
        const map: Partial<Record<string, string>> = {}
        for (const { key } of LOCALES) map[key] = translations[key]?.trim() || d
        value = map
      }
      await updateDoc(doc(db, ORGANIZATIONS_COLLECTION, orgId), { affiliation_term: value })
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
        <div className="space-y-1.5">
          <Label>{t('terminologyTermLabel')}</Label>
          <Select
            value={preset}
            onValueChange={(v) => onPresetChange(v as TermPresetKey | 'custom' | '')}
            disabled={!isAdmin}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('terminologyPresetDefault')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('terminologyPresetDefault')}</SelectItem>
              {TERM_PRESET_KEYS.map((k) => (
                <SelectItem key={k} value={k}>{presetLabel(k)}</SelectItem>
              ))}
              <SelectItem value="custom">{t('terminologyPresetCustom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isCustom && (
          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label>{t('terminologyDefaultLabel')}</Label>
              <Input
                value={def}
                onChange={(e) => setDef(e.target.value)}
                placeholder="Affiliation"
                maxLength={30}
                disabled={!isAdmin}
              />
              <p className="text-xs text-muted-foreground">{t('terminologyDefaultHint')}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowTranslations((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTranslations ? '' : '-rotate-90'}`} />
              {t('terminologyAddTranslations')}
            </button>
            {showTranslations && (
              <div className="space-y-2 rounded-lg border p-3">
                {LOCALES.map(({ key, flag, label }) => (
                  <div key={key} className="grid grid-cols-[3rem_1fr] items-center gap-2">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <span>{flag}</span>
                      <span>{label}</span>
                    </span>
                    <Input
                      value={translations[key] ?? ''}
                      onChange={(e) => updateTranslation(key, e.target.value)}
                      placeholder={def || 'Affiliation'}
                      maxLength={30}
                      disabled={!isAdmin}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t('affiliationTermHint')}</p>
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
  const locked = org?.lock_affiliation ?? false

  async function handleToggle(next: boolean) {
    setSaving(true)
    try {
      await updateDoc(doc(db, ORGANIZATIONS_COLLECTION, orgId), { lock_affiliation: next })
      qc.invalidateQueries({ queryKey: ['org', orgId] })
      onSaved(t('lockAffiliationSaved'))
    } catch {
      onSaved(t('lockAffiliationError'), 'error')
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
          {t('lockAffiliationTitle')}
        </CardTitle>
        <CardDescription>{t('lockAffiliationDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {locked ? t('lockAffiliationEnabled') : t('lockAffiliationDisabled')}
          </p>
          <Switch
            checked={locked}
            onCheckedChange={handleToggle}
            disabled={saving}
            aria-label={t('lockAffiliationTitle')}
          />
        </div>
      </CardContent>
    </Card>
  )
}


// ─── org social links card ────────────────────────────────────────────────────

/**
 * The organisation's own social profiles.
 *
 * SAME SHAPE AS A STUDIO'S — `SocialLink[]`, the same `SOCIAL_PLATFORMS` list
 * and the same labels — because the renderer is already shared: `ContactBlock`
 * reads `ctx.socialLinks` without caring which tenant filled it. The org side
 * simply never filled it, so the website's "show social links" switch could not,
 * in any state, change what a visitor saw, and was removed rather than faked.
 * This is the field that earns it back.
 *
 * ONE INPUT PER PLATFORM, not a repeatable row: the platform list is closed (the
 * renderer maps each to an icon), so a free-form "add a link" control would let
 * somebody enter a platform nothing can draw.
 */
function OrgSocialLinksCard({
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
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)

  // Seed from the stored value once it arrives, and not again — re-seeding on
  // every render would fight whatever is being typed.
  useEffect(() => {
    if (dirty) return
    const next: Record<string, string> = {}
    for (const l of org?.socialLinks ?? []) next[l.platform] = l.url
    setUrls(next)
  }, [org?.socialLinks, dirty])

  async function handleSave() {
    setSaving(true)
    try {
      // BLANKS ARE DROPPED, not stored as empty strings: the renderer filters on
      // a truthy url anyway, and a row of empty entries would make an
      // organisation with no socials look like one with six broken links.
      const socialLinks = SOCIAL_PLATFORMS.filter((pf) => (urls[pf] ?? '').trim()).map((pf) => ({
        platform: pf,
        url: urls[pf].trim(),
      }))
      await updateDoc(doc(db, ORGANIZATIONS_COLLECTION, orgId), { socialLinks })
      qc.invalidateQueries({ queryKey: ['org', orgId] })
      setDirty(false)
      onSaved(t('saveSuccess'))
    } catch {
      onSaved(t('saveError'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Share2 className="h-4 w-4" />
          {t('socialTitle')}
        </CardTitle>
        <CardDescription>{t('socialDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {SOCIAL_PLATFORMS.map((platform) => (
          <div key={platform} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-sm font-medium">{SOCIAL_LABELS[platform]}</span>
            <Input
              value={urls[platform] ?? ''}
              onChange={(e) => {
                setDirty(true)
                setUrls((prev) => ({ ...prev, [platform]: e.target.value }))
              }}
              placeholder="https://"
              className="h-8 font-mono text-sm"
            />
          </div>
        ))}
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
            {t('saveButton')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── org email sender card ────────────────────────────────────────────────────

function OrgEmailSenderCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const t = useTranslations('EmailSettings')
  const { user } = useAuth()
  const {
    data: config,
    isLoading,
    registerDomain,
    checkDomain,
    revertToManaged,
    isRegistering,
    isChecking,
    isReverting,
    sendTest,
    isSendingTest,
  } = useEmailSenderSettings('org', orgId)

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
      // silent — status stays as-is
    }
  }

  async function handleRevert() {
    try {
      await revertToManaged()
    } catch {
      // silent
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('orgSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Managed card */}
            <div className={`rounded-lg border p-4 space-y-1 ${!isByo ? 'border-primary/40 bg-primary/5' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t('managedTitle')}</p>
                {!isByo && (
                  <Badge variant="secondary" className="text-xs">{t('active')}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('managedDescription')}</p>
            </div>

            {/* BYO domain — register */}
            {!isByo && isAdmin && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('byoSectionTitle')}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor="org-byo-domain">{t('domainLabel')}</Label>
                    <Input
                      id="org-byo-domain"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      placeholder="myorg.ch"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="org-byo-from-local">{t('fromLocalPartLabel')}</Label>
                    <Input
                      id="org-byo-from-local"
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

            {/* BYO domain active */}
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
                                <Tip label={t('copyValue')}>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(record.value, `${idx}-value`)}
                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    aria-label={t('copyValue')}
                                  >
                                    {copiedKey === `${idx}-value`
                                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                      : <Copy className="h-3.5 w-3.5" />
                                    }
                                  </button>
                                </Tip>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('dmarcNote')}</p>
                  </div>
                )}

                {isAdmin && (
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
                )}
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
                  <Label htmlFor="org-test-recipient">{t('recipientLabel')}</Label>
                  <Input
                    id="org-test-recipient"
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
        )}
      </CardContent>
    </Card>
  )
}

// ─── org affiliation types card ───────────────────────────────────────────────

function OrgAffiliationTypesCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const t = useTranslations('OrgAffiliationTypes')
  const qc = useQueryClient()

  const { data: types = [], isLoading } = useQuery<AffiliationType[]>({
    queryKey: ['org-affiliation-types', orgId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const snap = await getDocs(
        collection(db, ORGANIZATIONS_COLLECTION, orgId, AFFILIATION_TYPES_SUBCOLLECTION),
      )
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as AffiliationType))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    },
  })

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AffiliationType | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AffiliationType | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }
  function invalidate() { qc.invalidateQueries({ queryKey: ['org-affiliation-types', orgId] }) }

  function AffTypeDialog() {
    const [key, setKey] = useState(editing?.key ?? '')
    const [label, setLabel] = useState(editing?.label ?? '')
    const [defaultIssuer, setDefaultIssuer] = useState<AffiliationIssuer>(editing?.default_issuer ?? 'org')
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
          org_id: orgId,
        }
        await setDoc(
          doc(db, ORGANIZATIONS_COLLECTION, orgId, AFFILIATION_TYPES_SUBCOLLECTION, id),
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
              {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <>
              {types.length === 0 ? (
                <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">{t('noTypes')}</div>
              ) : (
                <div className="divide-y rounded-md border">
                  {types.map((at) => (
                    <div key={at.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{at.label}</p>
                        <p className="text-xs text-muted-foreground font-mono">{at.key}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">{t(`issuer_${at.default_issuer}` as 'issuer_org')}</Badge>
                      {isAdmin && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(at); setFormOpen(true) }}>
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTarget(at)}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => { setEditing(null); setFormOpen(true) }} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  {t('addButton')}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
                await deleteDoc(doc(db, ORGANIZATIONS_COLLECTION, orgId, AFFILIATION_TYPES_SUBCOLLECTION, deleteTarget.id))
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
    </>
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
  const [language, setLanguage] = useState<'en' | 'de' | 'fr' | 'it'>('en')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (org) {
      setName(org.name)
      setDescription(org.description ?? '')
      // 'en' is what the field's readers already fall back to for an org with
      // no value (resolveSiteSourceLocale), so the control shows the truth
      // rather than an empty box that implies nothing has been decided.
      setLanguage(org.language ?? 'en')
    }
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
        name: name.trim(), description: description.trim(), language,
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
      {/* NO HEADING HERE. The org layout titles every rail destination through
          `OrgPageHeading`, and this page printed the same words again directly
          beneath it — then a third time, as the first card's own title (Franco,
          2026-08-28). The layout's is the one that belongs to the destination;
          the card below keeps its title because it labels that card, not the
          page. */}
      <Card>
        <CardHeader>
          {/* "General", not "Settings": this card holds the organisation's name
              and description, and its siblings are Terminology, Lock
              affiliation and the rest. Titling it after the whole page said
              nothing about which card it is. */}
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            {t('generalTitle')}
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
              <div className="space-y-1.5">
                <Label htmlFor="org-language">{t('language')}</Label>
                <Select
                  value={language}
                  onValueChange={(v) => setLanguage(v as 'en' | 'de' | 'fr' | 'it')}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="org-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('languageHint')}</p>
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
      <OrgSocialLinksCard orgId={orgId} org={org} isAdmin={isAdmin} onSaved={showToast} />

      <MembershipLockCard orgId={orgId} org={org} isAdmin={isAdmin} onSaved={(msg, type) => showToast(msg, type)} />

      <MembershipStatusesCard orgId={orgId} isAdmin={isAdmin} />

      <OrgAffiliationTypesCard orgId={orgId} isAdmin={isAdmin} />

      <OrgEmailSenderCard orgId={orgId} isAdmin={isAdmin} />

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
