'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sendBrevoTestEmail, type SendTestResult } from './actions'

// Operator "send test email": fires a Brevo system send to verify the API key +
// sender. The recipient defaults to the operator's own address (prefilled) but
// can be overridden.
export function TestEmailForm({ defaultRecipient }: { defaultRecipient: string }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<SendTestResult | null>(null)

  function onSubmit(formData: FormData) {
    setResult(null)
    startTransition(async () => {
      setResult(await sendBrevoTestEmail(formData))
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-2">
      <span className="text-sm font-medium">Send a test email</span>
      <div className="flex items-start gap-3">
        <Input
          name="to"
          type="email"
          defaultValue={defaultRecipient}
          placeholder="recipient@example.com"
          className="flex-1"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send test'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Sends a system email from the Brevo system sender to verify the API key works. Defaults to
        your own address.
      </p>
      {result?.ok && result.sentTo && (
        <p className="text-sm text-[var(--success)]">Sent to {result.sentTo}.</p>
      )}
      {result?.error && <p className="text-sm text-destructive">{result.error}</p>}
      {result?.warning && <p className="text-sm text-[var(--warning)]">{result.warning}</p>}
    </form>
  )
}
