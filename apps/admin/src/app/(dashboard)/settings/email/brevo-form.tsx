'use client'

// Brevo's two write-only secrets. The field itself is the shared SecretField
// (components/secret-field.tsx), which the Stripe settings page also uses.

import { SecretField } from '@/components/secret-field'
import { saveBrevoApiKey, saveBrevoWebhookSecret } from './actions'

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
