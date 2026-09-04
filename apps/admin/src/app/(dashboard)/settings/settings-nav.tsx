'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// A VERTICAL rail, not a tab strip. Nine settings areas overflowed a horizontal
// row and left every label competing for the same glance; stacked, they read as
// a list and the groups below do work a flat row could not.
//
// The groups are not decoration — they answer "where would I look for this".
// Delivery is everything that leaves the platform and reaches a person;
// Platform is configuration that applies to every tenant at once; Member app is
// the pair that has to be reasoned about together (the store review login lives
// in the demo tenant, so changing one without the other is how a submission
// breaks).
//
// Add an area by adding a row here + a matching route under /settings.
const GROUPS: Array<{ label: string; rows: Array<{ href: string; label: string }> }> = [
  {
    label: 'Delivery',
    rows: [
      { href: '/settings/email', label: 'Email' },
      { href: '/settings/announcement', label: 'Announcement' },
      { href: '/settings/notices', label: 'Notices' },
    ],
  },
  {
    label: 'Platform',
    rows: [
      { href: '/settings/stripe', label: 'Payments' },
      { href: '/settings/domains', label: 'Domains' },
      { href: '/settings/translation', label: 'Translation' },
      { href: '/settings/access', label: 'Access' },
    ],
  },
  {
    label: 'Member app',
    rows: [
      { href: '/settings/mobile', label: 'Member app' },
      { href: '/settings/demo-tenant', label: 'Demo tenant' },
    ],
  },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Settings sections"
      className={cn(
        // Horizontal and scrollable on narrow screens, where a rail would eat
        // the whole viewport; vertical from md up.
        'flex gap-6 overflow-x-auto border-b pb-2',
        'md:flex-col md:gap-5 md:overflow-visible md:border-b-0 md:pb-0',
      )}
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="flex shrink-0 gap-4 md:flex-col md:gap-0.5">
          <p className="hidden px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 md:block">
            {group.label}
          </p>
          {group.rows.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap text-sm font-medium transition-colors',
                  // Narrow: an underlined row, as before. Wide: a filled pill.
                  'border-b-2 pb-1.5 md:rounded-lg md:border-b-0 md:px-2 md:py-1.5',
                  active
                    ? 'border-primary text-foreground md:bg-accent md:text-accent-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground md:hover:bg-accent/50',
                )}
              >
                {label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
