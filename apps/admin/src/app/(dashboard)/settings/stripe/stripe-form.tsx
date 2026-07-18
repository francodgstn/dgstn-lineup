'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SecretField } from '@/components/secret-field'
import {
  saveStripeConnectWebhookSecret,
  saveStripeSecretKey,
  saveStripeWebhookSecret,
  verifyStripeKey,
  type VerifyKeyResult,
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

      <div className="border-t pt-4">
        <VerifyKey disabled={!secretKeyConfigured} />
      </div>
    </div>
  )
}

// Asks Stripe which account the stored key belongs to. Catches the two failures
// that otherwise only appear at the first real charge: a test key in production,
// or a key for the wrong account.
function VerifyKey({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<VerifyKeyResult | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Check the key</span>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending || disabled}
          onClick={() => {
            setResult(null)
            startTransition(async () => setResult(await verifyStripeKey()))
          }}
        >
          {pending ? 'Checking…' : 'Verify with Stripe'}
        </Button>
        {result?.ok && (
          <Badge variant={result.livemode ? 'success' : 'warning'}>
            {result.livemode ? 'LIVE mode' : 'TEST mode'}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Read-only call to Stripe (GET /v1/account) that confirms the stored key works and shows
        which account and mode it belongs to.
      </p>
      {result?.ok && (
        <p className="text-sm text-[var(--success)]">
          Key valid — {result.accountName ? `${result.accountName} ` : ''}
          <code>{result.accountId}</code>
        </p>
      )}
      {result?.error && <p className="text-sm text-destructive">{result.error}</p>}
      {result?.warning && <p className="text-sm text-[var(--warning)]">{result.warning}</p>}
    </div>
  )
}
