'use client'

// In-app feedback widget entry point — a slim vertical tab on the right edge at
// mid-height. That placement was chosen because the bottom-right corner belongs
// to the AI assistant launcher + page FABs; it is now DECLARED as the dock's
// 'shell-edge' lane rather than written down only in this comment, which is what
// let the assistant launcher take the corner without ever seeing the note
// (UX-9). Same pixels as before — the lane just makes them visible to the next
// floating control. Self-gates on the ops-controlled global flag
// (app_settings/public.feedback_enabled) set from the operator console.
// A pulsing dot signals ops-pushed prompt questions the user hasn't answered
// or muted yet. Mounted once in the auth layout.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { FloatingSlot } from '@/components/layout/FloatingDock'
import { useFeedbackEnabled, useActivePrompts, usePromptBuckets } from './hooks'
import { FeedbackPanel } from './FeedbackPanel'

export default function FeedbackLauncher() {
  const { user } = useAuth()
  const enabled = useFeedbackEnabled()
  if (!user || !enabled) return null
  return <FeedbackTab />
}

function FeedbackTab() {
  const t = useTranslations('Feedback')
  const [open, setOpen] = useState(false)
  const prompts = useActivePrompts(true)
  const buckets = usePromptBuckets(prompts)

  return (
    <>
      <FloatingSlot lane="shell-edge">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('tab')}
          className="relative rounded-l-md bg-primary px-1.5 py-3 text-xs font-medium tracking-wide text-primary-foreground shadow-md transition-colors hover:bg-primary/90 [writing-mode:vertical-rl]"
        >
          {t('tab')}
          {buckets.open.length > 0 && (
            <span
              aria-hidden
              className="absolute -left-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 ring-2 ring-background"
            />
          )}
        </button>
      </FloatingSlot>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md!">
          <FeedbackPanel buckets={buckets} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}
