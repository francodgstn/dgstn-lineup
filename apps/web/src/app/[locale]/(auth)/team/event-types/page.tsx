'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
  query, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Plus, Pencil, Trash2, Lock, Package } from 'lucide-react'
import {
  TEAMS_COLLECTION, EVENT_TYPES_SUBCOLLECTION,
  BUILTIN_EVENT_TYPES,
} from '@linyup/shared'
import type { EventTypeConfig, EventTypeField, EventTypeFieldType } from '@linyup/shared'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { useTranslations } from 'next-intl'

// ─── constants ────────────────────────────────────────────────────────────────

const FIELD_TYPES: { value: EventTypeFieldType; label: string }[] = [
  { value: 'text',        label: 'Text' },
  { value: 'number',      label: 'Number' },
  { value: 'select',      label: 'Single select' },
  { value: 'multiselect', label: 'Multi select' },
  { value: 'boolean',     label: 'Yes / No' },
]

const BUILTIN_LABELS: Record<string, string> = {
  competition: 'Competition',
  camp: 'Camp',
  exam: 'Exam',
  seminar: 'Seminar',
  workshop: 'Workshop',
}

// ─── field builder ────────────────────────────────────────────────────────────

function FieldBuilder({
  fields,
  onChange,
}: {
  fields: EventTypeField[]
  onChange: (fields: EventTypeField[]) => void
}) {
  function addField() {
    onChange([...fields, { key: `field_${fields.length + 1}`, label: '', type: 'text' }])
  }
  function removeField(i: number) {
    onChange(fields.filter((_, idx) => idx !== i))
  }
  function updateField(i: number, patch: Partial<EventTypeField>) {
    onChange(fields.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  }

  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-2 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={f.label}
                  onChange={(e) => updateField(i, { label: e.target.value })}
                  placeholder="Field label"
                  className="h-7 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={f.type} onValueChange={(v) => updateField(i, { type: v as EventTypeFieldType })}>
                  <SelectTrigger className="h-7 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
              onClick={() => removeField(i)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {(f.type === 'select' || f.type === 'multiselect') && (
            <div className="space-y-1">
              <Label className="text-xs">Options (one per line)</Label>
              <textarea
                className="w-full rounded-md border px-2 py-1 text-sm h-16 resize-none"
                value={(f.options ?? []).join('\n')}
                onChange={(e) => updateField(i, { options: e.target.value.split('\n').filter(Boolean) })}
                placeholder="Option 1&#10;Option 2&#10;Option 3"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={!!f.required}
              onChange={(e) => updateField(i, { required: e.target.checked })}
            />
            Required
          </label>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addField}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Add check-in field
      </Button>
    </div>
  )
}

// ─── form dialog ──────────────────────────────────────────────────────────────

function EventTypeFormDialog({
  initial,
  onSave,
  onClose,
}: {
  initial?: EventTypeConfig
  onSave: (data: Omit<EventTypeConfig, 'id' | 'source' | 'created_at' | 'created_by'>) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? 'Calendar')
  const [color, setColor] = useState(initial?.color ?? '#6366F1')
  const [fields, setFields] = useState<EventTypeField[]>(initial?.checkin_fields ?? [])
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setBusy(true)
    await onSave({ name: name.trim(), icon, color, checkin_fields: fields })
    setBusy(false)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit event type' : 'New event type'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grading" />
            </div>
            <div className="space-y-1.5">
              <Label>Icon (lucide name)</Label>
              <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="Star" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <span className="text-sm text-muted-foreground">{color}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Check-in fields</Label>
            <p className="text-xs text-muted-foreground">
              These fields appear in the check-in form when someone is checked into this event type.
            </p>
            <FieldBuilder fields={fields} onChange={setFields} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function EventTypesPage() {
  const { currentTeamId } = useAuth()
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EventTypeConfig | null>(null)

  const { data: customTypes = [], isLoading } = useQuery<EventTypeConfig[]>({
    queryKey: ['event-types', currentTeamId],
    enabled: !!currentTeamId,
    queryFn: async () => {
      if (!currentTeamId) return []
      const snap = await getDocs(
        query(collection(db, TEAMS_COLLECTION, currentTeamId, EVENT_TYPES_SUBCOLLECTION), orderBy('name')),
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as EventTypeConfig)
    },
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['event-types', currentTeamId] })

  async function handleSave(data: Omit<EventTypeConfig, 'id' | 'source' | 'created_at' | 'created_by'>) {
    if (!currentTeamId) return
    if (editing) {
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId, EVENT_TYPES_SUBCOLLECTION, editing.id), {
        ...data,
        updated_at: serverTimestamp(),
      })
    } else {
      await addDoc(collection(db, TEAMS_COLLECTION, currentTeamId, EVENT_TYPES_SUBCOLLECTION), {
        ...data,
        source: 'team',
        created_at: serverTimestamp(),
      })
    }
    invalidate()
  }

  async function handleDelete(type: EventTypeConfig) {
    if (!currentTeamId) return
    if (!window.confirm(`Delete event type "${type.name}"? Events of this type won't be affected.`)) return
    await deleteDoc(doc(db, TEAMS_COLLECTION, currentTeamId, EVENT_TYPES_SUBCOLLECTION, type.id))
    invalidate()
  }

  const pluginTypes = PLUGIN_REGISTRY.filter((p) => p.eventType)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event types</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the types of events your team can run. Built-in types have hardcoded check-in forms.
          Custom types let you define your own check-in fields.
        </p>
      </div>

      {/* Built-in types */}
      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Built-in</h2>
        <div className="rounded-xl border overflow-hidden">
          {BUILTIN_EVENT_TYPES.map((type) => (
            <div key={type} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{BUILTIN_LABELS[type] ?? type}</p>
                <p className="text-xs text-muted-foreground capitalize">{type}</p>
              </div>
              <Badge variant="secondary" className="text-xs shrink-0">Built-in</Badge>
              <Lock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            </div>
          ))}
        </div>
      </section>

      {/* Plugin-provided types */}
      {pluginTypes.length > 0 && (
        <section className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">From plugins</h2>
          <div className="rounded-xl border overflow-hidden">
            {pluginTypes.map((plugin) => (
              <div key={plugin.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{plugin.eventType!.id}</p>
                  <p className="text-xs text-muted-foreground">Provided by plugin: {plugin.id}</p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">Plugin</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Custom types */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Custom</h2>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus className="h-4 w-4 mr-1.5" />
            New type
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        )}

        {!isLoading && customTypes.length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No custom event types yet. Create one to add custom check-in fields.
          </div>
        )}

        {!isLoading && customTypes.length > 0 && (
          <div className="rounded-xl border overflow-hidden">
            {customTypes.map((type) => (
              <div key={type.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                {type.color && (
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: type.color }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{type.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(type.checkin_fields?.length ?? 0) > 0
                      ? `${type.checkin_fields!.length} check-in field${type.checkin_fields!.length > 1 ? 's' : ''}`
                      : 'No check-in fields'}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => { setEditing(type); setFormOpen(true) }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(type)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {formOpen && (
        <EventTypeFormDialog
          initial={editing ?? undefined}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
