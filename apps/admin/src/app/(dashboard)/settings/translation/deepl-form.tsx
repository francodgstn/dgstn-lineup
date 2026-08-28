'use client'

// DeepL's write-only secret. The field is the shared SecretField
// (components/secret-field.tsx) the Email and Payments pages also use.

import { SecretField } from '@/components/secret-field'
import { saveDeeplApiKey } from './actions'

export function DeeplForm({ apiKeyConfigured }: { apiKeyConfigured: boolean }) {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <SecretField
        label="DeepL API key"
        name="apiKey"
        configured={apiKeyConfigured}
        buttonLabel="Save API key"
        hint="Stored in Secret Manager (deepl-api-key). Free-tier keys end in :fx and are routed to DeepL's free endpoint automatically. Write-only — never shown again after saving."
        action={saveDeeplApiKey}
      />
    </div>
  )
}
