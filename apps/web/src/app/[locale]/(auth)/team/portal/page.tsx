'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm, useFieldArray, Controller, useWatch, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { IconPicker } from '@/components/ui/icon-picker'
import PortalHome from '../../../(portal)/portal/[slug]/PortalHome'
import { toast } from 'sonner'
import { TEAMS_COLLECTION } from '@lineup/shared'
import type { Team, SocialPlatform, BookingSettings } from '@lineup/shared'
import {
  PORTAL_GRADIENTS, SOCIAL_PLATFORMS, SOCIAL_LABELS,
} from '@/lib/portal'
import {
  ExternalLink, Globe, ImageIcon, Plus, Trash2, X,
  Eye, ChevronUp, ChevronDown,
} from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const ACCENT_PRESETS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
]

// ─── form schema ─────────────────────────────────────────────────────────────

const linkSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
  showInPortal: z.boolean(),
  iconName: z.string().optional(),
  isBookingLink: z.boolean().optional(),
  isMembershipLink: z.boolean().optional(),
})

const bookingSchema = z.object({
  flowType:                z.enum(['activity-first', 'date-first']),
  windowMonths:            z.number().int().min(1).max(6),
  showPhone:               z.boolean(),
  showActivityDescription: z.boolean(),
  showFitnessAppField:     z.boolean(),
  ctaUrl:                  z.string().optional(),
  ctaLabel:                z.string().optional(),
})

const schema = z.object({
  portalTheme: z.enum(['light', 'dark', 'auto']),
  accentColor: z.string(),
  bgType: z.enum(['solid', 'gradient']),
  bgColor: z.string(),
  // social — one flat field per platform
  instagram: z.string().optional(),
  facebook:  z.string().optional(),
  youtube:   z.string().optional(),
  tiktok:    z.string().optional(),
  x:         z.string().optional(),
  linkedin:  z.string().optional(),
  whatsapp:  z.string().optional(),
  website:   z.string().optional(),
  review:    z.string().optional(),
  links: z.array(linkSchema),
  booking: bookingSchema,
})

type FormData = z.infer<typeof schema>

// ─── data hook ────────────────────────────────────────────────────────────────

function useTeam(teamId: string | null) {
  return useQuery<Team | null>({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Team) : null
    },
  })
}

// ─── image upload section ─────────────────────────────────────────────────────

function ImageUploadField({
  label, url, onUpload, onRemove, aspectRatio = 'square',
}: {
  label: string
  url: string | null
  onUpload: (file: File) => Promise<void>
  onRemove: () => Promise<void>
  aspectRatio?: 'square' | 'wide'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try { await onUpload(file) } finally { setUploading(false) }
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {url ? (
        <div className={`relative overflow-hidden rounded-lg border bg-muted ${aspectRatio === 'wide' ? 'h-28' : 'h-20 w-20'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={onRemove}
            className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 hover:bg-background transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={`${aspectRatio === 'wide' ? 'w-full h-20' : 'h-20 w-20'} rounded-lg border-2 border-dashed border-input hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 text-xs`}
        >
          <ImageIcon className="h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
    </div>
  )
}

// ─── appearance tab ───────────────────────────────────────────────────────────

function AppearanceTab({
  control,
  register,
  profileImageUrl,
  heroImageUrl,
  onProfileUpload,
  onHeroUpload,
  onProfileRemove,
  onHeroRemove,
}: {
  control: ReturnType<typeof useForm<FormData>>['control']
  register: ReturnType<typeof useForm<FormData>>['register']
  profileImageUrl: string | null
  heroImageUrl: string | null
  onProfileUpload: (f: File) => Promise<void>
  onHeroUpload: (f: File) => Promise<void>
  onProfileRemove: () => Promise<void>
  onHeroRemove: () => Promise<void>
}) {
  const t = useTranslations('TeamPortal')
  const bgType = useWatch({ control, name: 'bgType' })

  return (
    <div className="space-y-6">
      {/* Profile + hero images */}
      <div className="space-y-4">
        <p className="text-sm font-medium">{t('images')}</p>
        <div className="flex gap-4 flex-wrap">
          <ImageUploadField
            label={t('profilePhoto')}
            url={profileImageUrl}
            onUpload={onProfileUpload}
            onRemove={onProfileRemove}
            aspectRatio="square"
          />
          <div className="flex-1 min-w-[180px]">
            <ImageUploadField
              label={t('coverImage')}
              url={heroImageUrl}
              onUpload={onHeroUpload}
              onRemove={onHeroRemove}
              aspectRatio="wide"
            />
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('portalTheme')}</p>
        <Controller
          control={control}
          name="portalTheme"
          render={({ field }) => (
            <div className="flex rounded-lg border overflow-hidden w-fit">
              {(['light', 'dark', 'auto'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => field.onChange(v)}
                  className={`px-4 py-1.5 text-sm transition-colors ${
                    field.value === v
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {t(`theme_${v}` as const)}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      {/* Accent color */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('accentColor')}</p>
        <div className="flex items-center gap-3 flex-wrap">
          {ACCENT_PRESETS.map((c) => (
            <Controller
              key={c}
              control={control}
              name="accentColor"
              render={({ field }) => (
                <button
                  type="button"
                  onClick={() => field.onChange(c)}
                  className="h-7 w-7 rounded-full ring-offset-2 transition-all"
                  style={{
                    background: c,
                    outline: field.value === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2,
                  }}
                />
              )}
            />
          ))}
          <Controller
            control={control}
            name="accentColor"
            render={({ field }) => (
              <input
                type="color"
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                className="h-7 w-7 rounded-full border cursor-pointer bg-background p-0.5"
                title="Custom color"
              />
            )}
          />
        </div>
      </div>

      {/* Background */}
      <div className="space-y-3">
        <p className="text-sm font-medium">{t('background')}</p>
        <Controller
          control={control}
          name="bgType"
          render={({ field }) => (
            <div className="flex rounded-lg border overflow-hidden w-fit">
              {(['solid', 'gradient'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => field.onChange(v)}
                  className={`px-4 py-1.5 text-sm transition-colors ${
                    field.value === v
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {t(`bg_${v}` as const)}
                </button>
              ))}
            </div>
          )}
        />

        {bgType === 'solid' ? (
          <div className="flex items-center gap-3">
            <Controller
              control={control}
              name="bgColor"
              render={({ field }) => (
                <input
                  type="color"
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="h-9 w-16 rounded-md border cursor-pointer bg-background p-1"
                />
              )}
            />
            <Controller
              control={control}
              name="bgColor"
              render={({ field }) => (
                <Input value={field.value} onChange={field.onChange} className="w-32 font-mono text-xs h-8" />
              )}
            />
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <Controller
              control={control}
              name="bgColor"
              render={({ field }) => (
                <>
                  {Object.entries(PORTAL_GRADIENTS).map(([key, g]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => field.onChange(key)}
                      className="h-14 rounded-lg transition-all hover:scale-105"
                      style={{
                        background: g.css,
                        outline: field.value === key ? '2px solid var(--primary)' : '2px solid transparent',
                        outlineOffset: 2,
                      }}
                      title={g.label}
                    />
                  ))}
                </>
              )}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── links tab ────────────────────────────────────────────────────────────────

function LinksTab({
  control,
  register,
  team,
}: {
  control: ReturnType<typeof useForm<FormData>>['control']
  register: ReturnType<typeof useForm<FormData>>['register']
  team: Team
}) {
  const t = useTranslations('TeamPortal')
  const { fields, append, remove, move } = useFieldArray({ control, name: 'links' })

  const bookingIdx    = fields.findIndex((f) => (f as typeof f & { isBookingLink?: boolean }).isBookingLink)
  const membershipIdx = fields.findIndex((f) => (f as typeof f & { isMembershipLink?: boolean }).isMembershipLink)

  return (
    <div className="space-y-6">
      {/* Booking & membership special links */}
      {[
        { idx: bookingIdx,    badge: t('bookingLink') },
        { idx: membershipIdx, badge: t('membershipLink') },
      ]
        .filter(({ idx }) => idx >= 0)
        .map(({ idx, badge }) => (
          <div key={idx} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">{badge}</Badge>
              <Controller
                control={control}
                name={`links.${idx}.showInPortal`}
                render={({ field }) => (
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-muted-foreground">
                    <input type="checkbox" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} className="accent-primary" />
                    {t('showOnPortal')}
                  </label>
                )}
              />
            </div>
            <div className="flex gap-2 items-start">
              <Controller
                control={control}
                name={`links.${idx}.iconName`}
                render={({ field }) => (
                  <IconPicker value={field.value} onChange={field.onChange} />
                )}
              />
              <div className="flex-1 grid grid-cols-2 gap-2">
                <Input {...register(`links.${idx}.label`)} placeholder={t('linkLabel')} className="h-9 text-sm" />
                <Input {...register(`links.${idx}.description`)} placeholder={t('linkDesc')} className="h-9 text-sm" />
              </div>
            </div>
          </div>
        ))}

      {/* Custom links */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t('customLinks')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ label: '', description: '', url: '', showInPortal: true })}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('addLink')}
          </Button>
        </div>

        {fields.filter((_, i) => i !== bookingIdx && i !== membershipIdx).length === 0 && (
          <p className="text-sm text-muted-foreground text-center border border-dashed rounded-lg py-6">
            {t('noCustomLinks')}
          </p>
        )}

        {fields.map((field, i) => {
          if (i === bookingIdx || i === membershipIdx) return null
          return (
            <div key={field.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Controller
                  control={control}
                  name={`links.${i}.showInPortal`}
                  render={({ field: f }) => (
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-muted-foreground">
                      <input type="checkbox" checked={f.value} onChange={(e) => f.onChange(e.target.checked)} className="accent-primary" />
                      {t('showOnPortal')}
                    </label>
                  )}
                />
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === fields.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(i)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex gap-2 items-start">
                <Controller
                  control={control}
                  name={`links.${i}.iconName`}
                  render={({ field: f }) => (
                    <IconPicker value={f.value} onChange={f.onChange} />
                  )}
                />
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input {...register(`links.${i}.label`)} placeholder={t('linkLabel')} className="h-9 text-sm" />
                    <Input {...register(`links.${i}.description`)} placeholder={t('linkDesc')} className="h-9 text-sm" />
                  </div>
                  <Input
                    {...register(`links.${i}.url`)}
                    type="url"
                    placeholder="https://"
                    className="h-9 text-sm font-mono"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── social tab ───────────────────────────────────────────────────────────────

function SocialTab({
  register,
}: {
  register: ReturnType<typeof useForm<FormData>>['register']
}) {
  const t = useTranslations('TeamPortal')

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('socialDesc')}</p>
      {SOCIAL_PLATFORMS.map((platform) => (
        <div key={platform} className="flex items-center gap-3">
          <span className="text-sm font-medium w-24 shrink-0">{SOCIAL_LABELS[platform]}</span>
          <Input
            {...register(platform as keyof FormData)}
            placeholder="https://"
            className="h-8 text-sm font-mono"
          />
        </div>
      ))}
    </div>
  )
}

// ─── booking tab ──────────────────────────────────────────────────────────────

function BookingTab({
  control,
  register,
}: {
  control: ReturnType<typeof useForm<FormData>>['control']
  register: ReturnType<typeof useForm<FormData>>['register']
}) {
  return (
    <div className="space-y-6">
      {/* Flow type */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Booking flow</p>
        <p className="text-xs text-muted-foreground">Choose how visitors browse sessions.</p>
        <Controller
          control={control}
          name="booking.flowType"
          render={({ field }) => (
            <div className="space-y-2">
              {([
                { value: 'activity-first', label: 'Activity-first', desc: 'Visitors pick an activity, then a time slot.' },
                { value: 'date-first',     label: 'Date-first',     desc: 'Visitors pick a date, then an activity.' },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    field.value === opt.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                  }`}
                >
                  <input
                    type="radio"
                    value={opt.value}
                    checked={field.value === opt.value}
                    onChange={() => field.onChange(opt.value)}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        />
      </div>

      {/* Booking window */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Booking window</p>
        <p className="text-xs text-muted-foreground">How far ahead visitors can book sessions.</p>
        <Controller
          control={control}
          name="booking.windowMonths"
          render={({ field }) => (
            <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
              <SelectTrigger className="h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 month</SelectItem>
                <SelectItem value="2">2 months</SelectItem>
                <SelectItem value="3">3 months</SelectItem>
                <SelectItem value="6">6 months</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {/* Toggle helper */}
      {(
        [
          { name: 'booking.showPhone'               as const, label: 'Show phone field',              desc: 'Include an optional phone field in the new guest form.' },
          { name: 'booking.showActivityDescription' as const, label: 'Show activity description',     desc: 'Show the activity description text on the activity selection screen.' },
          { name: 'booking.showFitnessAppField'     as const, label: 'Show fitness app field',        desc: 'Ask new guests which fitness app they\'re coming from (e.g. Fitpass, ClassPass).' },
        ] as const
      ).map(({ name, label, desc }) => (
        <div key={name} className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
          <Controller
            control={control}
            name={name}
            render={({ field }) => (
              <button
                type="button"
                role="switch"
                aria-checked={field.value}
                onClick={() => field.onChange(!field.value)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  field.value ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${
                    field.value ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            )}
          />
        </div>
      ))}

      {/* CTA button */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">CTA button (optional)</p>
          <p className="text-xs text-muted-foreground">
            Shown on the confirmation screen after a successful booking.
          </p>
        </div>
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Button URL</label>
            <Input
              {...register('booking.ctaUrl')}
              type="url"
              placeholder="https://example.com"
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Button label</label>
            <Input
              {...register('booking.ctaLabel')}
              placeholder="e.g. Contact Us"
              className="h-9 text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── booking preview panel ────────────────────────────────────────────────────

const SAMPLE_ACTIVITIES = [
  { name: 'Morning Yoga', color: '#6366f1' },
  { name: 'HIIT Training', color: '#10b981' },
  { name: 'Pilates', color: '#f59e0b' },
]

function gradientForColor(color: string) {
  return `linear-gradient(135deg, ${color}cc, ${color}66)`
}

function BookingPreviewPanel({
  teamName,
  accentColor,
  onBack,
}: {
  teamName: string
  accentColor: string
  onBack: () => void
}) {
  return (
    <div className="min-h-[600px] bg-background text-foreground font-sans">
      {/* Top nav */}
      <div className="border-b bg-card px-5 py-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {teamName}
        </button>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-5 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Book a Session</h1>
          <p className="text-muted-foreground mt-1 text-sm">Choose an activity to get started.</p>
        </div>

        <div className="space-y-3">
          {SAMPLE_ACTIVITIES.map((a) => (
            <div
              key={a.name}
              className="w-full rounded-xl border bg-card flex items-stretch overflow-hidden opacity-80"
            >
              <div
                className="w-20 shrink-0"
                style={{ background: gradientForColor(a.color) }}
              />
              <div className="flex-1 p-4">
                <p className="font-semibold text-sm">{a.name}</p>
                <span className="mt-1 inline-block rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5">
                  Sample activity
                </span>
              </div>
              <div className="flex items-center pr-4 text-muted-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>

        {/* Sticky bar preview */}
        <div
          className="rounded-2xl border p-3 flex items-center gap-3 mt-4"
          style={{ borderColor: `${accentColor}40`, background: `${accentColor}08` }}
        >
          <div
            className="w-12 h-12 rounded-lg shrink-0"
            style={{ background: gradientForColor(accentColor) }}
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">Morning Yoga</p>
            <p className="text-xs text-muted-foreground">Mon 9 Jun · 09:00–10:00</p>
          </div>
          <button
            className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ background: accentColor }}
          >
            Confirm
          </button>
        </div>
        <p className="text-center text-xs text-muted-foreground">↑ Booking summary bar</p>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type Tab = 'appearance' | 'links' | 'social' | 'booking'

export default function TeamPortalEditorPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
  const qc = useQueryClient()
  const t = useTranslations('TeamPortal')

  const [tab, setTab] = useState<Tab>('appearance')
  const [previewPage, setPreviewPage] = useState<'home' | 'booking'>('home')
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null)

  // Initialise image state when team loads
  useEffect(() => {
    if (team) {
      setProfileImageUrl(team.profileImage ?? null)
      setHeroImageUrl(team.heroImage ?? null)
    }
  }, [team?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: getDefaults(team ?? null),
  })

  // Re-populate form when team data arrives
  useEffect(() => {
    if (team) reset(getDefaults(team))
  }, [team?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview values
  const formValues = useWatch({ control })

  // ── image helpers ────────────────────────────────────────────────────────

  async function uploadImage(file: File, path: string): Promise<string> {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const sRef = storageRef(storage, `${path}.${ext}`)
    await uploadBytes(sRef, file)
    return getDownloadURL(sRef)
  }

  async function handleProfileUpload(file: File) {
    if (!currentTeamId) return
    const url = await uploadImage(file, `teams/${currentTeamId}/portal/profile`)
    await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), { profileImage: url })
    setProfileImageUrl(url)
    await qc.invalidateQueries({ queryKey: ['team', currentTeamId] })
  }

  async function handleHeroUpload(file: File) {
    if (!currentTeamId) return
    const url = await uploadImage(file, `teams/${currentTeamId}/portal/hero`)
    await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), { heroImage: url })
    setHeroImageUrl(url)
    await qc.invalidateQueries({ queryKey: ['team', currentTeamId] })
  }

  async function handleProfileRemove() {
    if (!currentTeamId) return
    await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), { profileImage: null })
    setProfileImageUrl(null)
    await qc.invalidateQueries({ queryKey: ['team', currentTeamId] })
  }

  async function handleHeroRemove() {
    if (!currentTeamId) return
    await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), { heroImage: null })
    setHeroImageUrl(null)
    await qc.invalidateQueries({ queryKey: ['team', currentTeamId] })
  }

  // ── save ──────────────────────────────────────────────────────────────────

  async function onSubmit(data: FormData) {
    if (!currentTeamId) return

    const socialLinks = SOCIAL_PLATFORMS
      .filter((p) => (data[p as keyof FormData] as string | undefined))
      .map((p) => ({ platform: p, url: data[p as keyof FormData] as string }))

    const bookingSettings: BookingSettings = {
      flowType:                data.booking.flowType,
      windowMonths:            data.booking.windowMonths,
      showPhone:               data.booking.showPhone,
      showActivityDescription: data.booking.showActivityDescription,
      showFitnessAppField:     data.booking.showFitnessAppField,
      ctaUrl:                  data.booking.ctaUrl || null,
      ctaLabel:                data.booking.ctaLabel || null,
    }

    // Firestore rejects `undefined` values — strip them before any write
    const portalPayload = stripUndefined({
      portalTheme: data.portalTheme,
      portalAccentColor: data.accentColor,
      portalBackground: { type: data.bgType, color: data.bgColor },
      socialLinks,
      links: data.links,
    })

    try {
      // ① Write public_profile first — only needs team-member permission, source of
      //    truth for the public portal. Must succeed.
      const profileRef = doc(db, TEAMS_COLLECTION, currentTeamId, 'public_profile', currentTeamId)
      await setDoc(profileRef, stripUndefined({
        type: 'team',
        slug: team?.slug ?? '',
        name: team?.name ?? '',
        bookingSettings,
        ...portalPayload,
      }), { merge: true })

      // ② Also update the team doc (needs owner role) so the editor form re-hydrates
      //    correctly after reload. Non-fatal: log but don't fail the whole save.
      updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        ...portalPayload,
        'settings.booking': bookingSettings,
      }).catch((err) => {
        console.warn('[portal save] team doc update failed (non-fatal):', err)
      })

      await qc.invalidateQueries({ queryKey: ['team', currentTeamId] })
      toast.success('Portal settings saved')
    } catch (err) {
      console.error('[portal save] failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    }
  }

  function onInvalidForm(errors: FieldErrors<FormData>) {
    toast.error('Some fields have errors — check the form and try again.')
    console.error('[portal save] form validation errors:', JSON.stringify(errors, null, 2))
  }

  // ── preview data ──────────────────────────────────────────────────────────

  const previewTeam = {
    name: team?.name ?? '',
    description: team?.description,
    profileImage: profileImageUrl ?? undefined,
    heroImage: heroImageUrl ?? undefined,
    portalTheme: formValues.portalTheme,
    portalAccentColor: formValues.accentColor,
    portalBackground: formValues.bgType
      ? { type: formValues.bgType as 'solid' | 'gradient', color: formValues.bgColor ?? '' }
      : undefined,
    socialLinks: SOCIAL_PLATFORMS
      .filter((p) => (formValues[p as keyof FormData] as string | undefined))
      .map((p) => ({ platform: p, url: formValues[p as keyof FormData] as string })),
    links: formValues.links as typeof team extends null ? undefined : Team['links'],
  }

  // ── loading / no team ─────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  if (!team || !currentTeamId) {
    return <p className="text-muted-foreground">{t('noTeam')}</p>
  }

  if (!team.slug) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <div className="rounded-xl border bg-muted/30 p-10 text-center space-y-2">
          <Globe className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="font-medium">{t('noSlugTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('noSlugDesc')}</p>
          <a href="../settings" className="text-sm text-primary hover:underline">
            {t('goToSettings')} →
          </a>
        </div>
      </div>
    )
  }

  const portalUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/portal/${team.slug}`
    : `/portal/${team.slug}`

  const tabs: { key: Tab; label: string }[] = [
    { key: 'appearance', label: t('tabAppearance') },
    { key: 'links',      label: t('tabLinks') },
    { key: 'social',     label: t('tabSocial') },
    { key: 'booking',    label: 'Booking' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1 mt-0.5"
          >
            {portalUrl.replace(/^https?:\/\//, '')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Button onClick={handleSubmit(onSubmit, onInvalidForm)} disabled={isSubmitting}>
          {isSubmitting ? t('saving') : t('save')}
        </Button>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">

        {/* ── Left: settings ── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Tabs */}
          <div className="flex gap-0 border-b">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setPreviewPage(key === 'booking' ? 'booking' : 'home') }}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === key
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit, onInvalidForm)}>
            {tab === 'appearance' && (
              <AppearanceTab
                control={control}
                register={register}
                profileImageUrl={profileImageUrl}
                heroImageUrl={heroImageUrl}
                onProfileUpload={handleProfileUpload}
                onHeroUpload={handleHeroUpload}
                onProfileRemove={handleProfileRemove}
                onHeroRemove={handleHeroRemove}
              />
            )}
            {tab === 'links' && (
              <LinksTab control={control} register={register} team={team} />
            )}
            {tab === 'social' && (
              <SocialTab register={register} />
            )}
            {tab === 'booking' && (
              <BookingTab control={control} register={register} />
            )}
          </form>
        </div>

        {/* ── Right: sticky preview ── */}
        <div className="lg:w-[400px] lg:flex-shrink-0 lg:sticky lg:top-6 lg:self-start space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Eye className="h-3.5 w-3.5" />
              {t('preview')}
            </div>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              {t('openPortal')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="rounded-xl border overflow-hidden max-h-[calc(100vh-12rem)] overflow-y-auto shadow-sm">
            {previewPage === 'booking' ? (
              <BookingPreviewPanel
                teamName={team.name}
                accentColor={formValues.accentColor ?? '#6366f1'}
                onBack={() => setPreviewPage('home')}
              />
            ) : (
              <PortalHome
                team={previewTeam}
                slug={team.slug}
                onLinkClick={(type) => {
                  if (type === 'booking') setPreviewPage('booking')
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Recursively removes `undefined` values so Firestore never sees them. */
function stripUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

function getDefaults(team: Team | null): FormData {
  const sl = team?.socialLinks ?? []
  const getSocial = (p: SocialPlatform) => sl.find((s) => s.platform === p)?.url ?? ''

  // Cast through unknown so TS allows us to read possibly-missing sub-keys
  const rawBooking = ((team?.settings as Record<string, unknown> | undefined)?.booking ?? {}) as Record<string, unknown>

  // Coerce windowMonths to a valid integer (Firestore can return floats or strings)
  const rawMonths = Number(rawBooking.windowMonths)
  const windowMonths = Number.isInteger(rawMonths) && rawMonths >= 1 && rawMonths <= 6 ? rawMonths : 2

  const flowType = rawBooking.flowType === 'date-first' ? 'date-first' : 'activity-first'

  return {
    portalTheme: (['light', 'dark', 'auto'] as const).includes(team?.portalTheme as never)
      ? (team!.portalTheme as FormData['portalTheme'])
      : 'light',
    accentColor: typeof team?.portalAccentColor === 'string' ? team.portalAccentColor : '#6366f1',
    bgType: team?.portalBackground?.type === 'gradient' ? 'gradient' : 'solid',
    bgColor: typeof team?.portalBackground?.color === 'string' ? team.portalBackground.color : '#ffffff',
    instagram: getSocial('instagram'),
    facebook:  getSocial('facebook'),
    youtube:   getSocial('youtube'),
    tiktok:    getSocial('tiktok'),
    x:         getSocial('x'),
    linkedin:  getSocial('linkedin'),
    whatsapp:  getSocial('whatsapp'),
    website:   getSocial('website'),
    review:    getSocial('review'),
    // Sanitize each link to ensure all required fields are valid for the schema
    links: (team?.links ?? []).map((l) => ({
      label:          typeof l.label === 'string' ? l.label : '',
      description:    typeof l.description === 'string' ? l.description : undefined,
      url:            typeof l.url === 'string' ? l.url : '',
      showInPortal:   l.showInPortal === true || l.showInPortal === false ? l.showInPortal : false,
      iconName:       typeof l.iconName === 'string' ? l.iconName : undefined,
      isBookingLink:  l.isBookingLink === true ? true : undefined,
      isMembershipLink: l.isMembershipLink === true ? true : undefined,
    })),
    booking: {
      flowType,
      windowMonths,
      showPhone:               rawBooking.showPhone               !== false,
      showActivityDescription: rawBooking.showActivityDescription !== false,
      showFitnessAppField:     rawBooking.showFitnessAppField     === true,
      ctaUrl:                  typeof rawBooking.ctaUrl  === 'string' ? rawBooking.ctaUrl  : '',
      ctaLabel:                typeof rawBooking.ctaLabel === 'string' ? rawBooking.ctaLabel : '',
    },
  }
}
