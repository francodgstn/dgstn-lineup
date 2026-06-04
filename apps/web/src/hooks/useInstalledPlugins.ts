'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { TEAMS_COLLECTION, INSTALLED_PLUGINS_SUBCOLLECTION } from '@linyup/shared'
import type { InstalledPlugin, PluginId, PluginManifest } from '@linyup/shared'
import { PLUGIN_REGISTRY } from '@/plugins/registry'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstalledPluginEntry {
  manifest: PluginManifest
  installation: InstalledPlugin
}

export interface UseInstalledPluginsResult {
  /** Only plugins that are installed and active */
  plugins: InstalledPluginEntry[]
  isInstalled: (id: PluginId) => boolean
  getConfig: (id: PluginId) => Record<string, unknown> | undefined
  isLoading: boolean
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Real-time subscription to a team's installed plugins.
 * Cross-references Firestore installation state with the static PLUGIN_REGISTRY.
 * Uses onSnapshot so all open tabs see changes immediately when a plugin is installed.
 */
export function useInstalledPlugins(): UseInstalledPluginsResult {
  const { currentTeamId } = useAuth()
  const [installations, setInstallations] = useState<InstalledPlugin[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!currentTeamId) {
      setInstallations([])
      setIsLoading(false)
      return
    }

    const colRef = collection(db, TEAMS_COLLECTION, currentTeamId, INSTALLED_PLUGINS_SUBCOLLECTION)

    const unsubscribe = onSnapshot(
      colRef,
      (snap) => {
        const docs = snap.docs.map((d) => ({ pluginId: d.id, ...d.data() } as InstalledPlugin))
        setInstallations(docs)
        setIsLoading(false)
      },
      (err) => {
        console.error('[useInstalledPlugins] snapshot error:', err)
        setIsLoading(false)
      }
    )

    return unsubscribe
  }, [currentTeamId])

  const activeInstallations = installations.filter((i) => i.status === 'active')

  const plugins: InstalledPluginEntry[] = activeInstallations
    .map((installation) => {
      const manifest = PLUGIN_REGISTRY.find((m) => m.id === installation.pluginId)
      if (!manifest) return null
      return { manifest, installation }
    })
    .filter((e): e is InstalledPluginEntry => e !== null)

  const isInstalled = (id: PluginId) =>
    activeInstallations.some((i) => i.pluginId === id)

  const getConfig = (id: PluginId) =>
    activeInstallations.find((i) => i.pluginId === id)?.config

  return { plugins, isInstalled, getConfig, isLoading }
}
