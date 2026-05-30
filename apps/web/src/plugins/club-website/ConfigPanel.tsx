'use client'

import { Globe } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function ConfigPanel() {
  const t = useTranslations('Plugins')
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
      <Globe className="h-8 w-8 opacity-40" />
      <p className="text-sm">{t('statusComingSoon')}</p>
    </div>
  )
}
