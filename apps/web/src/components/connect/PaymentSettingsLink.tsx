'use client'

// Small inline link to Settings → Payments, shown on pages that use payments
// (plans & affiliations, products, online courses, shop). The billing currency +
// Connect setup live there, so each payment surface points back to one place.

import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function PaymentSettingsLink({ className }: { className?: string }) {
  const t = useTranslations('TeamSettings')
  return (
    <Link
      href={'/settings/team?tab=payments' as Route}
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline ${className ?? ''}`}
    >
      <Wallet className="h-3.5 w-3.5" />
      {t('paymentSettingsLink')}
    </Link>
  )
}
