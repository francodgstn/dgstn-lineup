import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getStripeStatus } from '@/lib/queries/settings'
import { requireOperator } from '@/lib/require-operator'
import { useEmulators } from '@/lib/secret-manager'
import { StripeForm } from './stripe-form'

export const dynamic = 'force-dynamic'

// Cloud Functions run in europe-west6 (see packages/functions/src/index.ts).
const FUNCTIONS_REGION = 'europe-west6'

export default async function StripeSettingsPage() {
  const [status] = await Promise.all([getStripeStatus(), requireOperator()])

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '<project>'
  const base = `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments (Stripe)</CardTitle>
        <CardDescription>
          One API key, two webhook endpoints: the platform endpoint carries SaaS billing (studios
          paying Linyup), the Connect endpoint carries member→studio payments. Stripe signs each
          endpoint with its own secret, so both must be set.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {useEmulators && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Running against the emulators — secrets are not persisted here. Set
            <code className="mx-1">STRIPE_SECRET_KEY</code> /
            <code className="mx-1">STRIPE_WEBHOOK_SECRET</code> /
            <code className="mx-1">STRIPE_CONNECT_WEBHOOK_SECRET</code> in
            <code className="mx-1">packages/functions/.env.local</code> instead
            (<code className="mx-1">pnpm stripe:listen</code> prints the two signing secrets).
          </p>
        )}

        {/* At-a-glance status */}
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Secret key</span>
            <StatusBadge configured={status.secretKeyConfigured} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Platform webhook secret</span>
            <StatusBadge configured={status.webhookSecretConfigured} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Connect webhook secret</span>
            <StatusBadge configured={status.connectWebhookSecretConfigured} />
          </div>
        </div>

        <StripeForm
          secretKeyConfigured={status.secretKeyConfigured}
          webhookSecretConfigured={status.webhookSecretConfigured}
          connectWebhookSecretConfigured={status.connectWebhookSecretConfigured}
        />

        {/* Endpoint guidance — these are the URLs to register in Stripe. */}
        <div className="flex flex-col gap-3 border-t pt-4">
          <span className="text-sm font-medium">Webhook endpoints</span>
          <p className="text-xs text-muted-foreground">
            Register both in the Stripe dashboard. Each gets its own signing secret — copy each
            one into the matching field above. The Connect endpoint must be created under{' '}
            <em>Connect</em> events, not account events, or member payments will never confirm.
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Platform (SaaS billing)</span>
            <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">
              {base}/handleStripeWebhook
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Connect (member → studio)</span>
            <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">
              {base}/handleConnectWebhook
            </code>
          </div>
          {projectId === '<project>' && (
            <p className="text-xs text-muted-foreground">
              The project id is templated here because it is not available in this environment.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <Badge variant="success">Configured</Badge>
  ) : (
    <Badge variant="warning">Not configured</Badge>
  )
}
