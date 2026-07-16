'use client'

import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageIcon, X, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type {
  WebsiteSection, HeroSection, ContentSection, GallerySection,
  ActivitiesSection, PricingSection, ScheduleSection, ContactSection, PlacesSection, SiteCta,
} from '@linyup/shared'
import { RichTextEditor } from '@/components/RichTextEditor'
import { uploadSiteImage } from './hooks'
import { getWebsiteLimits } from './limits'
import { usePlaces } from '@/hooks/usePlaces'
import { useAuth } from '@/contexts/AuthContext'

const limits = getWebsiteLimits()

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
  label, url, teamId, sectionId, onChange, aspect = 'wide',
}: {
  label: string
  url?: string
  teamId: string
  sectionId: string
  onChange: (url: string | undefined) => void
  aspect?: 'wide' | 'square'
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > limits.maxImageSizeMB * 1024 * 1024) {
      toast.error(`Image must be under ${limits.maxImageSizeMB} MB`)
      return
    }
    setUploading(true)
    try {
      const u = await uploadSiteImage(teamId, sectionId, file)
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
        <div className={`relative overflow-hidden rounded-lg border bg-muted ${aspect === 'wide' ? 'h-28 w-full' : 'h-20 w-20'}`}>
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

// ─── CTA editor ──────────────────────────────────────────────────────────────

function CtaEditor({ cta, onChange }: { cta?: SiteCta; onChange: (cta: SiteCta | undefined) => void }) {
  const value = cta ?? { label: '', action: 'booking' as const }
  const set = (patch: Partial<SiteCta>) => {
    const next = { ...value, ...patch }
    onChange(next.label ? next : undefined)
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">Call-to-action button</p>
      <Field label="Button label">
        <Input value={value.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Book a trial" className="h-9" />
      </Field>
      <Field label="Action">
        <Select value={value.action} onValueChange={(v) => set({ action: v as SiteCta['action'] })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="booking">Open booking</SelectItem>
            <SelectItem value="signup">Sign-up</SelectItem>
            <SelectItem value="url">External link</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {value.action === 'url' && (
        <Field label="URL">
          <Input value={value.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://" className="h-9 font-mono text-xs" />
        </Field>
      )}
    </div>
  )
}

// ─── per-type editors ─────────────────────────────────────────────────────────

type Patch = Record<string, unknown>

function HeroFields({ s, teamId, onChange }: { s: HeroSection; teamId: string; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Headline">
        <Input value={s.headline} onChange={(e) => onChange({ headline: e.target.value })} className="h-9" />
      </Field>
      <Field label="Subheadline">
        <Textarea value={s.subheadline ?? ''} onChange={(e) => onChange({ subheadline: e.target.value })} rows={2} />
      </Field>
      <ImageField label="Background image" url={s.bgImageUrl} teamId={teamId} sectionId={s.id} onChange={(u) => onChange({ bgImageUrl: u })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Alignment">
          <Select value={s.align} onValueChange={(v) => onChange({ align: v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="left">Left</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={`Overlay (${s.overlay ?? 40}%)`}>
          <input
            type="range" min={0} max={100} value={s.overlay ?? 40}
            onChange={(e) => onChange({ overlay: Number(e.target.value) })}
            className="mt-3 w-full accent-primary"
          />
        </Field>
      </div>
      <CtaEditor cta={s.cta} onChange={(cta) => onChange({ cta })} />
    </div>
  )
}

function ContentFields({ s, teamId, onChange }: { s: ContentSection; teamId: string; onChange: (p: Patch) => void }) {
  // RichTextEditor is uncontrolled after mount and memoized: pass STABLE
  // callbacks (latest onChange via a ref) so typing never re-mounts it, and key
  // it by section id so switching sections loads the right body.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const handleBody = useCallback((html: string) => onChangeRef.current({ body: html }), [])
  const handleUpload = useCallback((file: File) => uploadSiteImage(teamId, s.id, file), [teamId, s.id])

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
      <ImageField label="Image (optional)" url={s.imageUrl} teamId={teamId} sectionId={s.id} onChange={(u) => onChange({ imageUrl: u })} />
      {s.imageUrl && (
        <Field label="Image side">
          <Select value={s.imageSide} onValueChange={(v) => onChange({ imageSide: v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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

function GalleryFields({ s, teamId, onChange }: { s: GallerySection; teamId: string; onChange: (p: Patch) => void }) {
  const addRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function addImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (s.images.length >= limits.maxGalleryImages) {
      toast.error(`Up to ${limits.maxGalleryImages} photos`)
      return
    }
    if (file.size > limits.maxImageSizeMB * 1024 * 1024) {
      toast.error(`Image must be under ${limits.maxImageSizeMB} MB`)
      return
    }
    setUploading(true)
    try {
      const url = await uploadSiteImage(teamId, s.id, file)
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
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={`Photos (${s.images.length}/${limits.maxGalleryImages})`}>
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

function ActivitiesFields({ s, onChange }: { s: ActivitiesSection; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        Activity cards are pulled live from your activities. Edit those under Activities.
      </p>
      <Field label="Heading"><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder="What we offer" className="h-9" /></Field>
      <Field label="Subheading"><Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" /></Field>
      <Field label="Columns">
        <Select value={String(s.columns)} onValueChange={(v) => onChange({ columns: Number(v) })}>
          <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">Show “Book” link on cards</span>
        <Switch checked={s.showBooking ?? false} onCheckedChange={(v) => onChange({ showBooking: v })} />
      </label>
    </div>
  )
}

function PricingFields({ s, onChange }: { s: PricingSection; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        Pricing cards are pulled live from your membership plans (Subscriptions). Edit those under Contacts → membership types.
      </p>
      <Field label="Heading"><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Membership" className="h-9" /></Field>
      <Field label="Subheading"><Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" /></Field>
      <Field label="Button label"><Input value={s.ctaLabel ?? ''} onChange={(e) => onChange({ ctaLabel: e.target.value })} placeholder="Join now" className="h-9" /></Field>
    </div>
  )
}

function ScheduleFields({ s, onChange }: { s: ScheduleSection; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        The schedule is pulled live from your upcoming bookable sessions.
      </p>
      <Field label="Heading"><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Schedule" className="h-9" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Days ahead">
          <Select value={String(s.windowDays ?? 7)} onValueChange={(v) => onChange({ windowDays: Number(v) })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Max classes">
          {/* 0 = no cap. Keeps a busy schedule from listing dozens of rows. */}
          <Select value={String(s.maxItems ?? 0)} onValueChange={(v) => onChange({ maxItems: Number(v) || undefined })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">No limit</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="8">8</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="15">15</SelectItem>
              <SelectItem value="20">20</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Default view">
        {/* Visitors can still switch List ↔ Calendar on the live site; this sets the default. */}
        <Select value={s.displayMode ?? 'calendar'} onValueChange={(v) => onChange({ displayMode: v as ScheduleSection['displayMode'] })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="list">List</SelectItem>
            <SelectItem value="calendar">Calendar</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">Show “Book” icon on each session</span>
        <Switch checked={s.showBooking ?? false} onCheckedChange={(v) => onChange({ showBooking: v })} />
      </label>
    </div>
  )
}

function ContactFields({ s, onChange }: { s: ContactSection; onChange: (p: Patch) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Heading"><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Get in touch" className="h-9" /></Field>
      <Field label="Address"><Textarea value={s.address ?? ''} onChange={(e) => onChange({ address: e.target.value })} rows={2} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><Input value={s.phone ?? ''} onChange={(e) => onChange({ phone: e.target.value })} className="h-9" /></Field>
        <Field label="Email"><Input value={s.email ?? ''} onChange={(e) => onChange({ email: e.target.value })} className="h-9" /></Field>
      </div>
      <Field label="Opening hours"><Textarea value={s.hours ?? ''} onChange={(e) => onChange({ hours: e.target.value })} rows={2} placeholder="Mon–Fri 9–18" /></Field>
      <Field label="Map location (address or place)"><Input value={s.mapQuery ?? ''} onChange={(e) => onChange({ mapQuery: e.target.value })} className="h-9" placeholder="Bahnhofstrasse 1, Zürich" /></Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">Show social links</span>
        <Switch checked={s.showSocial ?? false} onCheckedChange={(v) => onChange({ showSocial: v })} />
      </label>
    </div>
  )
}

function PlacesFields({ s, teamId, onChange }: { s: PlacesSection; teamId: string; onChange: (p: Patch) => void }) {
  const { team } = useAuth()
  const { data: places = [] } = usePlaces(teamId, team?.org_id ?? null)
  const selected = new Set(s.placeIds ?? [])
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ placeIds: Array.from(next) })
  }
  return (
    <div className="space-y-3">
      <Field label="Heading"><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Find us" className="h-9" /></Field>
      <Field label="Subheading"><Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" /></Field>
      <Field label="Columns">
        <Select value={String(s.columns)} onValueChange={(v) => onChange({ columns: Number(v) })}>
          <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="space-y-1.5">
        <Label className="text-xs">Places to show</Label>
        {places.length === 0 ? (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            No places yet — add them under Settings → Places.
          </p>
        ) : (
          <div className="space-y-1">
            {places.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="flex-1 truncate">
                  {p.name}
                  {p.scope === 'org' ? <span className="text-muted-foreground"> · org</span> : null}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── dispatcher ───────────────────────────────────────────────────────────────

export function SectionEditor({
  section, teamId, onChange,
}: {
  section: WebsiteSection
  teamId: string
  onChange: (patch: Patch) => void
}) {
  switch (section.type) {
    case 'hero':     return <HeroFields s={section} teamId={teamId} onChange={onChange} />
    case 'content':
    case 'about':    return <ContentFields s={section} teamId={teamId} onChange={onChange} />
    case 'gallery':  return <GalleryFields s={section} teamId={teamId} onChange={onChange} />
    case 'activities': return <ActivitiesFields s={section} onChange={onChange} />
    case 'pricing':  return <PricingFields s={section} onChange={onChange} />
    case 'schedule': return <ScheduleFields s={section} onChange={onChange} />
    case 'contact':  return <ContactFields s={section} onChange={onChange} />
    case 'places':   return <PlacesFields s={section} teamId={teamId} onChange={onChange} />
    default:         return null
  }
}
