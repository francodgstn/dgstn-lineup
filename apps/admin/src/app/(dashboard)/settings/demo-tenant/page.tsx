import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOperator } from '@/lib/require-operator'
import { getDemoTenantStatus, getReviewAccessStatus } from '@/lib/queries/demoTenant'
import { DemoTenantCard } from './demo-tenant-card'
import { ReviewAccessCard } from './review-access-card'

export const dynamic = 'force-dynamic'

export default async function DemoTenantSettingsPage() {
  const [, demo, review] = await Promise.all([
    requireOperator(),
    getDemoTenantStatus(),
    getReviewAccessStatus(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Demo tenant</CardTitle>
          <CardDescription>
            A curated studio that lives in this environment so an app-store reviewer has something
            to sign into. It is hidden from platform metrics, sends nothing, and has no payment
            account — so a reviewer cannot be charged and cannot email anybody. Provisioning runs
            in a Cloud Function, not here, because it writes across a whole tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DemoTenantCard status={demo} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App-store review login</CardTitle>
          <CardDescription>
            The contacts&rsquo; app signs in with an emailed six-digit code, which a reviewer cannot
            receive. This gives ONE contact address a known code that is never mailed. It is a
            deliberate bypass: it applies to a single address, expires on its own, and every use is
            logged. Turn it off once the build is approved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReviewAccessCard status={review} />
        </CardContent>
      </Card>
    </div>
  )
}
