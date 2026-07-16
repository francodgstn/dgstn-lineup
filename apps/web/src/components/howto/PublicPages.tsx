'use client'

// The world-facing surfaces, as a vertical-tabs section: the list of public
// pages runs down the left, the selected one's description sits on the right.
// On narrow screens the list becomes a horizontal, scrollable chip row above
// the panel.
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { PUBLIC_PAGES, type PublicPageId } from './concepts'

export function PublicPages() {
  const t = useTranslations('HowTo')
  const [selected, setSelected] = useState<PublicPageId>('bioLink')
  const page = PUBLIC_PAGES.find((p) => p.id === selected)!
  const PageIcon = page.icon

  return (
    <section>
      <h2 className="text-lg font-semibold">{t('publicPages.title')}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('publicPages.intro')}</p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:gap-6">
        {/* Vertical tab list (horizontal scroll on mobile) */}
        <div
          role="tablist"
          aria-orientation="vertical"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:w-56 sm:shrink-0 sm:flex-col sm:gap-1 sm:overflow-visible sm:px-0"
        >
          {PUBLIC_PAGES.map((p) => {
            const active = p.id === selected
            const Icon = p.icon
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                id={`howto-pp-tab-${p.id}`}
                aria-selected={active}
                aria-controls="howto-pp-panel"
                onClick={() => setSelected(p.id)}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? 'border-primary bg-primary/[0.05] font-medium text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap sm:whitespace-normal">
                  {t(`publicPages.surfaces.${p.id}.name` as Parameters<typeof t>[0])}
                </span>
              </button>
            )
          })}
        </div>

        {/* Detail panel */}
        <div
          role="tabpanel"
          id="howto-pp-panel"
          aria-labelledby={`howto-pp-tab-${selected}`}
          className="min-w-0 flex-1 rounded-xl border bg-card p-5"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <PageIcon className="h-4 w-4" />
            </span>
            <h3 className="text-base font-semibold">
              {t(`publicPages.surfaces.${selected}.name` as Parameters<typeof t>[0])}
            </h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t(`publicPages.surfaces.${selected}.desc` as Parameters<typeof t>[0])}
          </p>
          <div className="mt-4 border-t pt-3">
            <Link
              href={page.href as Route}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('publicPages.openLink')} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
