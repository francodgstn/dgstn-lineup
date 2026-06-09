import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getAccount } from '@/lib/queries/account'
import type { AccountType } from '@/lib/queries/accounts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge, PlanBadge } from '@/components/status-badge'
import { formatChf, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>
}) {
  const { type, id } = await params
  if (type !== 'team' && type !== 'org') notFound()
  const account = await getAccount(type as AccountType, id)
  if (!account) notFound()

  const sub = account.subscription
  const usage = account.contactUsage

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/accounts"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Accounts
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{account.name}</h1>
        <PlanBadge plan={account.plan} />
        <StatusBadge status={account.status} />
        <span className="text-sm text-muted-foreground capitalize">· {account.type}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {sub ? (
              <>
                <Field label="Plan" value={<span className="capitalize">{sub.plan}</span>} />
                <Field label="Status" value={<StatusBadge status={sub.status} />} />
                <Field label="Base price" value={`${formatChf(sub.baseMonthly)}/mo`} />
                <Field label="Gateway" value={sub.gatewayType ?? 'manual'} />
                <Field label="Current period" value={`${formatDate(sub.currentPeriodStartMs)} → ${formatDate(sub.currentPeriodEndMs)}`} />
                <Field label="Trial ends" value={formatDate(sub.trialEndsAtMs)} />
                <Field label="Cancels at period end" value={sub.cancelAtPeriodEnd ? 'Yes' : 'No'} />
                <Field label="Last payment" value={sub.lastPaymentStatus ?? '—'} />
                <Field label="Stripe customer" value={<code className="text-xs">{sub.customerId ?? '—'}</code>} />
                <Field label="Stripe subscription" value={<code className="text-xs">{sub.subscriptionId ?? '—'}</code>} />
              </>
            ) : (
              <p className="col-span-2 text-sm text-muted-foreground">
                No saas_subscriptions record (manually managed or not yet provisioned).
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact usage</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {usage ? (
              <>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-semibold tabular-nums">{usage.used}</span>
                  <span className="text-sm text-muted-foreground">
                    {usage.isUnlimited ? 'unlimited' : `of ${usage.included} included`}
                  </span>
                </div>
                {!usage.isUnlimited && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={usage.overBy > 0 ? 'h-full bg-destructive' : 'h-full bg-primary'}
                      style={{ width: `${usage.percent}%` }}
                    />
                  </div>
                )}
                {usage.overBy > 0 && (
                  <p className="text-sm text-destructive">{usage.overBy} over the included limit.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Contact usage is tracked per team (orgs aggregate their clubs).
              </p>
            )}
            <Field label="Created" value={formatDate(account.createdMs)} />
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <div className="px-4 pt-4">
          <CardTitle>Members</CardTitle>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {account.members.length === 0 && (
              <TableRow>
                <TableCell className="py-4 text-muted-foreground" colSpan={3}>
                  No members.
                </TableCell>
              </TableRow>
            )}
            {account.members.map((mb) => (
              <TableRow key={mb.userId}>
                <TableCell>{mb.email ?? mb.userId}</TableCell>
                <TableCell className="capitalize">{mb.role.replace('_', ' ')}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(mb.joinedMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {account.type === 'team' && (
        <Card className="py-0">
          <div className="px-4 pt-4">
            <CardTitle>Recent activity</CardTitle>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.activity.length === 0 && (
                <TableRow>
                  <TableCell className="py-4 text-muted-foreground" colSpan={3}>
                    No activity recorded.
                  </TableCell>
                </TableRow>
              )}
              {account.activity.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground">{formatDate(row.createdMs)}</TableCell>
                  <TableCell className="font-mono text-xs">{row.event}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{row.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
