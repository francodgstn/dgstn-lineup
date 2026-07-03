'use client'

// Compact language switcher — swaps the locale while preserving the current path
// (next-intl's locale-aware router). Reusable; used e.g. top-right on the demo /try
// page. Shows the current locale code with a globe.

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { Globe } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const LABEL: Record<string, string> = { en: 'EN', de: 'DE', fr: 'FR', it: 'IT' }

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('Common')

  return (
    <Select
      value={locale}
      onValueChange={(v) => {
        if (v && v !== locale) router.replace(pathname, { locale: v })
      }}
    >
      <SelectTrigger
        aria-label={t('language')}
        className={`h-8 w-auto gap-1.5 px-2 text-xs ${className ?? ''}`}
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {routing.locales.map((l) => (
          <SelectItem key={l} value={l} className="text-xs">
            {LABEL[l] ?? l.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
