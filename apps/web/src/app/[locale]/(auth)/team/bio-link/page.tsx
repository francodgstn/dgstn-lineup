'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useSaveShortcut } from '@/hooks/useSaveShortcut'
import { useForm, useFieldArray, Controller, useWatch, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { IconPicker, DynamicIcon } from '@/components/ui/icon-picker'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import BioLinkHome from '../../../(public)/public/[slug]/BioLinkHome'
import { toast } from 'sonner'
import { TEAMS_COLLECTION, SYSTEM_LINK_META, resolveSystemLinkTarget } from '@linyup/shared'
import type { Team, SocialPlatform, SystemLinkTarget } from '@linyup/shared'
import { BIO_LINK_GRADIENTS, SOCIAL_PLATFORMS, SOCIAL_LABELS } from '@/lib/bioLink'
import {
  ExternalLink,
  Globe,
  ImageIcon,
  Plus,
  Pencil,
  Trash2,
  X,
  Eye,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'

// ─── constants ────────────────────────────────────────────────────────────────

const ACCENT_PRESETS = [
  '#6366f1',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
]

// ─── form schema ─────────────────────────────────────────────────────────────

// Accepts an empty string (no URL) or a valid https:// / http:// URL.
// Rejects javascript:, data:, and other dangerous protocols (stored XSS prevention).
const safeUrl = z
  .string()
  .refine((v) => v === '' || /^https?:\/\/.+/.test(v), 'Must be a valid https:// URL')
  .optional()

const linkSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  url: safeUrl,
  showInBioLink: z.boolean(),
  iconName: z.string().optional(),
  // Set → this is a "page link" to one of the team's public surfaces.
  target: z
    .enum(['booking', 'signup', 'shop', 'shop-memberships', 'shop-products', 'shop-courses', 'space', 'site'])
    .optional(),
})

const schema = z.object({
  bioLinkTheme: z.enum(['light', 'dark', 'auto']),
  accentColor: z.string(),
  bgType: z.enum(['solid', 'gradient']),
  bgColor: z.string(),
  // social — one flat field per platform
  instagram: z.string().optional(),
  facebook: z.string().optional(),
  youtube: z.string().optional(),
  tiktok: z.string().optional(),
  x: z.string().optional(),
  linkedin: z.string().optional(),
  whatsapp: z.string().optional(),
  website: z.string().optional(),
  review: z.string().optional(),
  links: z.array(linkSchema),
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
  label,
  url,
  onUpload,
  onRemove,
  aspectRatio = 'square',
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
    try {
      await onUpload(file)
    } finally {
      setUploading(false)
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {url ? (
        <div
          className={`relative overflow-hidden rounded-lg border bg-muted ${aspectRatio === 'wide' ? 'h-28' : 'h-20 w-20'}`}
        >
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
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
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
  const t = useTranslations('BioLink')
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
        <p className="text-sm font-medium">{t('bioLinkTheme')}</p>
        <Controller
          control={control}
          name="bioLinkTheme"
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
                <Input
                  value={field.value}
                  onChange={field.onChange}
                  className="w-32 font-mono text-xs h-8"
                />
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
                  {Object.entries(BIO_LINK_GRADIENTS).map(([key, g]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => field.onChange(key)}
                      className="h-14 rounded-lg transition-all hover:scale-105"
                      style={{
                        background: g.css,
                        outline:
                          field.value === key
                            ? '2px solid var(--primary)'
                            : '2px solid transparent',
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

// Display label for a page-link target (badge + Add-menu item + chip).
function useTargetLabel() {
  const t = useTranslations('BioLink')
  const KEYS: Record<SystemLinkTarget, Parameters<typeof t>[0]> = {
    booking: 'bookingLink',
    signup: 'membershipLink',
    shop: 'shopLink',
    'shop-memberships': 'membershipsLink',
    'shop-products': 'productsLink',
    'shop-courses': 'shopCoursesLink',
    space: 'coursesLink',
    site: 'siteLink',
  }
  return (target: SystemLinkTarget): string => t(KEYS[target])
}

function LinksTab({
  control,
  register,
  availableTargets,
}: {
  control: ReturnType<typeof useForm<FormData>>['control']
  register: ReturnType<typeof useForm<FormData>>['register']
  availableTargets: SystemLinkTarget[]
}) {
  const t = useTranslations('BioLink')
  const targetLabel = useTargetLabel()
  const { fields, append, remove, move } = useFieldArray({ control, name: 'links' })
  // Live values for the collapsed card headers — useFieldArray `fields` is a snapshot.
  const watched = useWatch({ control, name: 'links' })

  // Which link card is expanded; a newly-added link auto-expands.
  const [openId, setOpenId] = useState<string | null>(null)
  const wantOpenLast = useRef(false)
  useEffect(() => {
    if (wantOpenLast.current && fields.length > 0) {
      setOpenId(fields[fields.length - 1].id)
      wantOpenLast.current = false
    }
  }, [fields.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Page links (booking, signup, shop, courses, website) and custom links share ONE
  // list so they can be reordered freely. Page links carry a badge and have no URL
  // field; both kinds are added via the "Add link" placeholder menu below.
  const usedTargets = new Set(
    (fields as Array<{ target?: SystemLinkTarget }>).map((f) => f.target).filter(Boolean)
  )
  const addableTargets = availableTargets.filter((tgt) => !usedTargets.has(tgt))

  function addPageLink(target: SystemLinkTarget) {
    wantOpenLast.current = true
    append({
      label: targetLabel(target),
      description: '',
      url: '',
      showInBioLink: true,
      iconName: SYSTEM_LINK_META[target].defaultIcon,
      target,
    })
  }

  function addCustomLink() {
    wantOpenLast.current = true
    append({ label: '', description: '', url: '', showInBioLink: true })
  }

  return (
    <div className="space-y-2.5">
      {fields.map((field, i) => {
        const f = field as typeof field & { target?: SystemLinkTarget }
        const wl = watched?.[i] as Partial<FormData['links'][number]> | undefined
        const systemBadge = f.target ? targetLabel(f.target) : null
        const isSystem = systemBadge !== null
        const iconName =
          (wl?.iconName as string | undefined) ||
          (f.target ? SYSTEM_LINK_META[f.target].defaultIcon : 'Link2')
        const open = openId === field.id
        const displayLabel =
          (wl?.label as string | undefined) || (isSystem ? systemBadge! : t('addCustomLink'))
        return (
          <div key={field.id} className="rounded-lg border">
            {/* Card header — mirrors the website builder section card */}
            <div className="flex items-center gap-2 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <DynamicIcon name={iconName} className="h-4 w-4" />
              </span>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : field.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{displayLabel}</span>
                  {isSystem && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {systemBadge}
                    </Badge>
                  )}
                </div>
                {!isSystem && (
                  <p className="truncate text-xs text-muted-foreground">
                    {(wl?.url as string | undefined) || 'https://'}
                  </p>
                )}
              </button>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  className="rounded p-1 hover:bg-muted disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === fields.length - 1}
                  className="rounded p-1 hover:bg-muted disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : field.id)}
                  className="rounded p-1 hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (open) setOpenId(null)
                    remove(i)
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Collapsible body */}
            {open && (
              <div className="space-y-3 border-t p-3">
                <div className="flex gap-2 items-start">
                  <Controller
                    control={control}
                    name={`links.${i}.iconName`}
                    render={({ field: cf }) => <IconPicker value={cf.value} onChange={cf.onChange} />}
                  />
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        {...register(`links.${i}.label`)}
                        placeholder={t('linkLabel')}
                        className="h-9 text-sm"
                      />
                      <Input
                        {...register(`links.${i}.description`)}
                        placeholder={t('linkDesc')}
                        className="h-9 text-sm"
                      />
                    </div>
                    {!isSystem && (
                      <Input
                        {...register(`links.${i}.url`)}
                        type="url"
                        placeholder="https://"
                        className="h-9 text-sm font-mono"
                      />
                    )}
                  </div>
                </div>
                <Controller
                  control={control}
                  name={`links.${i}.showInBioLink`}
                  render={({ field: cf }) => (
                    <label className="flex items-center justify-between rounded-lg border p-3">
                      <span className="text-sm">{t('showOnBioLink')}</span>
                      <Switch checked={cf.value} onCheckedChange={(v) => cf.onChange(v)} />
                    </label>
                  )}
                />
              </div>
            )}
          </div>
        )
      })}

      {/* Add link — dashed placeholder mirrors the website builder's "Add section" */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input py-3 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground">
          <Plus className="h-4 w-4" />
          {t('addLink')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onClick={addCustomLink} className="gap-2">
            <DynamicIcon name="Link2" className="h-4 w-4 text-muted-foreground" />
            {t('addCustomLink')}
          </DropdownMenuItem>
          {addableTargets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t('addPageLink')}
                </DropdownMenuLabel>
                {addableTargets.map((tgt) => (
                  <DropdownMenuItem key={tgt} onClick={() => addPageLink(tgt)} className="gap-2">
                    <DynamicIcon
                      name={SYSTEM_LINK_META[tgt].defaultIcon}
                      className="h-4 w-4 text-muted-foreground"
                    />
                    {targetLabel(tgt)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─── social tab ───────────────────────────────────────────────────────────────

function SocialTab({ register }: { register: ReturnType<typeof useForm<FormData>>['register'] }) {
  const t = useTranslations('BioLink')

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

// ─── page ─────────────────────────────────────────────────────────────────────

type Tab = 'appearance' | 'links' | 'social'

export default function TeamBioLinkEditorPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
  const { isInstalled } = useInstalledPlugins()
  const coursesActive = isInstalled('online-courses')
  const connectEnabled = team?.payments?.connectStatus === 'enabled'

  // Page-link surfaces this team can offer (before subtracting already-added). The
  // generic `shop` target stays valid for back-compat but isn't suggested — the three
  // shop sections (memberships/products/courses) deep-link the relevant tab instead.
  // booking/signup are base features; the rest follow their plugin / Connect state.
  const productsActive = isInstalled('products')
  const websiteActive = isInstalled('website')
  const offeredTargets: SystemLinkTarget[] = [
    'booking',
    'signup',
    'shop-memberships',
    'shop-products',
    'shop-courses',
    'space',
    'site',
  ]
  const availableTargets = offeredTargets.filter((tgt) => {
    if (tgt === 'shop-memberships') return connectEnabled
    if (tgt === 'shop-products') return productsActive
    if (tgt === 'shop-courses') return coursesActive
    if (tgt === 'space') return coursesActive
    if (tgt === 'site') return websiteActive
    return true // booking, signup
  })
  const qc = useQueryClient()
  const t = useTranslations('BioLink')

  const [tab, setTab] = useState<Tab>('links')
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

  // Re-populate form when team data arrives.
  useEffect(() => {
    if (team) reset(getDefaults(team))
  }, [team?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview values
  const formValues = useWatch({ control })

  // Ctrl/Cmd+S saves the bio-link form (when there are unsaved changes).
  useSaveShortcut(() => {
    if (isDirty && !isSubmitting) handleSubmit(onSubmit, onInvalidForm)()
  })

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

    const socialLinks = SOCIAL_PLATFORMS.filter(
      (p) => data[p as keyof FormData] as string | undefined
    ).map((p) => ({ platform: p, url: data[p as keyof FormData] as string }))

    // Firestore rejects `undefined` values — strip them before any write
    const bioLinkPayload = stripUndefined({
      bioLinkTheme: data.bioLinkTheme,
      bioLinkAccentColor: data.accentColor,
      bioLinkBackground: { type: data.bgType, color: data.bgColor },
      socialLinks,
      links: data.links,
    })

    try {
      // ① Write public_profile first — only needs team-member permission, source of
      //    truth for the public bio-link. Must succeed.
      const profileRef = doc(db, TEAMS_COLLECTION, currentTeamId, 'public_profile', currentTeamId)
      await setDoc(
        profileRef,
        stripUndefined({
          type: 'team',
          slug: team?.slug ?? '',
          name: team?.name ?? '',
          ...bioLinkPayload,
        }),
        { merge: true }
      )

      // ② Also update the team doc (needs owner role) so the editor form re-hydrates
      //    correctly after reload. Non-fatal: log but don't fail the whole save.
      updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        ...bioLinkPayload,
      }).catch((err) => {
        console.warn('[bio-link save] team doc update failed (non-fatal):', err)
      })

      await qc.invalidateQueries({ queryKey: ['team', currentTeamId] })
      toast.success('Bio-link settings saved')
    } catch (err) {
      console.error('[bio-link save] failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    }
  }

  function onInvalidForm(errors: FieldErrors<FormData>) {
    toast.error('Some fields have errors — check the form and try again.')
    console.error('[bio-link save] form validation errors:', JSON.stringify(errors, null, 2))
  }

  // ── preview data ──────────────────────────────────────────────────────────

  const previewTeam = {
    name: team?.name ?? '',
    description: team?.description,
    profileImage: profileImageUrl ?? undefined,
    heroImage: heroImageUrl ?? undefined,
    bioLinkTheme: formValues.bioLinkTheme,
    bioLinkAccentColor: formValues.accentColor,
    bioLinkBackground: formValues.bgType
      ? { type: formValues.bgType as 'solid' | 'gradient', color: formValues.bgColor ?? '' }
      : undefined,
    socialLinks: SOCIAL_PLATFORMS.filter(
      (p) => formValues[p as keyof FormData] as string | undefined
    ).map((p) => ({ platform: p, url: formValues[p as keyof FormData] as string })),
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

  const bioLinkUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/public/${team.slug}`
      : `/public/${team.slug}`

  const tabs: { key: Tab; label: string }[] = [
    { key: 'links', label: t('tabLinks') },
    { key: 'appearance', label: t('tabAppearance') },
    { key: 'social', label: t('tabSocial') },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <a
            href={bioLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1 mt-0.5"
          >
            {bioLinkUrl.replace(/^https?:\/\//, '')}
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
                onClick={() => setTab(key)}
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
              <LinksTab
                control={control}
                register={register}
                availableTargets={availableTargets}
              />
            )}
            {tab === 'social' && <SocialTab register={register} />}
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
              href={bioLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              {t('openBioLink')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="rounded-xl border overflow-hidden max-h-[calc(100vh-12rem)] overflow-y-auto shadow-sm">
            {/* Links are inert in the preview (onLinkClick prevents navigation). */}
            <BioLinkHome team={previewTeam} slug={team.slug} onLinkClick={() => {}} />
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

// Normalises stored links for the form, mapping any legacy is{Booking,Membership,
// Courses,Shop}Link booleans to the new `target` page-link discriminator. No
// injection/filtering — page links are added explicitly via the "+ Add" menu.
function buildLinks(rawLinks: Team['links']): FormData['links'] {
  return (rawLinks ?? []).map((l) => ({
    label: typeof l.label === 'string' ? l.label : '',
    description: typeof l.description === 'string' ? l.description : undefined,
    url: typeof l.url === 'string' ? l.url : '',
    showInBioLink:
      l.showInBioLink === true || l.showInBioLink === false ? l.showInBioLink : false,
    iconName: typeof l.iconName === 'string' ? l.iconName : undefined,
    target: resolveSystemLinkTarget(l) ?? undefined,
  }))
}

function getDefaults(team: Team | null): FormData {
  const sl = team?.socialLinks ?? []
  const getSocial = (p: SocialPlatform) => sl.find((s) => s.platform === p)?.url ?? ''

  return {
    bioLinkTheme: (['light', 'dark', 'auto'] as const).includes(team?.bioLinkTheme as never)
      ? (team!.bioLinkTheme as FormData['bioLinkTheme'])
      : 'light',
    accentColor: typeof team?.bioLinkAccentColor === 'string' ? team.bioLinkAccentColor : '#6366f1',
    bgType: team?.bioLinkBackground?.type === 'gradient' ? 'gradient' : 'solid',
    bgColor:
      typeof team?.bioLinkBackground?.color === 'string' ? team.bioLinkBackground.color : '#ffffff',
    instagram: getSocial('instagram'),
    facebook: getSocial('facebook'),
    youtube: getSocial('youtube'),
    tiktok: getSocial('tiktok'),
    x: getSocial('x'),
    linkedin: getSocial('linkedin'),
    whatsapp: getSocial('whatsapp'),
    website: getSocial('website'),
    review: getSocial('review'),
    // Normalise stored links + map any legacy boolean flags to `target`.
    links: buildLinks(team?.links ?? []),
  }
}
