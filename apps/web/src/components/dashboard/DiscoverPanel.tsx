'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation } from '@tanstack/react-query'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { toast } from 'sonner'
import { Puzzle, Lightbulb, ArrowRight, RefreshCw, Plus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DynamicIcon } from '@/components/ui/icon-picker'
import {
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  pluginAccessForPlan,
} from '@linyup/shared'
import type { PluginManifest, InstalledPlugin } from '@linyup/shared'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal } from '@/contexts/UpgradeModalContext'
import { TIPS } from '@/data/tips'

type Tab = 'plugins' | 'tips'

// ─── plugin suggestion row ──────────────────────────────────────────────────

function SuggestionRow({ manifest }: { manifest: PluginManifest }) {
  const tDiscover = useTranslations('Discover')
  const tPlugins = useTranslations('Plugins')
  const { user, currentTeamId, teamRole } = useAuth()
  const { plan } = usePlan()
  const { openUpgradeModal } = useUpgradeModal()
  const [installing, setInstalling] = useState(false)

  const access = pluginAccessForPlan(manifest, plan)
  const isOwner = teamRole === 'owner'
  const available = manifest.status === 'available'

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!currentTeamId || !user) throw new Error('Not authenticated')
      const ref = doc(
        db,
        TEAMS_COLLECTION,
        currentTeamId,
        INSTALLED_PLUGINS_SUBCOLLECTION,
        manifest.id
      )
      const payload: Omit<InstalledPlugin, 'installedAt'> & {
        installedAt: ReturnType<typeof serverTimestamp>
      } = {
        pluginId: manifest.id,
        teamId: currentTeamId,
        installedAt: serverTimestamp() as ReturnType<typeof serverTimestamp>,
        installedBy: user.uid,
        status: 'active',
        config: {},
      }
      await setDoc(ref, payload)
    },
    onMutate: () => setInstalling(true),
    onSettled: () => setInstalling(false),
    onError: () => toast.error(tDiscover('errorInstall')),
    onSuccess: () =>
      toast.success(
        tDiscover('installed', {
          name: tPlugins(manifest.nameKey as Parameters<typeof tPlugins>[0]),
        })
      ),
  })

  // One action per row, by access kind + status.
  function action() {
    if (!available) {
      return (
        <Badge variant="secondary" className="text-[11px]">
          {tDiscover('soon')}
        </Badge>
      )
    }
    if (access.kind === 'upgrade') {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => openUpgradeModal({ minPlan: manifest.minPlan })}
        >
          {tDiscover('upgrade')}
        </Button>
      )
    }
    if (access.kind === 'included' && isOwner) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={installing}
          onClick={() => installMutation.mutate()}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {installing ? tDiscover('installing') : tDiscover('install')}
        </Button>
      )
    }
    // addon, or non-owner included → send to the catalog to complete the flow
    return (
      <Link
        href={'/settings/plugins' as Route}
        className="inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium hover:bg-muted"
      >
        {access.kind === 'addon'
          ? tPlugins('addonAdd', { price: access.priceMonthly })
          : tDiscover('view')}
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <DynamicIcon name={manifest.iconName} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {tPlugins(manifest.nameKey as Parameters<typeof tPlugins>[0])}
        </p>
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {tPlugins(manifest.descriptionKey as Parameters<typeof tPlugins>[0])}
        </p>
      </div>
      <div className="shrink-0">{action()}</div>
    </div>
  )
}

// ─── plugins tab ────────────────────────────────────────────────────────────

function PluginsTab() {
  const t = useTranslations('Discover')
  const { isInstalled } = useInstalledPlugins()

  // Recommended plugins first (all of them), then fill with other available
  // plugins up to a small cap.
  const notInstalled = PLUGIN_REGISTRY.filter((m) => !isInstalled(m.id))
  const recommended = notInstalled.filter((m) => m.recommended)
  const others = notInstalled.filter((m) => !m.recommended && m.status === 'available')
  const suggestions = [...recommended, ...others].slice(0, 4)

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <p className="text-sm text-muted-foreground">{t('allInstalled')}</p>
        <Link href={'/settings/plugins' as Route} className="text-xs text-primary hover:underline">
          {t('browseAll')} →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-3">
        {suggestions.map((m) => (
          <SuggestionRow key={m.id} manifest={m} />
        ))}
      </div>
      <Link
        href={'/settings/plugins' as Route}
        className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {t('browseAll')} <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

// ─── tips tab ───────────────────────────────────────────────────────────────

function TipsTab() {
  const t = useTranslations('Discover')
  // Seed from the day so the first tip varies without being random on every render.
  const [index, setIndex] = useState(() => new Date().getDate() % TIPS.length)
  const tip = TIPS[index]

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <DynamicIcon name={tip.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {t(`tip_${tip.id}_title` as Parameters<typeof t>[0])}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(`tip_${tip.id}_body` as Parameters<typeof t>[0])}
          </p>
          {tip.href && (
            <Link
              href={tip.href as Route}
              className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline"
            >
              {t('learnMore')} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {t('tipCounter', { current: index + 1, total: TIPS.length })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setIndex((i) => (i + 1) % TIPS.length)}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('nextTip')}
        </Button>
      </div>
    </div>
  )
}

// ─── panel ──────────────────────────────────────────────────────────────────

export function DiscoverPanel() {
  const t = useTranslations('Discover')
  const [tab, setTab] = useState<Tab>('plugins')

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'plugins', label: t('tabPlugins'), icon: Puzzle },
    { key: 'tips', label: t('tabTips'), icon: Lightbulb },
  ]

  return (
    <Card className="flex h-full flex-col">
      <div className="flex gap-1 border-b px-3 pt-3">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      <CardContent className="flex flex-1 flex-col p-4">
        {tab === 'plugins' ? <PluginsTab /> : <TipsTab />}
      </CardContent>
    </Card>
  )
}
