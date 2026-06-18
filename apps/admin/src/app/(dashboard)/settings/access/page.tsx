import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPublicSignupSettings, listSignupAllowlist } from '@/lib/queries/access'
import { formatDate } from '@/lib/format'
import { PublicSignupToggle } from './toggle-form'
import { AllowlistManager } from './allowlist-manager'

export const dynamic = 'force-dynamic'

export default async function AccessSettingsPage() {
  const [signup, allowlist] = await Promise.all([
    getPublicSignupSettings(),
    listSignupAllowlist(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Public signup</CardTitle>
          <CardDescription>
            Controls whether new coaches / studios can create a Linyup account. When closed, only
            the emails you authorize below can sign up — existing users are unaffected and can still
            log in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <PublicSignupToggle initialEnabled={signup.enabled} />
          <div className="border-t pt-3 text-xs text-muted-foreground">
            {signup.updatedMs
              ? `Last changed ${formatDate(signup.updatedMs)}${
                  signup.updatedBy ? ` by ${signup.updatedBy}` : ''
                }.`
              : 'Never changed — defaults to closed.'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authorized emails</CardTitle>
          <CardDescription>
            People you authorize can create their own account at the normal signup page even while
            public signup is closed. By default they receive an invite email with a link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AllowlistManager entries={allowlist} />
        </CardContent>
      </Card>
    </div>
  )
}
