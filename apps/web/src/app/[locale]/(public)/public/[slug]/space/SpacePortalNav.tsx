'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import type { Route } from 'next'
import { GraduationCap, CalendarClock, User } from 'lucide-react'
import { useSpaceAuth } from './SpaceAuthProvider'
import { useSpaceTheme } from './useSpaceTheme'

// Portal module tabs — only meaningful once signed in (the course library at the
// home route is partly public, but the member modules require a session).
export default function SpacePortalNav() {
  const t = useTranslations('Space')
  const { slug, isAuthenticated } = useSpaceAuth()
  const { accent, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const pathname = usePathname()

  if (!isAuthenticated) return null

  const base = `/public/${slug}/space`
  const items = [
    { href: base, label: t('navHome'), icon: GraduationCap, exact: true },
    { href: `${base}/bookings`, label: t('navBookings'), icon: CalendarClock },
    { href: `${base}/account`, label: t('navAccount'), icon: User },
  ]

  return (
    <nav className="pt-6">
      <div className="flex gap-1 rounded-full p-1" style={{ background: cardBg, border: `1px solid ${cardBorder}` }}>
        {items.map((it) => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href)
          const Icon = it.icon
          return (
            <Link
              key={it.href}
              href={it.href as Route}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
              style={active ? { background: accent, color: '#fff' } : { color: textMuted }}
            >
              <Icon className="h-4 w-4" />
              <span>{it.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
