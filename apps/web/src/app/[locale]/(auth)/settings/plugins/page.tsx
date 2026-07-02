'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  doc, setDoc, deleteDoc, getDoc, serverTimestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import {
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
} from '@linyup/shared'
import type { PluginManifest, InstalledPlugin, PluginCategory, PluginAccess } from '@linyup/shared'
import { pluginAccessForPlan } from '@linyup/shared'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal } from '@/contexts/UpgradeModalContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Puzzle, Sparkles, MessageCircle, Globe, Zap, Settings2, Gift,
  GraduationCap, Trophy, FolderTree, Search, Tag, ListPlus, ClipboardList,
  ImageIcon, FileText, CheckCircle2, Coins, Lock, Clock, FlaskConical, Star,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Tooltip as UITooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ConfigPanel as AiInsightsConfigPanel } from '@/plugins/ai-insights/ConfigPanel'
import { ConfigPanel as WhatsappConfigPanel } from '@/plugins/whatsapp/ConfigPanel'
import { ConfigPanel as WebsiteConfigPanel } from '@/plugins/website/ConfigPanel'

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  MessageCircle,
  Globe,
  Zap,
  Puzzle,
  Settings2,
  Gift,
  GraduationCap,
  Trophy,
  FolderTree,
  Tag,
  ListPlus,
  ClipboardList,
  FileText,
}

function PluginIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Puzzle
  return <Icon className={className} />
}

// ─── Owner check ──────────────────────────────────────────────────────────────

function useIsOwner(teamId: string | null, userId: string | null) {
  return useQuery<boolean>({
    queryKey: ['team-role', teamId, userId],
    enabled: !!teamId && !!userId,
    queryFn: async () => {
      if (!teamId || !userId) return false
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId, TEAM_MEMBERS_SUBCOLLECTION, userId))
      return snap.exists() && snap.data()?.role === 'owner'
    },
  })
}

// ─── Category tabs ────────────────────────────────────────────────────────────

type CategoryFilter = 'all' | PluginCategory

// ─── Badge helpers ────────────────────────────────────────────────────────────

/**
 * Compact, icon-only signal row for the plugin GRID card — declutters the dense
 * text-badge stack down to a few small icons, each explained on hover. Category
 * is intentionally omitted here (it's filterable via the tabs and shown in the
 * detail modal). Plan/price + upgrade are already conveyed by the action button,
 * so they appear here only as a supplementary hint (useful for non-owners who see
 * no action button). Renders nothing when there's no signal to show.
 */
function PluginBadgeIcons({
  manifest,
  access,
}: {
  manifest: PluginManifest
  access: PluginAccess
}) {
  const t = useTranslations('Plugins')

  // Icons are monochrome (muted) at rest and reveal their semantic colour only on
  // hover — keeps the grid calm while still signalling on interaction.
  const items: { key: string; icon: LucideIcon; label: string; hoverClassName: string }[] = []

  if (manifest.recommended) {
    items.push({ key: 'recommended', icon: Star, label: t('recommended'), hoverClassName: 'hover:text-amber-500' })
  }
  if (access.kind === 'included') {
    items.push({ key: 'included', icon: CheckCircle2, label: t('accessIncluded'), hoverClassName: 'hover:text-green-600' })
  } else if (access.kind === 'addon') {
    items.push({ key: 'addon', icon: Coins, label: t('addonPrice', { price: access.priceMonthly }), hoverClassName: 'hover:text-primary' })
  } else if (access.kind === 'upgrade') {
    items.push({ key: 'upgrade', icon: Lock, label: t('badgeUpgrade', { plan: access.minPlan }), hoverClassName: 'hover:text-foreground' })
  }
  if (manifest.status === 'coming_soon') {
    items.push({ key: 'coming_soon', icon: Clock, label: t('statusComingSoon'), hoverClassName: 'hover:text-foreground' })
  } else if (manifest.status === 'beta') {
    items.push({ key: 'beta', icon: FlaskConical, label: t('statusBeta'), hoverClassName: 'hover:text-blue-600' })
  }

  if (items.length === 0) return null

  return (
    <TooltipProvider delay={200}>
      <div className="flex items-center gap-2.5">
        {items.map(({ key, icon: Icon, label, hoverClassName }) => (
          <UITooltip key={key}>
            <TooltipTrigger
              className={cn('inline-flex cursor-help text-muted-foreground/60 transition-colors', hoverClassName)}
              aria-label={label}
            >
              <Icon className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </UITooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}

/**
 * Returns the full text-badge set for the plugin DETAIL MODAL (more room there).
 *
 * Badges rendered (in order, only when relevant):
 *   1. Category — always shown (muted, outline style).
 *   2. "Recommended" — amber tint, only when manifest.recommended is true.
 *   3. Plan / price — green "Included", primary-tinted add-on price, or
 *      upgrade requirement. Omitted when access.kind === 'included' AND plan is
 *      studio/org (it's the default — not worth saying).
 *   4. Status — "Coming soon" / "Beta" when not 'available'. Installed status
 *      is shown separately in the card (not as a badge here).
 */
function PluginBadges({
  manifest,
  access,
  categoryLabel,
  showInstalled,
  installedByOrg,
}: {
  manifest: PluginManifest
  access: PluginAccess
  categoryLabel: string
  showInstalled?: boolean
  installedByOrg?: boolean
}) {
  const t = useTranslations('Plugins')

  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Category */}
      <Badge variant="outline" className="text-xs text-muted-foreground">
        {categoryLabel}
      </Badge>

      {/* Recommended */}
      {manifest.recommended && (
        <Badge
          variant="secondary"
          className="text-xs bg-amber-50 text-amber-700 border-amber-200"
        >
          {t('recommended')}
        </Badge>
      )}

      {/* Plan / price tier */}
      {access.kind === 'included' && (
        <Badge variant="outline" className="text-xs border-green-500/50 text-green-600">
          {t('accessIncluded')}
        </Badge>
      )}
      {access.kind === 'addon' && (
        <Badge
          variant="secondary"
          className="text-xs border-primary/30 bg-primary/10 text-primary"
        >
          {t('addonPrice', { price: access.priceMonthly })}
        </Badge>
      )}
      {access.kind === 'upgrade' && (
        <Badge variant="outline" className="text-xs">
          {t('badgeUpgrade', { plan: access.minPlan })}
        </Badge>
      )}

      {/* Status */}
      {manifest.status === 'coming_soon' && (
        <Badge variant="secondary" className="text-xs">
          {t('statusComingSoon')}
        </Badge>
      )}
      {manifest.status === 'beta' && (
        <Badge
          variant="secondary"
          className="text-xs bg-blue-50 text-blue-700 border-blue-200"
        >
          {t('statusBeta')}
        </Badge>
      )}

      {/* Installed state (optional — shown in modal or when caller requests it) */}
      {showInstalled && (
        installedByOrg ? (
          <Badge
            variant="secondary"
            className="text-xs bg-blue-50 text-blue-700 border-blue-200"
          >
            {t('orgManagedBadge')}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-xs border-green-500 text-green-600"
          >
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
            {t('statusInstalled')}
          </Badge>
        )
      )}
    </div>
  )
}

// ─── Plugin card ──────────────────────────────────────────────────────────────

function PluginCard({
  manifest,
  access,
  isInstalled,
  installedByOrg,
  isOwner,
  onInstall,
  onRemove,
  onConfigure,
  onUpgrade,
  onUnlock,
  onDetails,
  installing,
}: {
  manifest: PluginManifest
  access: PluginAccess
  isInstalled: boolean
  installedByOrg: boolean
  isOwner: boolean
  onInstall: () => void
  onRemove: () => void
  onConfigure: () => void
  onUpgrade: () => void
  onUnlock: () => void
  onDetails: () => void
  installing: boolean
}) {
  const t = useTranslations('Plugins')

  return (
    <div
      className="group rounded-xl border bg-card p-4 flex flex-col gap-3 cursor-pointer hover:border-foreground/20 hover:shadow-sm transition-all"
      onClick={onDetails}
      role="button"
      tabIndex={0}
      aria-label={t(manifest.nameKey as Parameters<typeof t>[0])}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onDetails() }}
    >
      {/* Header row: icon + name + installed dot */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted group-hover:bg-muted/80 transition-colors">
          <PluginIcon name={manifest.iconName} className="h-4.5 w-4.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm leading-tight truncate">
              {t(manifest.nameKey as Parameters<typeof t>[0])}
            </span>
            {manifest.locked && !isInstalled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                <Lock className="h-2.5 w-2.5" />
                {t('lockedBadge')}
              </span>
            )}
            {isInstalled && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0"
                aria-label={t('statusInstalled')}
              />
            )}
          </div>
          {/* One-line description */}
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
            {t(manifest.descriptionKey as Parameters<typeof t>[0])}
          </p>
        </div>
      </div>

      {/* Compact signal icons (recommended / plan / status) with hover tooltips */}
      <PluginBadgeIcons manifest={manifest} access={access} />

      {/* Action row — stop propagation so card-click (→ details) is separate */}
      {isOwner && (
        <div
          className="mt-auto pt-1 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {isInstalled ? (
            installedByOrg ? (
              <span className="text-xs text-muted-foreground">{t('orgManagedHint')}</span>
            ) : (
              <>
                {manifest.hasOwnerConfig && (
                  <Button size="sm" variant="outline" onClick={onConfigure}>
                    {t('configure')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={onRemove}
                >
                  {t('remove')}
                </Button>
              </>
            )
          ) : manifest.locked ? (
            <Button size="sm" variant="outline" onClick={onUnlock}>
              <Lock className="h-3.5 w-3.5" />
              {t('unlock')}
            </Button>
          ) : access.kind === 'upgrade' ? (
            <Button size="sm" variant="outline" onClick={onUpgrade}>
              {t('upgradeCta')}
            </Button>
          ) : access.kind === 'addon' ? (
            <Button
              size="sm"
              variant="default"
              onClick={onInstall}
              disabled={manifest.status === 'coming_soon' || installing}
            >
              {installing ? t('installing') : t('addonAdd', { price: access.priceMonthly })}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={onInstall}
              disabled={manifest.status === 'coming_soon' || installing}
            >
              {installing ? t('installing') : t('install')}
            </Button>
          )}
          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
            onClick={onDetails}
          >
            {t('detailsLink')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Plugin detail modal ──────────────────────────────────────────────────────

function PluginDetailModal({
  manifest,
  access,
  isInstalled,
  installedByOrg,
  isOwner,
  onInstall,
  onRemove,
  onConfigure,
  onUpgrade,
  onUnlock,
  installing,
  categoryLabel,
  open,
  onClose,
}: {
  manifest: PluginManifest | null
  access: PluginAccess | null
  isInstalled: boolean
  installedByOrg: boolean
  isOwner: boolean
  onInstall: () => void
  onRemove: () => void
  onConfigure: () => void
  onUpgrade: () => void
  onUnlock: () => void
  installing: boolean
  categoryLabel: string
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('Plugins')

  if (!manifest || !access) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <PluginIcon name={manifest.iconName} className="h-5 w-5 text-muted-foreground" />
            </div>
            <DialogTitle className="text-base">
              {t(manifest.nameKey as Parameters<typeof t>[0])}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Screenshot area */}
        {manifest.screenshot ? (
          <div className="rounded-lg overflow-hidden border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={manifest.screenshot}
              alt={t('screenshotAlt', { name: t(manifest.nameKey as Parameters<typeof t>[0]) })}
              className="w-full object-cover"
            />
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/50 flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-30" />
            <span className="text-xs">{t('screenshotPlaceholder')}</span>
          </div>
        )}

        {/* Full description */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t(manifest.descriptionKey as Parameters<typeof t>[0])}
        </p>

        {/* Badges */}
        <PluginBadges
          manifest={manifest}
          access={access}
          categoryLabel={categoryLabel}
          showInstalled={isInstalled}
          installedByOrg={installedByOrg}
        />

        {/* Org-managed hint */}
        {isInstalled && installedByOrg && (
          <p className="text-xs text-muted-foreground">{t('orgManagedHint')}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>

          {isOwner && (
            isInstalled ? (
              installedByOrg ? null : (
                <div className="flex gap-2">
                  {manifest.hasOwnerConfig && (
                    <Button
                      variant="outline"
                      onClick={() => { onClose(); onConfigure() }}
                    >
                      {t('configure')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => { onClose(); onRemove() }}
                  >
                    {t('remove')}
                  </Button>
                </div>
              )
            ) : manifest.locked ? (
              <Button onClick={() => { onClose(); onUnlock() }}>
                <Lock className="h-4 w-4" />
                {t('unlock')}
              </Button>
            ) : access.kind === 'upgrade' ? (
              <Button onClick={() => { onClose(); onUpgrade() }}>
                {t('upgradeCta')}
              </Button>
            ) : access.kind === 'addon' ? (
              <Button
                onClick={() => { onClose(); onInstall() }}
                disabled={manifest.status === 'coming_soon' || installing}
              >
                {installing
                  ? t('installing')
                  : t('addonAdd', { price: access.priceMonthly })}
              </Button>
            ) : (
              <Button
                onClick={() => { onClose(); onInstall() }}
                disabled={manifest.status === 'coming_soon' || installing}
              >
                {installing ? t('installing') : t('install')}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Config dialog ────────────────────────────────────────────────────────────

function PluginConfigDialog({
  manifest,
  open,
  onClose,
}: {
  manifest: PluginManifest | null
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('Plugins')

  if (!manifest) return null

  const CONFIG_PANELS: Record<string, React.ComponentType> = {
    'ai-insights': AiInsightsConfigPanel,
    'whatsapp':    WhatsappConfigPanel,
    'website':     WebsiteConfigPanel,
  }
  const ConfigPanel = CONFIG_PANELS[manifest.id] ?? null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PluginIcon name={manifest.iconName} className="h-4 w-4" />
            {t(manifest.nameKey as Parameters<typeof t>[0])}
          </DialogTitle>
        </DialogHeader>
        {ConfigPanel ? <ConfigPanel /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Unlock dialog (locked plugins) ───────────────────────────────────────────
// Locked plugins install only via the unlockPlugin callable after a strong-key
// check. The real-time useInstalledPlugins snapshot picks up the new install doc,
// so there's nothing to refetch on success.

function PluginUnlockDialog({
  manifest,
  teamId,
  open,
  onClose,
}: {
  manifest: PluginManifest | null
  teamId: string | null
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('Plugins')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reset = () => { setKey(''); setError(null); setSubmitting(false) }

  async function submit() {
    if (!manifest || !teamId || !key.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await httpsCallable(functions, 'unlockPlugin')({ teamId, pluginId: manifest.id, key: key.trim() })
      toast.success(`${t(manifest.nameKey as Parameters<typeof t>[0])} · ${t('unlockSuccess')}`)
      reset()
      onClose()
    } catch {
      setError(t('unlockError'))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {manifest ? t(manifest.nameKey as Parameters<typeof t>[0]) : t('unlockTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('unlockDesc')}</p>
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('unlockPlaceholder')}
            autoComplete="off"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>{t('cancel')}</Button>
          <Button onClick={submit} disabled={!key.trim() || submitting}>
            {submitting ? t('installing') : t('unlock')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PluginsPage() {
  const t = useTranslations('Plugins')
  const { user, currentTeamId } = useAuth()
  const { plugins: installedPlugins, isInstalled, isLoading: pluginsLoading } = useInstalledPlugins()
  const { data: isOwner, isLoading: roleLoading } = useIsOwner(currentTeamId, user?.uid ?? null)
  const { plan, isTrialing } = usePlan()
  const { openUpgradeModal } = useUpgradeModal()
  const searchParams = useSearchParams()

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [configPlugin, setConfigPlugin] = useState<PluginManifest | null>(null)
  const [detailPlugin, setDetailPlugin] = useState<PluginManifest | null>(null)
  const [confirmAddon, setConfirmAddon] = useState<PluginManifest | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<PluginManifest | null>(null)

  // ── Deep-link: ?plugin=<id> auto-opens the detail modal once per distinct value ──
  // Track the last param value we acted on so that closing the modal does not
  // reopen it (the param stays in the URL until the user navigates away).
  const lastAutoOpenedRef = useRef<string | null>(null)

  useEffect(() => {
    const pluginParam = searchParams.get('plugin')
    if (!pluginParam) return
    // Only auto-open once per distinct param value.
    if (lastAutoOpenedRef.current === pluginParam) return
    const manifest = PLUGIN_REGISTRY.find((m) => m.id === pluginParam)
    if (!manifest) return
    lastAutoOpenedRef.current = pluginParam
    setDetailPlugin(manifest)
  }, [searchParams])

  // ── Install mutation ──
  const installMutation = useMutation({
    mutationFn: async (manifest: PluginManifest) => {
      if (!currentTeamId || !user) throw new Error('Not authenticated')
      const docRef = doc(db, TEAMS_COLLECTION, currentTeamId, INSTALLED_PLUGINS_SUBCOLLECTION, manifest.id)
      const payload: Omit<InstalledPlugin, 'installedAt'> & { installedAt: ReturnType<typeof serverTimestamp> } = {
        pluginId: manifest.id,
        teamId: currentTeamId,
        installedAt: serverTimestamp() as ReturnType<typeof serverTimestamp>,
        installedBy: user.uid,
        status: 'active',
        config: {},
      }
      await setDoc(docRef, payload)
    },
    onMutate: (manifest) => setInstallingId(manifest.id),
    onSettled: () => setInstallingId(null),
    onError: () => toast.error(t('errorInstall')),
    onSuccess: (_, manifest) => toast.success(t(manifest.nameKey as Parameters<typeof t>[0]) + ' installed'),
  })

  // ── Remove mutation (Studio/Org included plugins — client-side) ──
  const removeMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!currentTeamId) throw new Error('Not authenticated')
      const docRef = doc(db, TEAMS_COLLECTION, currentTeamId, INSTALLED_PLUGINS_SUBCOLLECTION, pluginId)
      await deleteDoc(docRef)
    },
    onError: () => toast.error(t('errorRemove')),
  })

  // ── Coach add-on mutations ──
  const activateAddonMutation = useMutation({
    mutationFn: async (manifest: PluginManifest) => {
      if (!currentTeamId) throw new Error('Not authenticated')
      await httpsCallable(functions, 'activatePluginAddon')({ teamId: currentTeamId, pluginId: manifest.id })
    },
    onMutate: (manifest) => setInstallingId(manifest.id),
    onSettled: () => setInstallingId(null),
    onError: () => toast.error(t('errorInstall')),
    onSuccess: (_, manifest) => toast.success(t(manifest.nameKey as Parameters<typeof t>[0]) + ' activated'),
  })

  const deactivateAddonMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!currentTeamId) throw new Error('Not authenticated')
      await httpsCallable(functions, 'deactivatePluginAddon')({ teamId: currentTeamId, pluginId })
    },
    onError: () => toast.error(t('errorRemove')),
  })

  function handleInstall(manifest: PluginManifest) {
    const access = pluginAccessForPlan(manifest, plan)
    if (access.kind === 'addon') {
      if (isTrialing) activateAddonMutation.mutate(manifest)
      else setConfirmAddon(manifest)
    } else {
      installMutation.mutate(manifest)
    }
  }

  function handleRemove(manifest: PluginManifest) {
    const access = pluginAccessForPlan(manifest, plan)
    if (access.kind === 'addon') deactivateAddonMutation.mutate(manifest.id)
    else removeMutation.mutate(manifest.id)
  }

  const isLoading = pluginsLoading || roleLoading

  // ── Category tabs ──
  const CATEGORIES: { key: CategoryFilter; label: string }[] = [
    { key: 'all',        label: t('categoryAll') },
    { key: 'engagement', label: t('categoryEngagement') },
    { key: 'commerce',   label: t('categoryCommerce') },
    { key: 'web',        label: t('categoryWeb') },
    { key: 'data',       label: t('categoryData') },
  ]

  const categoryLabelMap: Record<PluginCategory, string> = {
    engagement: t('categoryEngagement'),
    commerce: t('categoryCommerce'),
    web: t('categoryWeb'),
    data: t('categoryData'),
  }

  const search = searchTerm.trim().toLowerCase()
  const filteredPlugins = PLUGIN_REGISTRY
    .filter((m) => categoryFilter === 'all' || m.category === categoryFilter)
    .filter(
      (m) =>
        !search ||
        t(m.nameKey).toLowerCase().includes(search) ||
        t(m.descriptionKey).toLowerCase().includes(search),
    )
    .sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false))

  // Detail plugin's access + installed state (derived)
  const detailAccess = detailPlugin ? pluginAccessForPlan(detailPlugin, plan) : null
  const detailIsInstalled = detailPlugin ? isInstalled(detailPlugin.id) : false
  const detailEntry = detailPlugin
    ? installedPlugins.find((e) => e.manifest.id === detailPlugin.id)
    : null
  const detailInstalledByOrg = detailEntry?.source === 'org'

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {/* Coach add-on hint */}
      {plan === 'coach' && (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-3 text-sm">
          <p className="font-medium">{t('coachAddonBannerTitle')}</p>
          <p className="text-muted-foreground">{t('coachAddonBannerBody')}</p>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(({ key, label }) => (
          <Button
            key={key}
            size="sm"
            variant={categoryFilter === key ? 'secondary' : 'ghost'}
            onClick={() => setCategoryFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {filteredPlugins.map((manifest) => {
          const entry = installedPlugins.find((e) => e.manifest.id === manifest.id)
          return (
            <PluginCard
              key={manifest.id}
              manifest={manifest}
              access={pluginAccessForPlan(manifest, plan)}
              isInstalled={isInstalled(manifest.id)}
              installedByOrg={entry?.source === 'org'}
              isOwner={!!isOwner}
              installing={installingId === manifest.id}
              onInstall={() => handleInstall(manifest)}
              onRemove={() => handleRemove(manifest)}
              onConfigure={() => setConfigPlugin(manifest)}
              onUpgrade={() => openUpgradeModal({ minPlan: manifest.minPlan })}
              onUnlock={() => setUnlockTarget(manifest)}
              onDetails={() => setDetailPlugin(manifest)}
            />
          )
        })}
      </div>

      {filteredPlugins.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          {t('emptySearch')}
        </p>
      )}

      {/* Plugin detail modal */}
      <PluginDetailModal
        manifest={detailPlugin}
        access={detailAccess}
        isInstalled={detailIsInstalled}
        installedByOrg={detailInstalledByOrg}
        isOwner={!!isOwner}
        installing={detailPlugin ? installingId === detailPlugin.id : false}
        categoryLabel={detailPlugin ? categoryLabelMap[detailPlugin.category] : ''}
        onInstall={() => { if (detailPlugin) handleInstall(detailPlugin) }}
        onRemove={() => { if (detailPlugin) handleRemove(detailPlugin) }}
        onConfigure={() => { if (detailPlugin) setConfigPlugin(detailPlugin) }}
        onUpgrade={() => { if (detailPlugin) openUpgradeModal({ minPlan: detailPlugin.minPlan }) }}
        onUnlock={() => { if (detailPlugin) setUnlockTarget(detailPlugin) }}
        open={!!detailPlugin}
        onClose={() => setDetailPlugin(null)}
      />

      {/* Config dialog */}
      <PluginConfigDialog
        manifest={configPlugin}
        open={!!configPlugin}
        onClose={() => setConfigPlugin(null)}
      />

      {/* Unlock dialog (locked plugins) */}
      <PluginUnlockDialog
        manifest={unlockTarget}
        teamId={currentTeamId}
        open={!!unlockTarget}
        onClose={() => setUnlockTarget(null)}
      />

      {/* Add-on price confirmation (paid coach) */}
      <Dialog open={!!confirmAddon} onOpenChange={(v) => { if (!v) setConfirmAddon(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('addonConfirmTitle')}</DialogTitle>
          </DialogHeader>
          {confirmAddon && (
            <p className="text-sm text-muted-foreground">
              {t('addonConfirmBody', {
                name: t(confirmAddon.nameKey as Parameters<typeof t>[0]),
                price: confirmAddon.addon?.coachPriceMonthly ?? 0,
              })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAddon(null)}>{t('cancel')}</Button>
            <Button
              onClick={() => {
                const m = confirmAddon
                setConfirmAddon(null)
                if (m) activateAddonMutation.mutate(m)
              }}
            >
              {t('addonConfirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
