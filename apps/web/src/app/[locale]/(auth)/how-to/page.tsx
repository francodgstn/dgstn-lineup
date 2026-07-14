'use client'

// How-to — placeholder while the guides are being written. Reachable from the
// sidebar's General group.
import { useTranslations } from 'next-intl'
import { Compass } from 'lucide-react'

export default function HowToPage() {
  const t = useTranslations('HowTo')

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

      <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-6 py-20 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
          <Compass className="h-7 w-7" />
        </span>
        <p className="mt-5 text-lg font-semibold">{t('comingSoon')}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('comingSoonBody')}</p>
      </div>
    </div>
  )
}
