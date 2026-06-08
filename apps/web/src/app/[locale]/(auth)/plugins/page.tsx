'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  doc, setDoc, deleteDoc, getDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Puzzle, Sparkles, MessageCircle, Globe, Zap, Settings2, Gift, GraduationCap, Trophy,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ConfigPanel as AiInsightsConfigPanel } from '@/plugins/ai-insights/ConfigPanel'
import { ConfigPanel as WhatsappConfigPanel } from '@/plugins/whatsapp/ConfigPanel'
import { ConfigPanel as ClubWebsiteConfigPanel } from '@/plugins/club-website/ConfigPanel'

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

// ─── Plugin card ──────────────────────────────────────────────────────────────

function PluginCard({
  manifest,
  access,
  isInstalled,
  isOwner,
  onInstall,
  onRemove,
  onConfigure,
  onUpgrade,
  installing,
}: {
  manifest: PluginManifest
  access: PluginAccess
  isInstalled: boolean
  isOwner: boolean
  onInstall: () => void
  onRemove: () => void
  onConfigure: () => void
  onUpgrade: () => void
  installing: boolean
}) {
  const t = useTranslations('Plugins')

  const statusBadge = isInstalled ? (
    <Badge variant="outline" className="border-green-500 text-green-600 text-xs">
      <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
      {t('statusInstalled')}
    </Badge>
  ) : manifest.status === 'coming_soon' ? (
    <Badge variant="secondary" className="text-xs">{t('statusComingSoon')}</Badge>
  ) : manifest.status === 'beta' ? (
    <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">{t('statusBeta')}</Badge>
  ) : null

  const categoryLabel: Record<PluginCategory, string> = {
    ai: t('categoryAi'),
    communications: t('categoryCommunications'),
    website: t('categoryWebsite'),
    content: t('categoryContent'),
    engagement: t('categoryEngagement'),
    payments: 'Payments',
    analytics: 'Analytics',
  }

  const accessBadge =
    access.kind === 'included' ? (
      <Badge variant="outline" className="text-xs border-green-500/50 text-green-600">
        {t('accessIncluded')}
      </Badge>
    ) : access.kind === 'addon' ? (
      <Badge variant="secondary" className="text-xs border-primary/30 bg-primary/10 text-primary">
        {t('addonPrice', { price: access.priceMonthly })}
      </Badge>
    ) : null

  return (
    <div className="rounded-lg border bg-card p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <PluginIcon name={manifest.iconName} className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="font-medium text-sm leading-tight">
              {t(manifest.nameKey as Parameters<typeof t>[0])}
            </span>
            {manifest.recommended && (
              <Badge variant="secondary" className="text-xs border-primary/30 bg-primary/10 text-primary">
                {t('recommended')}
              </Badge>
            )}
            {accessBadge}
            {statusBadge}
          </div>
          <div className="flex items-center gap-1.5">
            {access.kind === 'upgrade' && (
              <Badge variant="outline" className="text-xs py-0">{access.minPlan}</Badge>
            )}
            <span className="text-xs text-muted-foreground">{categoryLabel[manifest.category]}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t(manifest.descriptionKey as Parameters<typeof t>[0])}
      </p>

      {/* Actions */}
      {isOwner && (
        <div className="mt-auto pt-1">
          {isInstalled ? (
            <div className="flex gap-2">
              {manifest.hasOwnerConfig && (
                <Button size="sm" variant="outline" onClick={onConfigure}>
                  {t('configure')}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRemove}>
                {t('remove')}
              </Button>
            </div>
          ) : access.kind === 'upgrade' ? (
            <Button size="sm" variant="outline" onClick={onUpgrade}>
              {t('upgradeCta')}
            </Button>
          ) : access.kind === 'addon' ? (
            // Phase 1: add-on billing not wired yet — show price, disable activation.
            <div className="flex flex-col gap-1">
              <Button size="sm" variant="outline" disabled>
                {t('addonAdd', { price: access.priceMonthly })}
              </Button>
              <span className="text-xs text-muted-foreground">{t('addonComingSoon')}</span>
            </div>
          ) : (
            // included (club/org)
            <Button
              size="sm"
              variant="outline"
              onClick={onInstall}
              disabled={manifest.status === 'coming_soon' || installing}
            >
              {installing ? t('installing') : t('install')}
            </Button>
          )}
        </div>
      )}
    </div>
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
    'ai-insights':  AiInsightsConfigPanel,
    'whatsapp':     WhatsappConfigPanel,
    'club-website': ClubWebsiteConfigPanel,
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PluginsPage() {
  const t = useTranslations('Plugins')
  const { user, currentTeamId } = useAuth()
  const { isInstalled, isLoading: pluginsLoading } = useInstalledPlugins()
  const { data: isOwner, isLoading: roleLoading } = useIsOwner(currentTeamId, user?.uid ?? null)
  const { plan } = usePlan()
  const { openUpgradeModal } = useUpgradeModal()

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [configPlugin, setConfigPlugin] = useState<PluginManifest | null>(null)

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

  // ── Remove mutation ──
  const removeMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!currentTeamId) throw new Error('Not authenticated')
      const docRef = doc(db, TEAMS_COLLECTION, currentTeamId, INSTALLED_PLUGINS_SUBCOLLECTION, pluginId)
      await deleteDoc(docRef)
    },
    onError: () => toast.error(t('errorRemove')),
  })

  const isLoading = pluginsLoading || roleLoading

  // ── Category tabs ──
  const CATEGORIES: { key: CategoryFilter; label: string }[] = [
    { key: 'all',            label: t('categoryAll') },
    { key: 'ai',             label: t('categoryAi') },
    { key: 'communications', label: t('categoryCommunications') },
    { key: 'website',        label: t('categoryWebsite') },
    { key: 'content',        label: t('categoryContent') },
    { key: 'engagement',     label: t('categoryEngagement') },
  ]

  const filteredPlugins = PLUGIN_REGISTRY
    .filter((m) => categoryFilter === 'all' || m.category === categoryFilter)
    // Recommended plugins float to the top for prominence.
    .sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false))

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
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

      {/* Coach add-on hint: plugins are included on Club, paid add-ons on Coach */}
      {plan === 'coach' && (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-3 text-sm">
          <p className="font-medium">{t('coachAddonBannerTitle')}</p>
          <p className="text-muted-foreground">{t('coachAddonBannerBody')}</p>
        </div>
      )}

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
      <div className="grid gap-6 sm:grid-cols-2">
        {filteredPlugins.map((manifest) => (
          <PluginCard
            key={manifest.id}
            manifest={manifest}
            access={pluginAccessForPlan(manifest, plan)}
            isInstalled={isInstalled(manifest.id)}
            isOwner={!!isOwner}
            installing={installingId === manifest.id}
            onInstall={() => installMutation.mutate(manifest)}
            onRemove={() => removeMutation.mutate(manifest.id)}
            onConfigure={() => setConfigPlugin(manifest)}
            onUpgrade={() => openUpgradeModal({ minPlan: manifest.minPlan })}
          />
        ))}
      </div>

      {filteredPlugins.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          {t('categoryAll')} — no plugins in this category yet.
        </p>
      )}

      {/* Config dialog */}
      <PluginConfigDialog
        manifest={configPlugin}
        open={!!configPlugin}
        onClose={() => setConfigPlugin(null)}
      />
    </div>
  )
}
