'use client'

// How-to — conceptual orientation for studio managers. Not step-by-step
// instructions: the mental model (four core concepts + how they connect), the
// public surfaces, story-style answers to early questions, and pointers to keep
// going (tour, setup checklist, tips, plugins). Reachable from the sidebar's
// General group.
//
// Section ids here are the TOC's anchors — keep them in step with TOC_SECTIONS.
import { useTranslations } from 'next-intl'
import { CoreConcepts } from '@/components/howto/CoreConcepts'
import { PublicPages } from '@/components/howto/PublicPages'
import { HowToFaq } from '@/components/howto/HowToFaq'
import { HowToUtilities } from '@/components/howto/HowToUtilities'
import { HowToTocChips, HowToTocRail } from '@/components/howto/HowToToc'

export default function HowToPage() {
  const t = useTranslations('HowTo')

  return (
    <div className="mx-auto flex max-w-5xl gap-10">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

        <HowToTocChips />

        <div id="concepts" className="mt-8 scroll-mt-6">
          <CoreConcepts />
        </div>

        {/* Public pages — its own section, separated from the concepts */}
        <div id="public-pages" className="mt-12 scroll-mt-6 border-t pt-10">
          <PublicPages />
        </div>

        {/* Second area — guidance to keep going */}
        <div id="faq" className="mt-12 scroll-mt-6 border-t pt-10">
          <HowToFaq />
        </div>
        <div id="keep-going" className="mt-10 scroll-mt-6">
          <HowToUtilities />
        </div>
      </div>

      <HowToTocRail />
    </div>
  )
}
