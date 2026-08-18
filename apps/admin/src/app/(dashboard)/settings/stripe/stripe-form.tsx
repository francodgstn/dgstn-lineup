'use client'

import { SecretField } from '@/components/secret-field'
import {
  saveStripeConnectWebhookSecret,
  saveStripeSecretKey,
  saveStripeWebhookSecret,
} from './actions'

export function StripeForm({
  secretKeyConfigured,
  webhookSecretConfigured,
  connectWebhookSecretConfigured,
}: {
  secretKeyConfigured: boolean
  webhookSecretConfigured: boolean
  connectWebhookSecretConfigured: boolean
}) {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <SecretField
        label="Stripe secret key"
        name="secretKey"
        configured={secretKeyConfigured}
        buttonLabel="Save secret key"
        hint="Stored in Secret Manager (stripe-secret-key). Authenticates every Stripe API call — SaaS billing and Connect alike. sk_test_… in sandbox/staging, sk_live_… in production. Write-only."
        action={saveStripeSecretKey}
      />

      <SecretField
        label="Platform webhook signing secret"
        name="webhookSecret"
        configured={webhookSecretConfigured}
        buttonLabel="Save signing secret"
        hint="Stored as stripe-webhook-secret. Signs the handleStripeWebhook endpoint — SaaS billing (studios paying Linyup). Starts with whsec_."
        action={saveStripeWebhookSecret}
      />

      <SecretField
        label="Connect webhook signing secret"
        name="connectWebhookSecret"
        configured={connectWebhookSecretConfigured}
        buttonLabel="Save signing secret"
        hint="Stored as stripe-connect-webhook-secret. Signs the handleConnectWebhook endpoint — members paying studios (drop-ins, appointments, courses, shop). A SEPARATE endpoint in Stripe, so a separate secret."
        action={saveStripeConnectWebhookSecret}
      />

    </div>
  )
}
