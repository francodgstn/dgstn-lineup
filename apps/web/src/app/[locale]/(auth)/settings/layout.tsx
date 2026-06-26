'use client'

// Master-detail shell for the whole /settings/* area. The rail is rendered once here
// and stays mounted as the detail pane (children) swaps — so navigating between
// settings sections never re-flashes the rail. Responsive:
//   desktop → rail (left) + detail (right), always both; /settings shows an overview.
//   mobile  → /settings shows just the rail (the list); a section shows just the
//             detail with a "back to Settings" link (the classic list ⇆ detail split).

import { usePathname, Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ChevronLeft } from 'lucide-react'
import { SettingsRail } from './SettingsRail'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Nav')
  const pathname = usePathname()
  const isRoot = pathname === '/settings'

  return (
    <div className="md:flex md:gap-8">
      <aside className={`md:w-60 md:shrink-0 ${isRoot ? 'block' : 'hidden md:block'}`}>
        <div className="md:sticky md:top-6">
          <SettingsRail />
        </div>
      </aside>

      <div className={`min-w-0 flex-1 ${isRoot ? 'hidden md:block' : 'block'}`}>
        {!isRoot && (
          <Link
            href={'/settings' as Route}
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('settingsHubTitle')}
          </Link>
        )}
        {children}
      </div>
    </div>
  )
}
