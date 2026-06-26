'use client'

import { useState, useTransition } from 'react'
import { ANNOUNCEMENT_MAX_LENGTH, type AnnouncementStyle } from '@linyup/shared'
import { Button } from '@/components/ui/button'
import { setAnnouncement } from './actions'

// Tailwind classes for the inline preview strip per style. Info=blue,
// warning=amber, success=green — basic colored bars, no rich styling.
const PREVIEW_STYLES: Record<AnnouncementStyle, string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  success: 'bg-green-50 text-green-800 border-green-200',
}

export function AnnouncementForm({
  initialEnabled,
  initialText,
  initialStyle,
}: {
  initialEnabled: boolean
  initialText: string
  initialStyle: AnnouncementStyle
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [text, setText] = useState(initialText)
  const [style, setStyle] = useState<AnnouncementStyle>(initialStyle)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSubmit(formData: FormData) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await setAnnouncement(formData)
      if (res.ok) {
        setSaved(true)
      } else {
        setError(res.error ?? 'Failed to save.')
      }
    })
  }

  const previewText = text.trim() || 'Your announcement text will appear here.'

  return (
    <form action={onSubmit} className="flex max-w-xl flex-col gap-5">
      {/* Enabled toggle */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4 rounded border-input"
        />
        <span className="text-sm font-medium">
          {enabled ? 'Announcement is ON' : 'Announcement is OFF'}
        </span>
      </label>
      <p className="-mt-3 text-xs text-muted-foreground">
        When on, the banner is shown across the web app as a top strip. When off, the saved text is
        kept but not displayed.
      </p>

      {/* Text */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="announcement-text" className="text-sm font-medium">
            Text
          </label>
          <span className="text-xs text-muted-foreground">
            {text.length}/{ANNOUNCEMENT_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id="announcement-text"
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={ANNOUNCEMENT_MAX_LENGTH}
          rows={2}
          placeholder="e.g. This is a demo — data resets periodically."
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {/* Style */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="announcement-style" className="text-sm font-medium">
          Style
        </label>
        <select
          id="announcement-style"
          name="style"
          value={style}
          onChange={(e) => setStyle(e.target.value as AnnouncementStyle)}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="info">Info (blue)</option>
          <option value="warning">Warning (amber)</option>
          <option value="success">Success (green)</option>
        </select>
      </div>

      {/* Inline preview */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Preview</span>
        <div
          className={`rounded-md border px-3 py-2 text-center text-sm ${PREVIEW_STYLES[style]}`}
        >
          {previewText}
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
