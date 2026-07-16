'use client'

// How-to — conceptual orientation for studio managers. Not step-by-step
// instructions: the mental model (five core concepts + how they connect),
// story-style answers to early questions, and pointers to keep going (tour,
// setup checklist, tips, plugins). Reachable from the sidebar's General group.
import { useTranslations } from 'next-intl'
import { CoreConcepts } from '@/components/howto/CoreConcepts'
import { PublicPages } from '@/components/howto/PublicPages'
import { HowToFaq } from '@/components/howto/HowToFaq'
import { HowToUtilities } from '@/components/howto/HowToUtilities'

export default function HowToPage() {
  const t = useTranslations('HowTo')

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

      <div className="mt-8">
        <CoreConcepts />
      </div>

      {/* Public pages — its own section, separated from the concepts */}
      <div className="mt-12 border-t pt-10">
        <PublicPages />
      </div>

      {/* Second area — guidance to keep going */}
      <div className="mt-12 space-y-10 border-t pt-10">
        <HowToFaq />
        <HowToUtilities />
      </div>
    </div>
  )
}
