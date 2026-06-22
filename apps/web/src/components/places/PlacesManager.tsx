'use client'

// Shared Places CRUD UI — used by the team Places page (/team/places) and the org
// console (/org/[orgId]/places). The page wires the create/update/delete/setPrimary
// callbacks to the Firestore helpers + query invalidation; this component owns the
// card list, the create/edit dialog (incl. the rooms editor) and delete confirm.

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { MapPin, Plus, Trash2, ExternalLink, Star, Building2, X, Pencil, DoorOpen } from 'lucide-react'
import type { Place, PlaceRoom } from '@linyup/shared'

export interface PlaceFormValues {
  name: string
  address: string
  mapsLink: string
  isPrimary: boolean
  rooms: PlaceRoom[]
}

export interface PlacesManagerProps {
  title: string
  subtitle: string
  places: Place[] // own places (team or org)
  inherited?: Place[] // read-only inherited org places (team page only)
  allowPrimary?: boolean // team scope only
  canManage?: boolean // false → read-only (e.g. org viewer)
  cap: number
  onCreate: (data: PlaceFormValues) => Promise<void>
  onUpdate: (id: string, data: PlaceFormValues) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onSetPrimary?: (id: string) => Promise<void>
}

function newRoom(): PlaceRoom {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r_${Date.now()}_${Math.random()}`
  return { id, name: '' }
}

const EMPTY: PlaceFormValues = { name: '', address: '', mapsLink: '', isPrimary: false, rooms: [] }

export function PlacesManager({
  title,
  subtitle,
  places,
  inherited = [],
  allowPrimary = false,
  canManage = true,
  cap,
  onCreate,
  onUpdate,
  onDelete,
  onSetPrimary,
}: PlacesManagerProps) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PlaceFormValues>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Place | null>(null)

  const atCap = places.length >= cap

  function openCreate() {
    setEditingId(null)
    setForm({ ...EMPTY, isPrimary: allowPrimary && places.length === 0 })
    setOpen(true)
  }
  function openEdit(p: Place) {
    setEditingId(p.id)
    setForm({
      name: p.name ?? '',
      address: p.address ?? '',
      mapsLink: p.mapsLink ?? '',
      isPrimary: !!p.isPrimary,
      rooms: (p.rooms ?? []).map((r) => ({ ...r })),
    })
    setOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const data: PlaceFormValues = {
        ...form,
        name: form.name.trim(),
        rooms: form.rooms.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name),
      }
      if (editingId) await onUpdate(editingId, data)
      else await onCreate(data)
      setOpen(false)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} disabled={atCap}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add place
          </Button>
        )}
      </div>
      {canManage && atCap && (
        <p className="text-xs text-muted-foreground">
          You&apos;ve reached the limit of {cap} places.
        </p>
      )}

      {/* Own places */}
      <div className="space-y-2">
        {places.length === 0 && inherited.length === 0 ? (
          <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            No places yet. Add your first location.
          </p>
        ) : (
          places.map((p) => (
            <PlaceCard
              key={p.id}
              place={p}
              allowPrimary={allowPrimary}
              readOnly={!canManage}
              onEdit={() => openEdit(p)}
              onDelete={() => setConfirmDelete(p)}
              onSetPrimary={onSetPrimary ? () => onSetPrimary(p.id).catch(() => toast.error('Failed')) : undefined}
            />
          ))
        )}
      </div>

      {/* Inherited org places (read-only) */}
      {inherited.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            From your organization
          </p>
          {inherited.map((p) => (
            <PlaceCard key={p.id} place={p} readOnly />
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit place' : 'Add place'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="place-name">Name</Label>
              <Input
                id="place-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Main studio"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="place-address">Address</Label>
              <Input
                id="place-address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Bahnhofstrasse 1, 8001 Zürich"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="place-maps">Maps link</Label>
              <Input
                id="place-maps"
                value={form.mapsLink}
                onChange={(e) => setForm((f) => ({ ...f, mapsLink: e.target.value }))}
                placeholder="https://maps.google.com/…"
                className="font-mono text-sm"
              />
            </div>

            {allowPrimary && (
              <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Star className="h-4 w-4" /> Main address
                </span>
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            )}

            {/* Rooms editor */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Rooms (optional)</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => setForm((f) => ({ ...f, rooms: [...f.rooms, newRoom()] }))}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add room
                </Button>
              </div>
              {form.rooms.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add rooms to pin sessions/events to a specific space.
                </p>
              ) : (
                form.rooms.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <Input
                      value={r.name}
                      onChange={(e) =>
                        setForm((f) => {
                          const rooms = [...f.rooms]
                          rooms[i] = { ...rooms[i], name: e.target.value }
                          return { ...f, rooms }
                        })
                      }
                      placeholder={`Room ${i + 1}`}
                      className="h-8 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, rooms: f.rooms.filter((_, j) => j !== i) }))}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete place?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{confirmDelete?.name}&quot; will be removed. Sessions/events linked to it keep their text location.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDelete) {
                  await onDelete(confirmDelete.id).catch(() => toast.error('Failed to delete'))
                  setConfirmDelete(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PlaceCard({
  place,
  allowPrimary,
  readOnly,
  onEdit,
  onDelete,
  onSetPrimary,
}: {
  place: Place
  allowPrimary?: boolean
  readOnly?: boolean
  onEdit?: () => void
  onDelete?: () => void
  onSetPrimary?: () => void
}) {
  const roomCount = place.rooms?.length ?? 0
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <MapPin className="h-4 w-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{place.name}</span>
          {place.isPrimary && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Star className="h-3 w-3" /> Main address
            </Badge>
          )}
          {readOnly && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Building2 className="h-3 w-3" /> Org
            </Badge>
          )}
        </div>
        {place.address && <p className="mt-0.5 truncate text-xs text-muted-foreground">{place.address}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {roomCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <DoorOpen className="h-3.5 w-3.5" /> {roomCount} room{roomCount === 1 ? '' : 's'}
            </span>
          )}
          {place.mapsLink && (
            <a
              href={place.mapsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in maps
            </a>
          )}
        </div>
      </div>
      {!readOnly && (
        <div className="flex shrink-0 items-center gap-1">
          {allowPrimary && !place.isPrimary && onSetPrimary && (
            <button
              type="button"
              onClick={onSetPrimary}
              title="Set as main address"
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Star className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
