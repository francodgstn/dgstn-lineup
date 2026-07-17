'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { setFeedbackSettings } from './actions'

export function FeedbackSettingsForm({
  initialEnabled,
  initialNotifyEnabled,
  initialNotifyEmails,
}: {
  initialEnabled: boolean
  initialNotifyEnabled: boolean
  initialNotifyEmails: string[]
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [notifyEnabled, setNotifyEnabled] = useState(initialNotifyEnabled)
  const [emails, setEmails] = useState(initialNotifyEmails.join('\n'))
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSubmit(formData: FormData) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await setFeedbackSettings(formData)
      if (res.ok) setSaved(true)
      else setError(res.error ?? 'Failed to save.')
    })
  }

  return (
    <form action={onSubmit} className="flex max-w-xl flex-col gap-5">
      {/* Global widget switch */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4 rounded border-input"
        />
        <span className="text-sm font-medium">
          {enabled ? 'Feedback widget is ON' : 'Feedback widget is OFF'}
        </span>
      </label>
      <p className="-mt-3 text-xs text-muted-foreground">
        When on, every signed-in web-app user sees the Feedback tab on the right edge (all tenants —
        the switch is global). When off, the widget is hidden and nothing can be submitted.
      </p>

      {/* Notifications */}
      <div className="flex flex-col gap-3 border-t pt-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="notify_enabled"
            checked={notifyEnabled}
            onChange={(e) => setNotifyEnabled(e.target.checked)}
            className="size-4 rounded border-input"
          />
          <span className="text-sm font-medium">Email notification per feedback</span>
        </label>
        <p className="-mt-2 text-xs text-muted-foreground">
          When on, every new submission (including prompt answers) sends a system email to the
          addresses below. Changes apply immediately.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notify-emails" className="text-sm font-medium">
            Recipients <span className="font-normal text-muted-foreground">(one per line, max 10)</span>
          </label>
          <textarea
            id="notify-emails"
            name="notify_emails"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={3}
            placeholder={'ops@linyup.com'}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-[var(--success)]">Saved.</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </form>
  )
}
