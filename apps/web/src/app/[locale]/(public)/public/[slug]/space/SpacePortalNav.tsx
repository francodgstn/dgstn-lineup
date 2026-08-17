'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import type { Route } from 'next'
import { Home, CalendarClock, User, Receipt } from 'lucide-react'
import { useSpaceAuth } from './SpaceAuthProvider'
import { useSpaceTheme } from './useSpaceTheme'
import { useSpacePayments } from './useSpacePayments'

// Portal module tabs — the whole portal is a signed-in, personal area (home is the
// member dashboard, not a public course library), so the tabs only render once
// there's a session. Payments is conditional: shown only when the contact has any
// payment history OR a Stripe billing account (hidden for cash / other payers).
export default function SpacePortalNav() {
  const t = useTranslations('Space')
  const { slug, isAuthenticated } = useSpaceAuth()
  const { accent, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const pathname = usePathname()
  const { data: paymentsData, isError: paymentsFailed } = useSpacePayments()

  if (!isAuthenticated) return null

  // On FAILURE the tab stays. Hiding it would delete the only surface that can
  // explain the failure, and the deletion itself reads as an answer: "you have no
  // payments here". An empty RESULT hides the tab; an unknown one must not.
  const hasPayments =
    paymentsFailed ||
    (paymentsData?.payments.length ?? 0) > 0 ||
    paymentsData?.billingAvailable === true

  const base = `/public/${slug}/space`
  const items = [
    { href: base, label: t('navHome'), icon: Home, exact: true },
    { href: `${base}/bookings`, label: t('navBookings'), icon: CalendarClock },
    ...(hasPayments ? [{ href: `${base}/payments`, label: t('navPayments'), icon: Receipt }] : []),
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
