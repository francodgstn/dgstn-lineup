'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation } from '@tanstack/react-query'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCapabilities } from '@/hooks/useCapabilities'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { toast } from 'sonner'
import { Puzzle, Lightbulb, ArrowRight, RefreshCw, Plus, ListChecks, Check } from 'lucide-react'
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
import { useSetupChecklist, type SetupStep } from '@/hooks/useSetupChecklist'
import { TIPS } from '@/data/tips'

type Tab = 'plugins' | 'tips' | 'onboarding'

// Per-browser dismissal of the onboarding reminder tab.
const ONBOARDING_DISMISS_KEY = 'linyup_onboarding_tab_dismissed'

// ─── plugin suggestion row ──────────────────────────────────────────────────

function SuggestionRow({ manifest }: { manifest: PluginManifest }) {
  const tDiscover = useTranslations('Discover')
  const tPlugins = useTranslations('Plugins')
  const { user, currentTeamId } = useAuth()
  const { can } = useCapabilities()
  const { plan } = usePlan()
  const { openUpgradeModal } = useUpgradeModal()
  const [installing, setInstalling] = useState(false)

  const access = pluginAccessForPlan(manifest, plan)
  // Installing/managing plugins is an owner-only capability.
  const isOwner = can('plugins.manage')
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
  // plugins up to a small cap. Locked plugins are excluded — they can't be
  // installed without a key, so they're never a discovery nudge.
  const notInstalled = PLUGIN_REGISTRY.filter((m) => !isInstalled(m.id) && !m.locked)
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

// ─── onboarding (setup) tab ───────────────────────────────────────────────────
// A reminder of the initial setup steps — title + done state, each linking to the
// relevant page. Auto-completes from real data (useSetupChecklist).

function OnboardingTab({ steps, onDismiss }: { steps: SetupStep[]; onDismiss: () => void }) {
  const t = useTranslations('Onboarding')
  const tDiscover = useTranslations('Discover')
  const required = steps.filter((s) => !s.optional)
  const requiredDone = required.filter((s) => s.done).length

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-0.5">
        {steps.map((s) => (
          <Link
            key={s.key}
            href={s.href as Route}
            className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-muted/50 transition-colors"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                s.done
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-muted-foreground/30'
              }`}
            >
              {s.done && <Check className="h-3 w-3" />}
            </span>
            <span
              className={`text-sm ${s.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
            >
              {t(`setup.steps.${s.key}.label` as Parameters<typeof t>[0])}
            </span>
            {s.optional && (
              <span className="text-[10px] text-muted-foreground">({tDiscover('optional')})</span>
            )}
          </Link>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {requiredDone}/{required.length}
        </span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDismiss}>
          {tDiscover('dismiss')}
        </Button>
      </div>
    </div>
  )
}

// ─── panel ──────────────────────────────────────────────────────────────────

export function DiscoverPanel() {
  const t = useTranslations('Discover')
  const { currentTeamId } = useAuth()
  const { steps, allRequiredDone } = useSetupChecklist(currentTeamId)

  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_DISMISS_KEY) === '1') setDismissed(true)
    } catch {
      /* ignore */
    }
  }, [])

  // The onboarding reminder shows until every required step is done or it's dismissed.
  const showOnboarding = !dismissed && !allRequiredDone

  const [tab, setTab] = useState<Tab>('tips')
  // If the onboarding tab was selected and then disappears, fall back to Tips.
  useEffect(() => {
    if (tab === 'onboarding' && !showOnboarding) setTab('tips')
  }, [tab, showOnboarding])

  function dismissOnboarding() {
    try {
      localStorage.setItem(ONBOARDING_DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
    setTab('tips')
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    ...(showOnboarding
      ? [{ key: 'onboarding' as Tab, label: t('tabOnboarding'), icon: ListChecks }]
      : []),
    { key: 'tips', label: t('tabTips'), icon: Lightbulb },
    { key: 'plugins', label: t('tabPlugins'), icon: Puzzle },
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
        {tab === 'plugins' ? (
          <PluginsTab />
        ) : tab === 'onboarding' ? (
          <OnboardingTab steps={steps} onDismiss={dismissOnboarding} />
        ) : (
          <TipsTab />
        )}
      </CardContent>
    </Card>
  )
}
