'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { useParams } from 'next/navigation'
import { OrgProvider, useOrg } from '@/contexts/OrgContext'
import { Skeleton } from '@/components/ui/skeleton'
import { Building2, Users, CreditCard, Settings, ChevronLeft, CalendarRange, Shield, IdCard } from 'lucide-react'
import type { Route } from 'next'

function OrgShell({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const t = useTranslations('Org')
  const { org, loading, membershipTerm } = useOrg()
  const pathname = usePathname()

  const tabs = [
    { href: `/org/${orgId}/clubs`,       label: t('tabClubs'),       icon: Building2 },
    { href: `/org/${orgId}/events`,      label: t('tabEvents'),      icon: CalendarRange },
    { href: `/org/${orgId}/memberships`, label: membershipTerm,      icon: IdCard },
    { href: `/org/${orgId}/ranking`,     label: t('tabRanking'),     icon: Shield },
    { href: `/org/${orgId}/members`,     label: t('tabMembers'),     icon: Users },
    { href: `/org/${orgId}/billing`,     label: t('tabBilling'),     icon: CreditCard },
    { href: `/org/${orgId}/settings`,    label: t('tabSettings'),    icon: Settings },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={'/dashboard' as Route}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t('backToDashboard')}
        </Link>
        {loading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <h1 className="text-2xl font-bold">{org?.name ?? t('title')}</h1>
        )}
      </div>

      {/* Tab nav */}
      <nav className="flex gap-0.5 border-b">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.includes(href)
          return (
            <Link
              key={href}
              href={href as Route}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>()
  return (
    <OrgProvider orgId={orgId}>
      <OrgShell orgId={orgId}>{children}</OrgShell>
    </OrgProvider>
  )
}
