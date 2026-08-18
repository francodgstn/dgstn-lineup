'use client'

// The settings rail — a searchable, grouped vertical tab list shared by the whole
// /settings/* area via the settings layout. Highlights the active destination
// (matching path + ?tab= for the team sub-sections) and carries the "always show"
// toggle that adds/removes an item from the sidebar's Shortcuts group (vocabulary:
// THE NAV-MEMORY CENSUS in contexts/NavPinsContext.tsx). On desktop it sits beside
// the detail pane; on mobile it IS the /settings index list.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { Search, Star } from 'lucide-react'
import { SETTINGS_ITEMS, SETTINGS_GROUPS } from '@/lib/settings-nav'
import { useNavPins } from '@/contexts/NavPinsContext'
import { useCapabilities } from '@/hooks/useCapabilities'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { Input } from '@/components/ui/input'

export function SettingsRail() {
  const t = useTranslations('Nav')
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentTab = searchParams.get('tab')
  const { can } = useCapabilities()
  // Same derivation the team-settings page makes — the owner-only surfaces are
  // the ones this capability names.
  const canEdit = can('team.settings')
  const { isInstalled } = useInstalledPlugins()
  const { isAlwaysShown, toggleAlwaysShown } = useNavPins()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const labelOf = (key: string) => t(key as Parameters<typeof t>[0])
  const matches = (key: string) => !q || labelOf(key).toLowerCase().includes(q)

  // Hide plugin/role-gated items when their condition doesn't hold.
  const gateOk = (item: (typeof SETTINGS_ITEMS)[number]) => {
    if (item.gate === 'ownerOnly') return canEdit
    if (item.gate === 'customFields') return isInstalled('custom-fields')
    return true
  }
  const visible = (item: (typeof SETTINGS_ITEMS)[number]) => gateOk(item) && matches(item.labelKey)
  const anyMatch = SETTINGS_ITEMS.some(visible)

  // Active when the path matches and ?tab= matches — team sub-sections share the
  // /settings/team path and differ only by tab.
  const isActive = (href: string) => {
    const [path, qs] = href.split('?')
    if (pathname !== path) return false
    const tab = qs ? new URLSearchParams(qs).get('tab') : null
    return tab == null ? currentTab == null : currentTab === tab
  }

  return (
    <nav className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settingsSearchPlaceholder')}
          aria-label={t('settingsSearchPlaceholder')}
          className="h-9 pl-8 text-sm"
        />
      </div>

      {!anyMatch ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">{t('settingsNoResults')}</p>
      ) : (
        SETTINGS_GROUPS.map((group) => {
          const items = SETTINGS_ITEMS.filter((i) => i.group === group.key && visible(i))
          if (items.length === 0) return null
          return (
            <div key={group.key} className="space-y-0.5">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {labelOf(group.labelKey)}
              </p>
              {items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                const shown = isAlwaysShown(item.id)
                return (
                  <div key={item.id} className="group relative flex items-center">
                    <Link
                      href={item.href as Route}
                      className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 pr-8 text-sm transition-colors ${
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                      />
                      <span className="truncate">{labelOf(item.labelKey)}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleAlwaysShown(item.id)}
                      title={shown ? t('shortcutStopAlwaysShowing') : t('shortcutAlwaysShow')}
                      aria-pressed={shown}
                      className={`absolute right-1 rounded-md p-1 transition-all ${
                        shown
                          ? 'text-primary opacity-100'
                          : 'text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
                      }`}
                    >
                      <Star className={`h-3.5 w-3.5 ${shown ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </nav>
  )
}
