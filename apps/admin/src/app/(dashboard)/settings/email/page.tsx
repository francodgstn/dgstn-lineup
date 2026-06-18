import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getGlobalSmtp } from '@/lib/queries/settings'
import { formatDate } from '@/lib/format'
import { useEmulators } from '@/lib/secret-manager'
import { SmtpForm } from './smtp-form'

export const dynamic = 'force-dynamic'

export default async function EmailSettingsPage() {
  const smtp = await getGlobalSmtp()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default SMTP server</CardTitle>
        <CardDescription>
          The fallback mail server used when a team or organization has not configured its own.
          Sits at the bottom of the team → org → global hierarchy.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {useEmulators && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Running against the emulators — the password field is not persisted here. Set
            <code className="mx-1">SMTP_PASSWORD</code> in
            <code className="mx-1">packages/functions/.env.local</code> instead.
          </p>
        )}

        <SmtpForm initial={smtp} />

        <div className="border-t pt-3 text-xs text-muted-foreground">
          {smtp?.updatedMs
            ? `Last updated ${formatDate(smtp.updatedMs)}${
                smtp.updatedBy ? ` by ${smtp.updatedBy}` : ''
              }.`
            : 'Not configured yet.'}
          {smtp?.passwordSet && smtp.passwordUpdatedMs
            ? ` Password last changed ${formatDate(smtp.passwordUpdatedMs)}.`
            : ''}
        </div>
      </CardContent>
    </Card>
  )
}
