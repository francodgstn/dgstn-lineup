'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  saveBrevoApiKey,
  saveBrevoWebhookSecret,
  type SaveSecretResult,
} from './actions'

function ConfiguredBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <Badge variant="success">Configured</Badge>
  ) : (
    <Badge variant="warning">Not configured</Badge>
  )
}

// One write-only secret field. The stored value is never echoed — we only show
// whether something is set, and the operator can replace it by entering a value.
function SecretField({
  label,
  name,
  configured,
  hint,
  buttonLabel,
  action,
}: {
  label: string
  name: string
  configured: boolean
  hint: string
  buttonLabel: string
  action: (formData: FormData) => Promise<SaveSecretResult>
}) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<SaveSecretResult | null>(null)

  function onSubmit(formData: FormData) {
    setResult(null)
    startTransition(async () => {
      const r = await action(formData)
      setResult(r)
      // Clear the field on a clean save so the secret is not left in the DOM.
      if (r.ok && !r.warning) {
        const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
        if (input) input.value = ''
      }
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <ConfiguredBadge configured={configured} />
      </div>

      <div className="flex items-start gap-3">
        <Input
          name={name}
          type="password"
          autoComplete="new-password"
          placeholder={configured ? '•••••••• (set — enter a value to replace)' : 'Enter value'}
          className="flex-1"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : buttonLabel}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{hint}</p>

      {result?.ok && !result.warning && (
        <p className="text-sm text-[var(--success)]">Saved.</p>
      )}
      {result?.error && <p className="text-sm text-destructive">{result.error}</p>}
      {result?.ok && result.warning && (
        <p className="text-sm text-[var(--warning)]">Not saved: {result.warning}</p>
      )}
    </form>
  )
}

export function BrevoForm({
  apiKeyConfigured,
  webhookSecretConfigured,
}: {
  apiKeyConfigured: boolean
  webhookSecretConfigured: boolean
}) {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <SecretField
        label="Brevo API key"
        name="apiKey"
        configured={apiKeyConfigured}
        buttonLabel="Save API key"
        hint="Stored in Secret Manager (brevo-api-key). Authenticates all system mail sent via Brevo. Write-only — never shown again after saving."
        action={saveBrevoApiKey}
      />

      <SecretField
        label="Brevo webhook secret"
        name="webhookSecret"
        configured={webhookSecretConfigured}
        buttonLabel="Save webhook secret"
        hint="Stored in Secret Manager (brevo-webhook-secret). The token Brevo must include when calling the event webhook. Write-only — never shown again after saving."
        action={saveBrevoWebhookSecret}
      />
    </div>
  )
}
