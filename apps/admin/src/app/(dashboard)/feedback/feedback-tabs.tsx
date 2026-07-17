'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Each feedback area is its own route under /feedback so it loads only its own
// data server-side. The Inbox tab is the index route and must match exactly,
// or it would light up on /feedback/prompts and /feedback/settings too.
const TABS = [
  { href: '/feedback', label: 'Inbox', exact: true },
  { href: '/feedback/prompts', label: 'Prompts', exact: false },
  { href: '/feedback/settings', label: 'Settings', exact: false },
]

export function FeedbackTabs() {
  const pathname = usePathname()
  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-6">
        {TABS.map(({ href, label, exact }) => {
          const active = exact
            ? pathname === href || /^\/feedback\/(?!prompts|settings)/.test(pathname)
            : pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'border-b-2 px-0.5 pb-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
