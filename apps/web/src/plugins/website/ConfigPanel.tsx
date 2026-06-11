'use client'

import { Globe, ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'

// Shortcut shown in the Plugins → Configure dialog. The full editor lives at the
// nav entry /plugins/website (added by the manifest's navContributions).
export function ConfigPanel() {
  const t = useTranslations('Plugins')
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Globe className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t('websiteConfigBody')}</p>
      <Link
        href={'/plugins/website' as Route}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('websiteConfigOpen')}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
