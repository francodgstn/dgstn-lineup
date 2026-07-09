'use client'

// Per-type editor forms for the organization site builder. Mirrors
// apps/web/src/plugins/website/SectionEditor.tsx (the team site builder) for the
// shared section types (hero/content/gallery/contact), plus three NEW editors for
// the org-only aggregate sections (clubs/locations/coaches).

import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageIcon, X, Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type {
  OrgSiteSection,
  HeroSection,
  ContentSection,
  GallerySection,
  ContactSection,
  ClubsSection,
  LocationsSection,
  CoachesSection,
} from '@linyup/shared'
import { RichTextEditor } from '@/components/RichTextEditor'
import { uploadOrgSiteImage } from './hooks'
import { newSectionId } from '@/plugins/website/defaults'

const MAX_GALLERY_IMAGES = 24
const MAX_IMAGE_SIZE_MB = 5

// ─── small field helper ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

// ─── image field ────────────────────────────────────────────────────────────

function ImageField({
  label,
  url,
  orgId,
  sectionId,
  onChange,
  aspect = 'wide',
}: {
  label: string
  url?: string
  orgId: string
  sectionId: string
  onChange: (url: string | undefined) => void
  aspect?: 'wide' | 'square'
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      toast.error(`Image must be under ${MAX_IMAGE_SIZE_MB} MB`)
      return
    }
    setUploading(true)
    try {
      const u = await uploadOrgSiteImage(orgId, sectionId, file)
      onChange(u)
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <Field label={label}>
      {url ? (
        <div
          className={`relative overflow-hidden rounded-lg border bg-muted ${aspect === 'wide' ? 'h-28 w-full' : 'h-20 w-20'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 hover:bg-background"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={uploading}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50 ${aspect === 'wide' ? 'h-20 w-full' : 'h-20 w-20'}`}
        >
          <ImageIcon className="h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      )}
      <input ref={ref} type="file" accept="image/*" onChange={handle} className="hidden" />
    </Field>
  )
}

// ─── per-type editors ─────────────────────────────────────────────────────────

type Patch = Record<string, unknown>

function HeroFields({
  s,
  orgId,
  onChange,
}: {
  s: HeroSection
  orgId: string
  onChange: (p: Patch) => void
}) {
  return (
    <div className="space-y-3">
      <Field label="Headline">
        <Input value={s.headline} onChange={(e) => onChange({ headline: e.target.value })} className="h-9" />
      </Field>
      <Field label="Subheadline">
        <Textarea
          value={s.subheadline ?? ''}
          onChange={(e) => onChange({ subheadline: e.target.value })}
          rows={2}
        />
      </Field>
      <ImageField
        label="Background image"
        url={s.bgImageUrl}
        orgId={orgId}
        sectionId={s.id}
        onChange={(u) => onChange({ bgImageUrl: u })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Alignment">
          <Select value={s.align} onValueChange={(v) => onChange({ align: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="left">Left</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={`Overlay (${s.overlay ?? 40}%)`}>
          <input
            type="range"
            min={0}
            max={100}
            value={s.overlay ?? 40}
            onChange={(e) => onChange({ overlay: Number(e.target.value) })}
            className="mt-3 w-full accent-primary"
          />
        </Field>
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs font-medium text-muted-foreground">Call-to-action button</p>
        <Field label="Button label">
          <Input
            value={s.cta?.label ?? ''}
            onChange={(e) =>
              onChange({ cta: e.target.value ? { label: e.target.value, action: 'url', url: s.cta?.url } : undefined })
            }
            placeholder="e.g. Find a club near you"
            className="h-9"
          />
        </Field>
        {s.cta?.label && (
          <Field label="URL">
            <Input
              value={s.cta?.url ?? ''}
              onChange={(e) => onChange({ cta: { label: s.cta?.label, action: 'url', url: e.target.value } })}
              placeholder="https://"
              className="h-9 font-mono text-xs"
            />
          </Field>
        )}
      </div>
    </div>
  )
}

function ContentFields({
  s,
  orgId,
  onChange,
}: {
  s: ContentSection
  orgId: string
  onChange: (p: Patch) => void
}) {
  // RichTextEditor is uncontrolled after mount and memoized: pass STABLE
  // callbacks (latest onChange via a ref) so typing never re-mounts it, and key
  // it by section id so switching sections loads the right body.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const handleBody = useCallback((html: string) => onChangeRef.current({ body: html }), [])
  const handleUpload = useCallback((file: File) => uploadOrgSiteImage(orgId, s.id, file), [orgId, s.id])

  return (
    <div className="space-y-3">
      <Field label="Title (optional)">
        <Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} className="h-9" />
      </Field>
      <Field label="Content">
        <RichTextEditor
          key={s.id}
          value={s.body}
          onChange={handleBody}
          onUploadImage={handleUpload}
          minHeight={240}
          placeholder="Write your content, or press “/” for formatting…"
        />
      </Field>
      <ImageField
        label="Image (optional)"
        url={s.imageUrl}
        orgId={orgId}
        sectionId={s.id}
        onChange={(u) => onChange({ imageUrl: u })}
      />
      {s.imageUrl && (
        <Field label="Image side">
          <Select value={s.imageSide} onValueChange={(v) => onChange({ imageSide: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  )
}

function GalleryFields({
  s,
  orgId,
  onChange,
}: {
  s: GallerySection
  orgId: string
  onChange: (p: Patch) => void
}) {
  const addRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function addImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (s.images.length >= MAX_GALLERY_IMAGES) {
      toast.error(`Up to ${MAX_GALLERY_IMAGES} photos`)
      return
    }
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      toast.error(`Image must be under ${MAX_IMAGE_SIZE_MB} MB`)
      return
    }
    setUploading(true)
    try {
      const url = await uploadOrgSiteImage(orgId, s.id, file)
      onChange({ images: [...s.images, { url }] })
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      if (addRef.current) addRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Heading (optional)">
        <Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} className="h-9" />
      </Field>
      <Field label="Columns">
        <Select value={String(s.columns)} onValueChange={(v) => onChange({ columns: Number(v) })}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={`Photos (${s.images.length}/${MAX_GALLERY_IMAGES})`}>
        <div className="grid grid-cols-3 gap-2">
          {s.images.map((img, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange({ images: s.images.filter((_, j) => j !== i) })}
                className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 hover:bg-background"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addRef.current?.click()}
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-input text-xs text-muted-foreground hover:border-primary/50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {uploading ? '…' : 'Add'}
          </button>
        </div>
        <input ref={addRef} type="file" accept="image/*" onChange={addImage} className="hidden" />
      </Field>
    </div>
  )
}

function ContactFields({ s, onChange }: { s: ContactSection; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Heading">
        <Input
          value={s.heading ?? ''}
          onChange={(e) => onChange({ heading: e.target.value })}
          placeholder="Get in touch"
          className="h-9"
        />
      </Field>
      <Field label="Address">
        <Textarea value={s.address ?? ''} onChange={(e) => onChange({ address: e.target.value })} rows={2} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <Input value={s.phone ?? ''} onChange={(e) => onChange({ phone: e.target.value })} className="h-9" />
        </Field>
        <Field label="Email">
          <Input value={s.email ?? ''} onChange={(e) => onChange({ email: e.target.value })} className="h-9" />
        </Field>
      </div>
      <Field label="Opening hours">
        <Textarea
          value={s.hours ?? ''}
          onChange={(e) => onChange({ hours: e.target.value })}
          rows={2}
          placeholder="Mon–Fri 9–18"
        />
      </Field>
      <Field label="Map location (address or place)">
        <Input
          value={s.mapQuery ?? ''}
          onChange={(e) => onChange({ mapQuery: e.target.value })}
          className="h-9"
          placeholder="Bahnhofstrasse 1, Zürich"
        />
      </Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">Show social links</span>
        <Switch checked={s.showSocial ?? false} onCheckedChange={(v) => onChange({ showSocial: v })} />
      </label>
    </div>
  )
}

// ─── org-only aggregate editors ────────────────────────────────────────────────

function ColumnsField({
  columns,
  onChange,
}: {
  columns: 2 | 3 | 4
  onChange: (v: number) => void
}) {
  return (
    <Field label="Columns">
      <Select value={String(columns)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-9 w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="2">2</SelectItem>
          <SelectItem value="3">3</SelectItem>
          <SelectItem value="4">4</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}

function ClubsFields({ s, onChange }: { s: ClubsSection; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        A card per member club, pulled live from your organization&apos;s teams and each club&apos;s own
        public profile (logo, name, address).
      </p>
      <Field label="Heading">
        <Input
          value={s.heading ?? ''}
          onChange={(e) => onChange({ heading: e.target.value })}
          placeholder="Our clubs"
          className="h-9"
        />
      </Field>
      <Field label="Subheading">
        <Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" />
      </Field>
      <ColumnsField columns={s.columns} onChange={(v) => onChange({ columns: v })} />
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">Show address on each card</span>
        <Switch checked={s.showAddress ?? false} onCheckedChange={(v) => onChange({ showAddress: v })} />
      </label>
    </div>
  )
}

function LocationsFields({ s, onChange }: { s: LocationsSection; onChange: (p: Patch) => void }) {
  const extra = s.extra ?? []

  function addExtra() {
    onChange({ extra: [...extra, { id: newSectionId(), name: '' }] })
  }
  function updateExtra(id: string, patch: Partial<{ name: string; address: string; mapsLink: string }>) {
    onChange({ extra: extra.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }
  function removeExtra(id: string) {
    onChange({ extra: extra.filter((e) => e.id !== id) })
  }

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        Every club&apos;s primary address is listed automatically. Add extra venues below (e.g. an
        event hall or a second site) that aren&apos;t one of your clubs.
      </p>
      <Field label="Heading">
        <Input
          value={s.heading ?? ''}
          onChange={(e) => onChange({ heading: e.target.value })}
          placeholder="Find us"
          className="h-9"
        />
      </Field>
      <Field label="Subheading">
        <Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" />
      </Field>
      <ColumnsField columns={s.columns} onChange={(v) => onChange({ columns: v })} />

      <div className="space-y-2">
        <Label className="text-xs">Extra venues</Label>
        {extra.map((e) => (
          <div key={e.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  value={e.name}
                  onChange={(ev) => updateExtra(e.id, { name: ev.target.value })}
                  placeholder="Venue name"
                  className="h-9"
                />
                <Textarea
                  value={e.address ?? ''}
                  onChange={(ev) => updateExtra(e.id, { address: ev.target.value })}
                  placeholder="Address"
                  rows={2}
                />
                <Input
                  value={e.mapsLink ?? ''}
                  onChange={(ev) => updateExtra(e.id, { mapsLink: ev.target.value })}
                  placeholder="Maps link (optional)"
                  className="h-9 font-mono text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeExtra(e.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addExtra}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input py-2.5 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          Add venue
        </button>
      </div>
    </div>
  )
}

function CoachesFields({ s, onChange }: { s: CoachesSection; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        Roster is pulled live from every member club that opted in to list its coaches
        publicly (Coaches page → &ldquo;List coaches on the organization website&rdquo;).
      </p>
      <Field label="Heading">
        <Input
          value={s.heading ?? ''}
          onChange={(e) => onChange({ heading: e.target.value })}
          placeholder="Our coaches"
          className="h-9"
        />
      </Field>
      <Field label="Subheading">
        <Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" />
      </Field>
      <ColumnsField columns={s.columns} onChange={(v) => onChange({ columns: v })} />
    </div>
  )
}

// ─── dispatcher ───────────────────────────────────────────────────────────────

export function OrgSectionEditor({
  section,
  orgId,
  onChange,
}: {
  section: OrgSiteSection
  orgId: string
  onChange: (patch: Patch) => void
}) {
  switch (section.type) {
    case 'hero':
      return <HeroFields s={section} orgId={orgId} onChange={onChange} />
    case 'content':
      return <ContentFields s={section} orgId={orgId} onChange={onChange} />
    case 'gallery':
      return <GalleryFields s={section} orgId={orgId} onChange={onChange} />
    case 'contact':
      return <ContactFields s={section} onChange={onChange} />
    case 'clubs':
      return <ClubsFields s={section} onChange={onChange} />
    case 'locations':
      return <LocationsFields s={section} onChange={onChange} />
    case 'coaches':
      return <CoachesFields s={section} onChange={onChange} />
    default:
      return null
  }
}
