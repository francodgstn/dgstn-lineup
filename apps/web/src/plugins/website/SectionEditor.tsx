'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
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

/**
 * The image box, filled or empty — ONE definition, so the form does not move
 * when a picture arrives.
 *
 * TWO THINGS WERE WRONG. The wide variant was `h-28 w-full`: a fixed 112px tall
 * band stretched across whatever the column happened to be, which after the
 * preview pane moved into an overlay is roughly 5:1 — a letterbox that shows
 * almost nothing of a photograph and looks broken beside the fields around it.
 * And the empty state was `h-20` against the filled `h-28`, so uploading an
 * image shifted every field below it down by 32px.
 *
 * `aspect-video` because that is what these images ARE — a hero background and a
 * section side image both publish wide — and a width cap so the box sits inline
 * with the inputs above it rather than spanning the panel.
 */
const BOX = {
  wide: 'aspect-video w-full max-w-xs',
  square: 'aspect-square w-20',
} as const

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
  const t = useTranslations('Website')
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > limits.maxImageSizeMB * 1024 * 1024) {
      toast.error(t('editorImageTooLarge', { mb: limits.maxImageSizeMB }))
      return
    }
    setUploading(true)
    try {
      const u = await uploadSiteImage(teamId, sectionId, file)
      onChange(u)
    } catch {
      toast.error(t('editorUploadFailed'))
    } finally {
      setUploading(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <Field label={label}>
      {url ? (
        <div className={`relative overflow-hidden rounded-lg border bg-muted ${BOX[aspect]}`}>
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
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50 ${BOX[aspect]}`}
        >
          <ImageIcon className="h-4 w-4" />
          {uploading ? t('editorUploading') : t('editorUpload')}
        </button>
      )}
      <input ref={ref} type="file" accept="image/*" onChange={handle} className="hidden" />
    </Field>
  )
}

// ─── CTA editor ──────────────────────────────────────────────────────────────

function CtaEditor({ cta, onChange }: { cta?: SiteCta; onChange: (cta: SiteCta | undefined) => void }) {
  const t = useTranslations('Website')
  const value = cta ?? { label: '', action: 'booking' as const }
  const set = (patch: Partial<SiteCta>) => {
    const next = { ...value, ...patch }
    onChange(next.label ? next : undefined)
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">{t('editorCtaTitle')}</p>
      <Field label={t('editorCtaLabel')}>
        <Input value={value.label} onChange={(e) => set({ label: e.target.value })} placeholder={t('editorCtaLabelPlaceholder')} className="h-9" />
      </Field>
      <Field label={t('editorCtaAction')}>
        <Select value={value.action} onValueChange={(v) => set({ action: v as SiteCta['action'] })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="booking">{t('editorCtaActionBooking')}</SelectItem>
            <SelectItem value="signup">{t('editorCtaActionSignup')}</SelectItem>
            <SelectItem value="url">{t('editorCtaActionUrl')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {value.action === 'url' && (
        <Field label={t('editorCtaUrl')}>
          <Input value={value.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://" className="h-9 font-mono text-xs" />
        </Field>
      )}
    </div>
  )
}

// ─── per-type editors ─────────────────────────────────────────────────────────

type Patch = Record<string, unknown>

function HeroFields({ s, teamId, onChange }: { s: HeroSection; teamId: string; onChange: (p: Patch) => void }) {
  const t = useTranslations('Website')
  return (
    <div className="space-y-3">
      <Field label={t('editorHeadline')}>
        <Input value={s.headline} onChange={(e) => onChange({ headline: e.target.value })} className="h-9" />
      </Field>
      <Field label={t('editorSubheadline')}>
        <Textarea value={s.subheadline ?? ''} onChange={(e) => onChange({ subheadline: e.target.value })} rows={2} />
      </Field>
      <ImageField label={t('editorBackgroundImage')} url={s.bgImageUrl} teamId={teamId} sectionId={s.id} onChange={(u) => onChange({ bgImageUrl: u })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('editorAlignment')}>
          <Select value={s.align} onValueChange={(v) => onChange({ align: v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="center">{t('editorCenter')}</SelectItem>
              <SelectItem value="left">{t('editorLeft')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('editorOverlay', { percent: s.overlay ?? 40 })}>
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
  const t = useTranslations('Website')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const handleBody = useCallback((html: string) => onChangeRef.current({ body: html }), [])
  const handleUpload = useCallback((file: File) => uploadSiteImage(teamId, s.id, file), [teamId, s.id])

  return (
    <div className="space-y-3">
      <Field label={t('editorTitleOptional')}>
        <Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} className="h-9" />
      </Field>
      <Field label={t('editorContent')}>
        <RichTextEditor
          key={s.id}
          value={s.body}
          onChange={handleBody}
          onUploadImage={handleUpload}
          minHeight={240}
          placeholder={t('editorContentPlaceholder')}
        />
      </Field>
      <ImageField label={t('editorImageOptional')} url={s.imageUrl} teamId={teamId} sectionId={s.id} onChange={(u) => onChange({ imageUrl: u })} />
      {s.imageUrl && (
        <Field label={t('editorImageSide')}>
          <Select value={s.imageSide} onValueChange={(v) => onChange({ imageSide: v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">{t('editorLeft')}</SelectItem>
              <SelectItem value="right">{t('editorRight')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  )
}

function GalleryFields({ s, teamId, onChange }: { s: GallerySection; teamId: string; onChange: (p: Patch) => void }) {
  const t = useTranslations('Website')
  const addRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function addImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (s.images.length >= limits.maxGalleryImages) {
      toast.error(t('editorGalleryLimit', { count: limits.maxGalleryImages }))
      return
    }
    if (file.size > limits.maxImageSizeMB * 1024 * 1024) {
      toast.error(t('editorImageTooLarge', { mb: limits.maxImageSizeMB }))
      return
    }
    setUploading(true)
    try {
      const url = await uploadSiteImage(teamId, s.id, file)
      onChange({ images: [...s.images, { url }] })
    } catch {
      toast.error(t('editorUploadFailed'))
    } finally {
      setUploading(false)
      if (addRef.current) addRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <Field label={t('editorHeadingOptional')}>
        <Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} className="h-9" />
      </Field>
      <Field label={t('editorColumns')}>
        <Select value={String(s.columns)} onValueChange={(v) => onChange({ columns: Number(v) })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('editorPhotos', { count: s.images.length, max: limits.maxGalleryImages })}>
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
            {uploading ? '…' : t('editorAdd')}
          </button>
        </div>
        <input ref={addRef} type="file" accept="image/*" onChange={addImage} className="hidden" />
      </Field>
    </div>
  )
}

function ActivitiesFields({ s, onChange }: { s: ActivitiesSection; onChange: (p: Patch) => void }) {
  const t = useTranslations('Website')
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        {t('editorActivitiesNote')}
      </p>
      <Field label={t('editorHeading')}><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder={t('editorActivitiesHeadingPlaceholder')} className="h-9" /></Field>
      <Field label={t('editorSubheading')}><Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" /></Field>
      <Field label={t('editorLayout')}>
        <Select
          value={s.layout ?? 'grid'}
          onValueChange={(v) => onChange({ layout: v as ActivitiesSection['layout'] })}
        >
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="grid">{t('editorLayoutGrid')}</SelectItem>
            <SelectItem value="list">{t('editorLayoutList')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {/* A stacked list is always one per row — the column count is meaningless
          there. Hidden rather than reset, so switching back to grid restores
          whatever the studio had picked. */}
      {(s.layout ?? 'grid') === 'grid' && (
        <Field label={t('editorColumns')}>
          <Select value={String(s.columns)} onValueChange={(v) => onChange({ columns: Number(v) })}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label={t('fieldPricingDisplay')}>
        <Select
          value={s.pricingDisplay ?? 'list'}
          onValueChange={(v) => onChange({ pricingDisplay: v as ActivitiesSection['pricingDisplay'] })}
        >
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="list">{t('pricingDisplayList')}</SelectItem>
            <SelectItem value="compact">{t('pricingDisplayCompact')}</SelectItem>
            <SelectItem value="hidden">{t('pricingDisplayHidden')}</SelectItem>
          </SelectContent>
        </Select>
        {/* Said on the control, not in a doc comment: a studio picking "Hidden"
            is entitled to know what it does NOT hide, so it doesn't go looking
            for the bug. */}
        <p className="text-xs text-muted-foreground">{t('pricingDisplayHint')}</p>
      </Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">{t('editorShowBookingOnCards')}</span>
        <Switch checked={s.showBooking ?? false} onCheckedChange={(v) => onChange({ showBooking: v })} />
      </label>
    </div>
  )
}

function PricingFields({ s, onChange }: { s: PricingSection; onChange: (p: Patch) => void }) {
  const t = useTranslations('Website')
  return (
    <div className="space-y-3">
      {/* The destination moved with the copy: these cards read the SUBSCRIPTION
          PLANS, which live on the Plans page — the old line still sent studios to
          "Contacts → membership types", a path that has not existed for two
          reorganisations. */}
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        {t('editorPricingNote')}
      </p>
      <Field label={t('editorHeading')}><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder={t('editorPricingHeadingPlaceholder')} className="h-9" /></Field>
      <Field label={t('editorSubheading')}><Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" /></Field>
      <Field label={t('editorCtaLabel')}><Input value={s.ctaLabel ?? ''} onChange={(e) => onChange({ ctaLabel: e.target.value })} placeholder={t('editorPricingCtaPlaceholder')} className="h-9" /></Field>
      <Field label={t('fieldPricingLayout')}>
        <Select
          value={s.layout ?? 'cards'}
          onValueChange={(v) => onChange({ layout: v as PricingSection['layout'] })}
        >
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cards">{t('pricingLayoutCards')}</SelectItem>
            <SelectItem value="table">{t('pricingLayoutTable')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('pricingLayoutHint')}</p>
      </Field>
    </div>
  )
}

function ScheduleFields({ s, onChange }: { s: ScheduleSection; onChange: (p: Patch) => void }) {
  const t = useTranslations('Website')
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        {t('editorScheduleNote')}
      </p>
      <Field label={t('editorHeading')}><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder={t('editorScheduleHeadingPlaceholder')} className="h-9" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('editorDaysAhead')}>
          <Select value={String(s.windowDays ?? 7)} onValueChange={(v) => onChange({ windowDays: Number(v) })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t('editorDaysOption', { count: 7 })}</SelectItem>
              <SelectItem value="14">{t('editorDaysOption', { count: 14 })}</SelectItem>
              <SelectItem value="30">{t('editorDaysOption', { count: 30 })}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('editorMaxClasses')}>
          {/* 0 = no cap. Keeps a busy schedule from listing dozens of rows. */}
          <Select value={String(s.maxItems ?? 0)} onValueChange={(v) => onChange({ maxItems: Number(v) || undefined })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('editorNoLimit')}</SelectItem>
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
      <Field label={t('editorDefaultView')}>
        {/* Visitors can still switch List ↔ Calendar on the live site; this sets the default. */}
        <Select value={s.displayMode ?? 'calendar'} onValueChange={(v) => onChange({ displayMode: v as ScheduleSection['displayMode'] })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="list">{t('editorViewList')}</SelectItem>
            <SelectItem value="calendar">{t('editorViewCalendar')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">{t('editorShowBookingOnSessions')}</span>
        <Switch checked={s.showBooking ?? false} onCheckedChange={(v) => onChange({ showBooking: v })} />
      </label>
    </div>
  )
}

function ContactFields({ s, onChange }: { s: ContactSection; onChange: (p: Patch) => void }) {
  const t = useTranslations('Website')
  return (
    <div className="space-y-3">
      <Field label={t('editorHeading')}><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder={t('editorContactHeadingPlaceholder')} className="h-9" /></Field>
      <Field label={t('editorAddress')}><Textarea value={s.address ?? ''} onChange={(e) => onChange({ address: e.target.value })} rows={2} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('editorPhone')}><Input value={s.phone ?? ''} onChange={(e) => onChange({ phone: e.target.value })} className="h-9" /></Field>
        <Field label={t('editorEmail')}><Input value={s.email ?? ''} onChange={(e) => onChange({ email: e.target.value })} className="h-9" /></Field>
      </div>
      <Field label={t('editorHours')}><Textarea value={s.hours ?? ''} onChange={(e) => onChange({ hours: e.target.value })} rows={2} placeholder={t('editorHoursPlaceholder')} /></Field>
      {/* The map placeholder stays a REAL Swiss address rather than becoming
          "Street 1, City": it is an example of the format the lookup wants, and a
          translated abstraction stops showing that. */}
      <Field label={t('editorMapLocation')}><Input value={s.mapQuery ?? ''} onChange={(e) => onChange({ mapQuery: e.target.value })} className="h-9" placeholder={t('editorMapPlaceholder')} /></Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">{t('editorShowSocial')}</span>
        <Switch checked={s.showSocial ?? false} onCheckedChange={(v) => onChange({ showSocial: v })} />
      </label>
    </div>
  )
}

function PlacesFields({ s, teamId, onChange }: { s: PlacesSection; teamId: string; onChange: (p: Patch) => void }) {
  const t = useTranslations('Website')
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
      <Field label={t('editorHeading')}><Input value={s.heading ?? ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder={t('editorPlacesHeadingPlaceholder')} className="h-9" /></Field>
      <Field label={t('editorSubheading')}><Input value={s.subheading ?? ''} onChange={(e) => onChange({ subheading: e.target.value })} className="h-9" /></Field>
      <Field label={t('editorColumns')}>
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
        <Label className="text-xs">{t('editorPlacesToShow')}</Label>
        {places.length === 0 ? (
          /* Places moved to the Schedule section (UX-67); the old copy still sent
             studios to Settings. */
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            {t('editorNoPlaces')}
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
                  {p.scope === 'org' ? (
                    <span className="text-muted-foreground"> · {t('editorPlaceOrgScope')}</span>
                  ) : null}
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
