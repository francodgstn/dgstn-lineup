'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { HelpCircle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/contexts/AuthContext'
import { markIntroSeen } from '@/lib/onboarding'

// Sections that have intro content under the `Onboarding.intro.<key>` messages.
export type IntroSection = 'dashboard' | 'contacts' | 'calendar'

// Auto-shown sections this SPA session (component remounts on navigation, and
// the in-memory profile isn't refetched after markIntroSeen writes — so this
// stops the panel re-popping mid-session; Firestore handles cross-session).
const autoShownThisSession = new Set<string>()

/**
 * Phase 4 of the onboarding initiative: a small, reopenable "?" panel that
 * explains a section and its terminology. Auto-opens once per user (tracked in
 * users/{uid}.onboarding.seenIntros), and stays available via the "?" button.
 */
export function SectionIntro({ sectionKey }: { sectionKey: IntroSection }) {
  const t = useTranslations('Onboarding')
  const { user, profile } = useAuth()
  const [open, setOpen] = useState(false)

  const seen = profile?.onboarding?.seenIntros?.includes(sectionKey) ?? false

  // Auto-open once after the profile has loaded, if not previously seen.
  useEffect(() => {
    if (!profile || seen || autoShownThisSession.has(sectionKey)) return
    autoShownThisSession.add(sectionKey)
    setOpen(true)
  }, [profile, seen, sectionKey])

  const terms = (t.raw(`intro.${sectionKey}.terms`) as string[] | undefined) ?? []

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // Persist "seen" when the (auto-shown) panel is dismissed.
    if (!next && !seen && user) {
      void markIntroSeen(user.uid, sectionKey)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        aria-label={t('intro.open')}
      >
        <HelpCircle className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-2">
          <p className="font-semibold text-sm">{t(`intro.${sectionKey}.title`)}</p>
          <p className="text-sm text-muted-foreground">{t(`intro.${sectionKey}.body`)}</p>
          {terms.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 pb-1">
                {t('intro.termsLabel')}
              </p>
              <ul className="space-y-1">
                {terms.map((term, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-primary shrink-0">•</span>
                    <span>{term}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
