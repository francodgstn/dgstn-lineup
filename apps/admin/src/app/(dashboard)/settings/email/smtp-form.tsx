'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveGlobalSmtp, type SaveSmtpResult } from './actions'
import type { GlobalSmtpView } from '@/lib/queries/settings'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function SmtpForm({ initial }: { initial: GlobalSmtpView | null }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<SaveSmtpResult | null>(null)
  // Default new connections to STARTTLS on 587 — the common provider setup.
  const [secure, setSecure] = useState(initial?.secure ?? false)
  const hasPassword = initial?.passwordSet ?? false

  function onSubmit(formData: FormData) {
    setResult(null)
    startTransition(async () => {
      setResult(await saveGlobalSmtp(formData))
    })
  }

  return (
    <form action={onSubmit} className="flex max-w-xl flex-col gap-5">
      <Field label="Host" hint="e.g. smtp.sendgrid.net">
        <Input name="host" defaultValue={initial?.host ?? ''} placeholder="smtp.example.com" required />
      </Field>

      <div className="grid grid-cols-[1fr_auto] items-start gap-5">
        <Field label="Port" hint="465 for TLS, 587 for STARTTLS">
          <Input
            name="port"
            type="number"
            min={1}
            max={65535}
            defaultValue={initial?.port ?? 587}
            required
          />
        </Field>
        <Field label="Secure (TLS)" hint="On = implicit TLS (465)">
          {/* Hidden input guarantees a value is posted even when unchecked. */}
          <input type="hidden" name="secure" value={secure ? 'true' : 'false'} />
          <button
            type="button"
            role="switch"
            aria-checked={secure}
            onClick={() => setSecure((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              secure ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`inline-block size-5 transform rounded-full bg-background shadow transition-transform ${
                secure ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </Field>
      </div>

      <Field label="Username">
        <Input name="user" defaultValue={initial?.user ?? ''} placeholder="apikey" required />
      </Field>

      <Field
        label="Password"
        hint={
          hasPassword
            ? 'A password is stored. Leave blank to keep it, or enter a new one to replace it.'
            : 'Stored in Secret Manager — never shown again after saving.'
        }
      >
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={hasPassword ? '•••••••• (unchanged)' : ''}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save SMTP settings'}
        </Button>
        {result?.ok && !result.warning && (
          <span className="text-sm text-green-600 dark:text-green-500">Saved.</span>
        )}
      </div>

      {result?.error && <p className="text-sm text-destructive">{result.error}</p>}
      {result?.ok && result.warning && (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Settings saved, but: {result.warning}
        </p>
      )}
    </form>
  )
}
