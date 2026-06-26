'use client'

// /settings index. On desktop this fills the detail pane with a gentle overview
// prompt (the rail is on the left). On mobile the layout hides this and shows the
// rail as the list, so the user taps through to a section's own page.

import { useTranslations } from 'next-intl'
import { SlidersHorizontal } from 'lucide-react'

export default function SettingsOverviewPage() {
  const t = useTranslations('Nav')
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <SlidersHorizontal className="mb-4 h-9 w-9 text-muted-foreground/30" />
      <h1 className="text-lg font-semibold">{t('settingsHubTitle')}</h1>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('settingsSelectPrompt')}</p>
    </div>
  )
}
