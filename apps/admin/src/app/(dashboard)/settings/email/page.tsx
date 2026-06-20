import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getBrevoStatus } from '@/lib/queries/settings'
import { requireOperator } from '@/lib/require-operator'
import { useEmulators } from '@/lib/secret-manager'
import { BrevoForm } from './brevo-form'
import { TestEmailForm } from './test-email-form'

export const dynamic = 'force-dynamic'

// Cloud Functions run in europe-west6 (see packages/functions/src/index.ts).
const FUNCTIONS_REGION = 'europe-west6'

export default async function EmailSettingsPage() {
  const [status, operator] = await Promise.all([getBrevoStatus(), requireOperator()])

  // We don't have the real deployed project here, so template the webhook URL.
  // The project id is available at build/runtime via the public Firebase config.
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '<project>'
  const webhookUrl =
    `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/handleBrevoWebhook` +
    `?token=<webhook secret>`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email (Brevo)</CardTitle>
        <CardDescription>
          System mail is sent through Brevo from a fixed system sender, authenticated by the
          Brevo API key. There is no global SMTP server any more.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {useEmulators && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Running against the emulators — secrets are not persisted here. Set
            <code className="mx-1">BREVO_API_KEY</code> /
            <code className="mx-1">BREVO_WEBHOOK_SECRET</code> in
            <code className="mx-1">packages/functions/.env.local</code> instead.
          </p>
        )}

        {/* System sender + at-a-glance status */}
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">System sender</span>
            <code className="text-sm font-medium">{status.systemSender}</code>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">API key</span>
            {status.apiKeyConfigured ? (
              <Badge variant="success">Configured</Badge>
            ) : (
              <Badge variant="warning">Not configured</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Webhook secret</span>
            {status.webhookSecretConfigured ? (
              <Badge variant="success">Configured</Badge>
            ) : (
              <Badge variant="warning">Not configured</Badge>
            )}
          </div>
        </div>

        <BrevoForm
          apiKeyConfigured={status.apiKeyConfigured}
          webhookSecretConfigured={status.webhookSecretConfigured}
        />

        <div className="border-t pt-4">
          <TestEmailForm defaultRecipient={operator.email} />
        </div>

        {/* Webhook configuration guidance */}
        <div className="flex flex-col gap-2 border-t pt-4">
          <span className="text-sm font-medium">Brevo webhook URL</span>
          <p className="text-xs text-muted-foreground">
            In the Brevo dashboard, point the transactional/event webhook at the URL below. The
            <code className="mx-1">token</code> query parameter must equal the webhook secret set
            above — Brevo&apos;s callbacks are rejected without a matching token.
          </p>
          <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">
            {webhookUrl}
          </code>
          <p className="text-xs text-muted-foreground">
            Replace <code className="mx-1">&lt;webhook secret&gt;</code> with the value you saved.
            {projectId === '<project>' &&
              ' The project id is templated here because it is not available in this environment.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
