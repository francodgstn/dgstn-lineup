'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Each settings area is its own route under /settings so it can load only its
// own data server-side. Add a tab by adding an entry here + a matching route.
const TABS = [
  { href: '/settings/email', label: 'Email' },
  { href: '/settings/stripe', label: 'Payments' },
  { href: '/settings/domains', label: 'Domains' },
  { href: '/settings/access', label: 'Access' },
  { href: '/settings/announcement', label: 'Announcement' },
  { href: '/settings/notices', label: 'Notices' },
  { href: '/settings/demo-tenant', label: 'Demo tenant' },
]

export function SettingsTabs() {
  const pathname = usePathname()
  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-6">
        {TABS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
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
