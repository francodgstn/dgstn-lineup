'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { setMobileSettings } from './actions'

const FIELD =
  'flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'

export function MobileSettingsForm({
  initialMinVersion,
  initialMessage,
  initialIos,
  initialAndroid,
}: {
  initialMinVersion: string
  initialMessage: string
  initialIos: string
  initialAndroid: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSubmit(formData: FormData) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await setMobileSettings(formData)
      if (res.ok) setSaved(true)
      else setError(res.error ?? 'Failed to save.')
    })
  }

  return (
    <form action={onSubmit} className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="min_supported_version" className="text-sm font-medium">
          Minimum supported version
        </label>
        <input
          id="min_supported_version"
          name="min_supported_version"
          defaultValue={initialMinVersion}
          placeholder="e.g. 1.2.0 — empty disables the gate"
          className={FIELD}
        />
        <p className="text-xs text-muted-foreground">
          Builds older than this open on an update-required screen instead of the app. Raise it only
          when an old build must be retired (a backend contract it cannot follow) — an OTA update
          reaches every build on the same native fingerprint without it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="update_message" className="text-sm font-medium">
          Message on that screen (optional)
        </label>
        <textarea
          id="update_message"
          name="update_message"
          defaultValue={initialMessage}
          rows={2}
          maxLength={300}
          placeholder="e.g. Bookings changed on the studio side — please update to keep booking."
          className={FIELD}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="store_url_ios" className="text-sm font-medium">
            App Store link
          </label>
          <input
            id="store_url_ios"
            name="store_url_ios"
            defaultValue={initialIos}
            placeholder="https://apps.apple.com/…"
            className={FIELD}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="store_url_android" className="text-sm font-medium">
            Play Store link
          </label>
          <input
            id="store_url_android"
            name="store_url_android"
            defaultValue={initialAndroid}
            placeholder="https://play.google.com/store/apps/details?id=com.dgstn.linyup"
            className={FIELD}
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
