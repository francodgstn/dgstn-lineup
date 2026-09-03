import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getMobileSettingsStatus } from '@/lib/queries/settings'
import { formatDate } from '@/lib/format'
import { requireOperator } from '@/lib/require-operator'
import { MobileSettingsForm } from './mobile-form'

export const dynamic = 'force-dynamic'

export default async function MobileSettingsPage() {
  const [mobile] = await Promise.all([getMobileSettingsStatus(), requireOperator()])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Member app</CardTitle>
        <CardDescription>
          The policy the Linyup member app reads before anyone signs in (the world-readable
          <code className="mx-1 font-mono text-xs">app_settings/mobile</code>document). The test
          login for the app lives under <span className="font-medium">Demo tenant</span>; release
          lanes are documented in{' '}
          <code className="font-mono text-xs">.claude/skills/mobile-release</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MobileSettingsForm
          initialMinVersion={mobile.minSupportedVersion ?? ''}
          initialMessage={mobile.updateMessage ?? ''}
          initialIos={mobile.storeUrlIos ?? ''}
          initialAndroid={mobile.storeUrlAndroid ?? ''}
        />
        <div className="border-t pt-3 text-xs text-muted-foreground">
          {mobile.updatedMs
            ? `Last changed ${formatDate(mobile.updatedMs)}${mobile.updatedBy ? ` by ${mobile.updatedBy}` : ''}.`
            : 'Never changed — no gate is in force.'}
        </div>
      </CardContent>
    </Card>
  )
}
