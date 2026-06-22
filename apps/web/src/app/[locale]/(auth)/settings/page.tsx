'use client'

// Settings hub — the home for all lower-frequency configuration. Lists every
// settings destination grouped into sections, each with a pin toggle that adds/
// removes it from the sidebar's Settings group (per-browser preference).

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { Pin } from 'lucide-react'
import { SETTINGS_ITEMS, SETTINGS_GROUPS } from '@/lib/settings-nav'
import { useSettingsPins } from '@/contexts/SettingsPinsContext'

export default function SettingsHubPage() {
  const t = useTranslations('Nav')
  const { isPinned, togglePin } = useSettingsPins()

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t('settingsHubTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('settingsHubSubtitle')}</p>
      </div>

      {SETTINGS_GROUPS.map((group) => {
        const items = SETTINGS_ITEMS.filter((i) => i.group === group.key)
        if (items.length === 0) return null
        return (
          <section key={group.key} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(group.labelKey as Parameters<typeof t>[0])}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((item) => {
                const Icon = item.icon
                const pinned = isPinned(item.id)
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/40"
                  >
                    <Link href={item.href as Route} className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <span className="truncate text-sm font-medium">
                        {t(item.labelKey as Parameters<typeof t>[0])}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => togglePin(item.id)}
                      title={pinned ? t('unpinFromSidebar') : t('pinToSidebar')}
                      aria-pressed={pinned}
                      className={`shrink-0 rounded-md p-1.5 transition-colors ${
                        pinned
                          ? 'text-primary'
                          : 'text-muted-foreground/40 hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Pin className={`h-4 w-4 ${pinned ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
