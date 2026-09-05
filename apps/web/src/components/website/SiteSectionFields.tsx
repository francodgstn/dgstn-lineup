'use client'

/**
 * THE SECTION FIELD EDITORS BOTH SITE BUILDERS SHARE.
 *
 * A studio's website and an organisation's are authored by two components —
 * `plugins/website/SectionEditor.tsx` and `org/[orgId]/website/OrgSectionEditor.tsx`
 * — and four of their section types are literally the same type: `HeroSection`,
 * `ContentSection`, `GallerySection` and `ContactSection` are declared once in
 * `@linyup/shared` and admitted by both unions. The render layer, the type layer
 * and the sanitiser were shared already; only the authoring SHELL was copied,
 * and a copy drifts.
 *
 * It had drifted, in ways that were invisible until the two were read side by
 * side (all three fixed by this move):
 *
 *   • The org copy was missing translations the team copy had — `Center`,
 *     `Left`, `Right`, `Overlay (40%)` and "Call-to-action button" were
 *     hardcoded English in a file whose every other label went through
 *     `useTranslations`. A German org admin authored their site half in English.
 *   • Its image-size limit was a bare `const MAX_IMAGE_SIZE_MB = 5` where the
 *     team's goes through `getWebsiteLimits()`, the seam that exists so an
 *     operator can raise it. Same number today, one of them unreachable.
 *   • `ContactFields` was identical in behaviour and different in whitespace,
 *     which is the state a copy reaches just before someone edits one of them.
 *
 * ── THE DISCRIMINATOR CARRIES BEHAVIOUR, NOT A LABEL ────────────────────────
 * `SiteEditorTenant.kind` exists for anything that must branch on which tenant
 * is authoring — but the thing that actually differs between them is WHERE AN
 * IMAGE GOES, so the tenant carries its own `uploadImage` rather than this
 * module importing both upload helpers and switching on the enum. That also
 * keeps a shared component from importing out of an app route.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
 * The sections only one tenant has: Activities, Pricing, Schedule and Places are
 * team-scoped commerce, and Clubs, Locations and Coaches are org aggregates.
 * Neither set belongs in the other's union, so neither belongs here.
 *
 * The HERO'S CALL TO ACTION is a SLOT for the same reason. A studio's can point
 * at its booking page or its signup form; an organisation has neither surface,
 * so its CTA is a plain URL. That is a real difference in what the tenants CAN
 * do, not drift, so each builder passes its own control in.
 */

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
  HeroSection, ContentSection, GallerySection, ContactSection,
} from '@linyup/shared'
import { RichTextEditor } from '@/components/RichTextEditor'
import { getWebsiteLimits } from '@/plugins/website/limits'

const limits = getWebsiteLimits()

export type Patch = Record<string, unknown>

/** Who is authoring, and the one thing that differs between them. */
export interface SiteEditorTenant {
  kind: 'team' | 'org'
  id: string
  /** Where an image uploaded from this editor is stored. */
  uploadImage: (sectionId: string, file: File) => Promise<string>
}

// ─── small field helper ─────────────────────────────────────────────────────

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
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

export function ImageField({
  label, url, tenant, sectionId, onChange, aspect = 'wide',
}: {
  label: string
  url?: string
  tenant: SiteEditorTenant
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
      const u = await tenant.uploadImage(sectionId, file)
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

// ─── the four shared section types ──────────────────────────────────────────

export function HeroFields({
  s, tenant, onChange, cta,
}: {
  s: HeroSection
  tenant: SiteEditorTenant
  onChange: (p: Patch) => void
  /** The tenant's own call-to-action control — see the note at the top. */
  cta: React.ReactNode
}) {
  const t = useTranslations('Website')
  return (
    <div className="space-y-3">
      <Field label={t('editorHeadline')}>
        <Input value={s.headline} onChange={(e) => onChange({ headline: e.target.value })} className="h-9" />
      </Field>
      <Field label={t('editorSubheadline')}>
        <Textarea value={s.subheadline ?? ''} onChange={(e) => onChange({ subheadline: e.target.value })} rows={2} />
      </Field>
      <ImageField label={t('editorBackgroundImage')} url={s.bgImageUrl} tenant={tenant} sectionId={s.id} onChange={(u) => onChange({ bgImageUrl: u })} />
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
      {cta}
    </div>
  )
}

export function ContentFields({
  s, tenant, onChange,
}: {
  s: ContentSection
  tenant: SiteEditorTenant
  onChange: (p: Patch) => void
}) {
  // RichTextEditor is uncontrolled after mount and memoized: pass STABLE
  // callbacks (latest onChange via a ref) so typing never re-mounts it, and key
  // it by section id so switching sections loads the right body.
  const t = useTranslations('Website')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const handleBody = useCallback((html: string) => onChangeRef.current({ body: html }), [])
  const upload = tenant.uploadImage
  const handleUpload = useCallback((file: File) => upload(s.id, file), [upload, s.id])

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
      <ImageField label={t('editorImageOptional')} url={s.imageUrl} tenant={tenant} sectionId={s.id} onChange={(u) => onChange({ imageUrl: u })} />
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

export function GalleryFields({
  s, tenant, onChange,
}: {
  s: GallerySection
  tenant: SiteEditorTenant
  onChange: (p: Patch) => void
}) {
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
      const url = await tenant.uploadImage(s.id, file)
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

export function ContactFields({ s, onChange }: { s: ContactSection; onChange: (p: Patch) => void }) {
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
      {/* Both tenants can show social links now. The org's switch was removed on
          2026-08-28 because `Organization` had no such field and nothing could
          set any — then put back the same day with the field, an editor in
          Organisation settings, and `publishOrgWebsite` (which had been reading
          `org.socialLinks` defensively all along) finally having something to
          read. */}
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm">{t('editorShowSocial')}</span>
        <Switch checked={s.showSocial ?? false} onCheckedChange={(v) => onChange({ showSocial: v })} />
      </label>
    </div>
  )
}
