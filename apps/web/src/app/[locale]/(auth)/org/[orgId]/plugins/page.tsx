'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { ORGANIZATIONS_COLLECTION, ORG_INSTALLED_PLUGINS_SUBCOLLECTION } from '@linyup/shared'
import type { InstalledPlugin, PluginManifest, PluginCategory } from '@linyup/shared'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Puzzle, Sparkles, MessageCircle, Globe, Zap, Settings2, Gift, GraduationCap, Trophy, FolderTree } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
}

function PluginIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Puzzle
  return <Icon className={className} />
}

// ─── Org installed plugins snapshot ──────────────────────────────────────────

function useOrgInstalledPlugins(orgId: string) {
  const [installations, setInstallations] = useState<InstalledPlugin[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const colRef = collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_INSTALLED_PLUGINS_SUBCOLLECTION)
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        setInstallations(snap.docs.map((d) => ({ pluginId: d.id, ...d.data() } as InstalledPlugin)))
        setIsLoading(false)
      },
      (err) => {
        console.error('[OrgPluginsPage] snapshot error:', err)
        setIsLoading(false)
      }
    )
    return unsub
  }, [orgId])

  return { installations, isLoading }
}

// ─── Plugin card ──────────────────────────────────────────────────────────────

function OrgPluginCard({
  manifest,
  isInstalled,
  onInstall,
  onUninstall,
  busy,
}: {
  manifest: PluginManifest
  isInstalled: boolean
  onInstall: () => void
  onUninstall: () => void
  busy: boolean
}) {
  const t = useTranslations('Plugins')
  const tOrg = useTranslations('Org')

  const categoryLabel: Record<PluginCategory, string> = {
    engagement: t('categoryEngagement'),
    commerce: t('categoryCommerce'),
    web: t('categoryWeb'),
    data: t('categoryData'),
  }

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
            {isInstalled && (
              <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                {tOrg('pluginsInstalledBadge')}
              </Badge>
            )}
            {manifest.status === 'coming_soon' && (
              <Badge variant="secondary" className="text-xs">{t('statusComingSoon')}</Badge>
            )}
            {manifest.status === 'beta' && !isInstalled && (
              <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">{t('statusBeta')}</Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{categoryLabel[manifest.category]}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t(manifest.descriptionKey as Parameters<typeof t>[0])}
      </p>

      {/* Actions */}
      <div className="mt-auto pt-1">
        {isInstalled ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onUninstall}
            disabled={busy}
          >
            {tOrg('pluginsUninstall')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onInstall}
            disabled={manifest.status === 'coming_soon' || busy}
          >
            {busy ? tOrg('pluginsInstalling') : tOrg('pluginsInstall')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgPluginsPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const { isAdmin } = useOrg()
  const { user } = useAuth()
  const t = useTranslations('Org')
  const tPlugins = useTranslations('Plugins')

  const { installations, isLoading } = useOrgInstalledPlugins(orgId)
  const [busyId, setBusyId] = useState<string | null>(null)

  const activeIds = new Set(
    installations.filter((i) => i.status === 'active').map((i) => i.pluginId)
  )

  const installMutation = useMutation({
    mutationFn: async (manifest: PluginManifest) => {
      if (!user) throw new Error('Not authenticated')
      const docRef = doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_INSTALLED_PLUGINS_SUBCOLLECTION, manifest.id)
      const payload: Omit<InstalledPlugin, 'installedAt'> & { installedAt: ReturnType<typeof serverTimestamp> } = {
        pluginId: manifest.id,
        orgId,
        installedAt: serverTimestamp() as ReturnType<typeof serverTimestamp>,
        installedBy: user.uid,
        status: 'active',
      }
      await setDoc(docRef, payload)
    },
    onMutate: (manifest) => setBusyId(manifest.id),
    onSettled: () => setBusyId(null),
    onError: () => toast.error(t('pluginsErrorInstall')),
    onSuccess: (_, manifest) =>
      toast.success(tPlugins(manifest.nameKey as Parameters<typeof tPlugins>[0]) + ' — ' + t('pluginsInstalledSuccess')),
  })

  const uninstallMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      const docRef = doc(db, ORGANIZATIONS_COLLECTION, orgId, ORG_INSTALLED_PLUGINS_SUBCOLLECTION, pluginId)
      await deleteDoc(docRef)
    },
    onMutate: (pluginId) => setBusyId(pluginId),
    onSettled: () => setBusyId(null),
    onError: () => toast.error(t('pluginsErrorUninstall')),
    onSuccess: () => toast.success(t('pluginsUninstalledSuccess')),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
        <div className="grid gap-6 sm:grid-cols-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-lg" />)}
        </div>
      </div>
    )
  }

  // All available plugins, recommended first
  const sortedRegistry = [...PLUGIN_REGISTRY].sort(
    (a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false)
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">{t('pluginsTitle')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('pluginsSubtitle')}</p>
      </div>

      {!isAdmin && (
        <p className="text-sm text-muted-foreground">{t('pluginsReadOnly')}</p>
      )}

      {/* Grid */}
      <div className="grid gap-6 sm:grid-cols-2">
        {sortedRegistry.map((manifest) => (
          <OrgPluginCard
            key={manifest.id}
            manifest={manifest}
            isInstalled={activeIds.has(manifest.id)}
            busy={busyId === manifest.id}
            onInstall={() => isAdmin && installMutation.mutate(manifest)}
            onUninstall={() => isAdmin && uninstallMutation.mutate(manifest.id)}
          />
        ))}
      </div>
    </div>
  )
}
